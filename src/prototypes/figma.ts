import { z } from 'zod';

// Turns a plain Figma link plus the Figma MCP's get_metadata XML into ordered flows.
// Pure and dependency-free so the same plan works with any host that can call get_metadata.
export class FigmaPlanError extends Error {}

export function parseFigmaUrl(raw: string): { fileKey: string; nodeId?: string } {
  let url: URL;
  try { url = new URL(raw); } catch { throw new FigmaPlanError('That is not a valid link.'); }
  if (!/(^|\.)figma\.com$/.test(url.hostname)) throw new FigmaPlanError('Use a figma.com link.');
  const parts = url.pathname.split('/').filter(Boolean);
  const kind = parts[0];
  if (kind === 'make') throw new FigmaPlanError('Figma Make files cannot be read this way. Use a design file link.');
  if (kind === 'board') throw new FigmaPlanError('FigJam boards are not screen flows. Use a design file link.');
  if (!['design', 'file', 'proto'].includes(kind ?? '') || !parts[1]) throw new FigmaPlanError('Use a Figma design link such as figma.com/design/<file>/<name>?node-id=1-2.');
  // Branch links address the branch, not the main file.
  const branch = parts.indexOf('branch');
  const fileKey = branch > 0 && parts[branch + 1] ? parts[branch + 1]! : parts[1]!;
  if (!/^[0-9a-zA-Z]{10,128}$/.test(fileKey)) throw new FigmaPlanError('Could not read the file key from that link.');
  const node = url.searchParams.get('node-id') ?? url.searchParams.get('starting-point-node-id');
  return { fileKey, ...(node ? { nodeId: node.replace('-', ':') } : {}) };
}

export type FigmaNode = { tag: string; id: string; name: string; x: number; y: number; width: number; height: number; hidden: boolean; children: FigmaNode[] };
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** Minimal tolerant XML reader for get_metadata output: elements with attributes, nested. */
export function parseMetadataXml(xml: string): FigmaNode[] {
  const roots: FigmaNode[] = []; const stack: FigmaNode[] = [];
  const tagRe = /<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  for (const m of xml.matchAll(tagRe)) {
    const [, closing, tag, attrText, selfClosing] = m;
    if (closing) { stack.pop(); continue; }
    const attrs: Record<string, string> = {};
    for (const a of attrText!.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!] = decode(a[2] ?? a[3] ?? '');
    const num = (k: string) => Number(attrs[k] ?? 0) || 0;
    const node: FigmaNode = { tag: tag!.toLowerCase(), id: attrs.id ?? '', name: attrs.name ?? '', x: num('x'), y: num('y'), width: num('width'), height: num('height'),
      hidden: attrs.hidden === 'true' || attrs.visible === 'false', children: [] };
    (stack.at(-1)?.children ?? roots).push(node);
    if (!selfClosing) stack.push(node);
  }
  return roots;
}

const SCREEN_TAGS = new Set(['frame', 'component', 'instance', 'component-set', 'component_set']);
const TAP = /^@tap/i;
export const flowSchema = z.strictObject({
  fileKey: z.string(), name: z.string(), sectionId: z.string(),
  section: z.strictObject({ width: z.number().positive(), height: z.number().positive() }),
  screens: z.array(z.strictObject({ nodeId: z.string(), id: z.string(), name: z.string(), x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() })).min(2).max(40),
  targets: z.array(z.strictObject({ screenId: z.string(), x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), label: z.string().optional(), basis: z.literal('owner-marked') })).default([]),
});
export type FigmaFlow = z.infer<typeof flowSchema>;
const screenId = (nodeId: string) => nodeId.replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 80);

/** Rows top to bottom (frames whose vertical ranges overlap share a row), each left to right. */
export function layoutRows<T extends { x: number; y: number; height: number }>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (const item of [...items].sort((a, b) => a.y - b.y)) {
    const row = rows.find(r => r.some(o => item.y < o.y + o.height && o.y < item.y + item.height));
    if (row) row.push(item); else rows.push([item]);
  }
  return rows.map(r => r.sort((a, b) => a.x - b.x));
}
export function layoutOrder<T extends { x: number; y: number; height: number }>(items: T[]): T[] { return layoutRows(items).flat(); }

