import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { cropPng, detectFrames } from './crop.js';
import { FigmaPlanError, flowSchema, layoutOrder, type FigmaFlow } from './figma.js';
import { imageSourceSchema, loadImage, pngSize, PrototypeError, type Prototypes } from './store.js';

const boxSchema = z.strictObject({ x: z.number().min(0), y: z.number().min(0), width: z.number().positive(), height: z.number().positive() });
export const figmaExportSchema = z.union([
  // One exported section image: with the planned flow, with confirmed boxes, or neither (detect and propose).
  z.strictObject({ sectionImage: z.string().refine(isAbsolute, 'Use an absolute path'), name: z.string().trim().min(1).max(120).default('Figma flow'),
    device: z.enum(['desktop', 'mobile']).default('desktop'), flow: flowSchema.optional(), boxes: z.array(boxSchema).min(2).max(40).optional() }),
  // A folder of frame PNGs exported from Figma: propose filename order, or import a confirmed order.
  z.strictObject({ folder: z.string().refine(isAbsolute, 'Use an absolute path'), name: z.string().trim().min(1).max(120).default('Figma flow'),
    device: z.enum(['desktop', 'mobile']).default('desktop'), order: z.array(z.string().min(1)).min(2).max(40).optional() }),
]);

/** Crops each planned screen out of one section render; targets scale with the image. */
export async function importFigmaSection(prototypes: Prototypes, rawFlow: unknown, image: z.infer<typeof imageSourceSchema>, device: 'desktop' | 'mobile', signal?: AbortSignal) {
  const flow = flowSchema.parse(rawFlow);
  const png = await loadImage(image, signal);
  const size = pngSize(png);
  const scale = size.width / flow.section.width;
  if (Math.abs(size.height / flow.section.height - scale) > scale * 0.05) throw new PrototypeError(`The image (${size.width}×${size.height}) does not match the section (${flow.section.width}×${flow.section.height}). Render the section itself with contentsOnly so it is not padded.`);
  if (scale < 0.5) throw new PrototypeError(`The section rendered at ${Math.round(scale * 100)}% of its size, too small to read. Request it with a larger maxDimension, split the flow into a smaller section, or export the section from Figma as PNG and use usability_import_figma_export.`);
  return importCrops(prototypes, flow.name, device, { tool: 'figma-mcp', fileKey: flow.fileKey, nodeId: flow.sectionId }, png,
    flow.screens.map(s => ({ id: s.id, name: s.name, box: { x: s.x * scale, y: s.y * scale, width: s.width * scale, height: s.height * scale } })),
    flow.targets.map(t => ({ ...t, x: t.x * scale, y: t.y * scale, width: t.width * scale, height: t.height * scale })), signal);
}

async function importCrops(prototypes: Prototypes, name: string, device: 'desktop' | 'mobile', source: { tool: string; fileKey?: string; nodeId?: string },
  png: Buffer, screens: { id: string; name: string; box: { x: number; y: number; width: number; height: number } }[], targets: FigmaFlow['targets'], signal?: AbortSignal) {
  const crops = await cropPng(png, screens.map(s => s.box));
  return prototypes.import({ name, device, source, screens: screens.map((s, i) => ({ id: s.id, name: s.name, image: { base64: crops[i]!.toString('base64') } })),
    targets: targets.map(t => ({ ...t, x: Math.max(0, t.x), y: Math.max(0, t.y) })) }, signal);
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
/** Export fallback: works for any Figma plan and any file the user can view, without the Figma MCP. */
export async function importFigmaExport(prototypes: Prototypes, raw: unknown) {
  const input = figmaExportSchema.parse(raw);
  if ('folder' in input) {
    const files = (await readdir(input.folder)).filter(f => f.toLowerCase().endsWith('.png')).sort(natural);
    if (files.length < 2) throw new PrototypeError('The folder needs at least two PNG screens exported from Figma.');
    if (!input.order) return { proposal: { order: files }, instructions: 'Show this order to the owner (exported frames are named after their layers). Call again with the confirmed order.' };
    if (input.order.some(f => !files.includes(f))) throw new PrototypeError('The order lists files that are not in the folder.');
    return { prototype: await prototypes.import({ name: input.name, device: input.device, source: { tool: 'figma-export' },
      screens: input.order.map((f, i) => ({ id: `screen-${i + 1}`, name: f.replace(/\.png$/i, ''), image: { path: join(input.folder, f) } })) }) };
  }
  const png = await readFile(input.sectionImage);
  pngSize(png);
  if (input.flow) return { prototype: await importFigmaSection(prototypes, input.flow, { path: input.sectionImage }, input.device) };
  if (!input.boxes) {
    const found = layoutOrder(await detectFrames(png));
    if (found.length < 2) throw new FigmaPlanError('Could not find two or more screens in that image. Export each frame instead and use a folder.');
    return { proposal: { boxes: found }, instructions: 'Detected screens in layout order (image pixels). Confirm the count and order with the owner (view the image), then call again with these boxes.' };
  }
  return { prototype: await importCrops(prototypes, input.name, input.device, { tool: 'figma-export' }, png,
    input.boxes.map((box, i) => ({ id: `screen-${i + 1}`, name: `Screen ${i + 1}`, box })), []) };
}