// Child coordinates in get_metadata are relative to their parent; nested targets accumulate offsets.
function collectTargets(node: FigmaNode, dx: number, dy: number, out: { x: number; y: number; width: number; height: number; label: string }[]) {
  for (const child of node.children) {
    const x = dx + child.x, y = dy + child.y;
    if (TAP.test(child.name)) out.push({ x, y, width: child.width, height: child.height, label: child.name.replace(TAP, '').replace(/^[\s:_-]+/, '').trim() || child.name });
    collectTargets(child, x, y, out);
  }
}
const visibleScreens = (section: FigmaNode) => section.children.filter(c => SCREEN_TAGS.has(c.tag) && !c.hidden && c.width > 0 && c.height > 0);
function flowFromSection(fileKey: string, section: FigmaNode, warnings: string[], chosen?: string[]): FigmaFlow | undefined {
  const all = visibleScreens(section);
  let frames = layoutOrder(all);
  if (chosen) {
    // The owner's path, in the owner's order. IDs may use '-' or ':' as in links.
    frames = chosen.map(id => all.find(f => f.id === id.replace('-', ':')) ?? (() => { throw new FigmaPlanError(`Screen ${id} is not a visible screen in "${section.name}".`); })());
    if (new Set(frames).size !== frames.length) throw new FigmaPlanError('Each screen can appear once in a flow.');
  }
  if (frames.length < 2) { warnings.push(`"${section.name}" has fewer than two visible screens, so it is not a flow.`); return undefined; }
  const targets: FigmaFlow['targets'] = [];
  for (const frame of frames) {
    const found: { x: number; y: number; width: number; height: number; label: string }[] = [];
    collectTargets(frame, 0, 0, found);
    if (found.length > 1) warnings.push(`Screen "${frame.name}" has ${found.length} @tap layers; keep one (the first is used).`);
    if (found[0] && frame !== frames.at(-1)) targets.push({ screenId: screenId(frame.id), ...found[0], basis: 'owner-marked' });
    if (found[0] && frame === frames.at(-1)) warnings.push(`The last screen "${frame.name}" has an @tap layer; the last screen ends the flow, so it is ignored.`);
  }
  return { fileKey, name: section.name || 'Figma flow', sectionId: section.id, section: { width: section.width, height: section.height },
    screens: frames.map(f => ({ nodeId: f.id, id: screenId(f.id), name: f.name, x: f.x, y: f.y, width: f.width, height: f.height })), targets };
}
function find(nodes: FigmaNode[], id: string, parent?: FigmaNode): { node: FigmaNode; parent?: FigmaNode } | undefined {
  for (const n of nodes) { if (n.id === id) return { node: n, parent }; const hit = find(n.children, id, n); if (hit) return hit; }
  return undefined;
}

export function planFigmaFlows(figmaUrl: string, metadataXml: string, screenIds?: string[]) {
  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
  const roots = parseMetadataXml(metadataXml);
  if (!roots.length) throw new FigmaPlanError('The metadata was empty. Call get_metadata for the link and pass its full XML output.');
  const warnings: string[] = [];
  const hit = nodeId ? find(roots, nodeId) : undefined;
  const start = hit?.node ?? (roots.length === 1 ? roots[0]! : undefined);
  // A frame link means its section is the flow.
  const section = start && SCREEN_TAGS.has(start.tag) && hit?.parent?.tag === 'section' ? hit.parent : start?.tag === 'section' ? start : undefined;
  if (start && SCREEN_TAGS.has(start.tag) && !section) throw new FigmaPlanError('That link points to a single screen. Link the section that holds the whole flow (right-click the section → Copy link).');
  if (section) {
    if (screenIds) { const flow = flowFromSection(fileKey, section, warnings, screenIds)!; return { fileKey, flows: [flow], needsChoice: false, warnings }; }
    const flow = flowFromSection(fileKey, section, warnings);
    if (!flow) throw new FigmaPlanError(warnings.join(' '));
    // Spec boards hold several journeys, alternatives and error states in rows; a person follows one path.
    const rows = layoutRows(visibleScreens(section)).map((r, i) => ({ row: i + 1, screens: r.map(f => ({ id: f.id, name: f.name })) }));
    const board = rows.length > 1 || flow.screens.length > 8;
    return { fileKey, flows: [flow], needsChoice: board, ...(board ? { rows } : {}), warnings };
  }
  // Page or whole file: every section is a candidate flow, plus loose top-level screens.
  const scope = start ? start.children : roots.flatMap(r => r.tag === 'canvas' || r.tag === 'page' || r.tag === 'document' ? r.children : [r]);
  const flows = scope.filter(n => n.tag === 'section').map(s => flowFromSection(fileKey, s, warnings)).filter((f): f is FigmaFlow => Boolean(f));
  const loose = scope.filter(n => SCREEN_TAGS.has(n.tag) && !n.hidden);
  if (loose.length >= 2) warnings.push(`${loose.length} screens sit outside any section on this page. Put a flow's screens in a section to test them together.`);
  if (!flows.length) throw new FigmaPlanError(`No section with two or more screens was found here. ${warnings.join(' ')}`.trim());
  return { fileKey, flows, needsChoice: flows.length > 1, warnings };
}
