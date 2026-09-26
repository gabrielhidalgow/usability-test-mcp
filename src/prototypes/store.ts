import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EvidenceRecorder } from '../evidence/recorder.js';

export const prototypeIdSchema = z.string().regex(/^prototype-[0-9a-f-]{36}$/);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const screenIdSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/);

// Images come from whatever Figma access the host has: an exported file, an asset URL, or inline data.
const imageSourceSchema = z.union([
  z.strictObject({ path: z.string().min(1).refine(isAbsolute, 'Use an absolute file path') }),
  z.strictObject({ url: z.url() }),
  z.strictObject({ base64: z.string().min(16) }),
]);
export const prototypeManifestSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  source: z.strictObject({ tool: z.string().trim().min(1).max(60), fileKey: z.string().max(80).optional(), nodeId: z.string().max(80).optional(), url: z.url().optional() }),
  device: z.enum(['desktop', 'mobile']).default('desktop'),
  // Flow order: left to right, then top to bottom, as laid out in the Figma section.
  screens: z.array(z.strictObject({
    id: screenIdSchema, name: z.string().trim().min(1).max(160), image: imageSourceSchema,
    // Only text layers that are visible on the frame; hidden layers could reveal the route.
    visibleText: z.string().max(8000).optional(),
  })).min(2).max(40),
  targets: z.array(z.strictObject({
    screenId: screenIdSchema, x: z.number().min(0), y: z.number().min(0), width: z.number().positive(), height: z.number().positive(),
    label: z.string().trim().max(160).optional(), basis: z.enum(['owner-marked', 'proposed-approved']),
  })).max(40).default([]),
}).refine(m => new Set(m.screens.map(s => s.id)).size === m.screens.length, 'Screen IDs must be unique')
  .refine(m => m.targets.every(t => m.screens.slice(0, -1).some(s => s.id === t.screenId)), 'Each target must belong to a screen that has a next screen')
  .refine(m => new Set(m.targets.map(t => t.screenId)).size === m.targets.length, 'Mark at most one target per screen');
export type PrototypeManifest = z.infer<typeof prototypeManifestSchema>;
export type StoredScreen = { id: string; name: string; image: string; width: number; height: number; visibleText?: string };
export type StoredPrototype = { id: string; createdAt: string; name: string; source: PrototypeManifest['source']; device: 'desktop' | 'mobile';
  screens: StoredScreen[]; targets: PrototypeManifest['targets'] };
export class PrototypeError extends Error {}

export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new PrototypeError('Every screen image must be a PNG.');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  if (!width || !height) throw new PrototypeError('A screen image has invalid dimensions.');
  return { width, height };
}
async function loadImage(source: z.infer<typeof imageSourceSchema>, signal?: AbortSignal): Promise<Buffer> {
  if ('path' in source) return readFile(source.path);
  if ('base64' in source) return Buffer.from(source.base64.replace(/^data:image\/png;base64,/, ''), 'base64');
  const url = new URL(source.url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // https for exported asset URLs; http only for a local asset server such as Figma desktop's MCP.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new PrototypeError('Image URLs must use https, or http on localhost.');
  if (url.username || url.password) throw new PrototypeError('Image URLs must not contain credentials.');
  const response = await fetch(url, { signal: signal ?? AbortSignal.timeout(30000), redirect: 'follow' });
  if (!response.ok) throw new PrototypeError(`Could not download a screen image (HTTP ${response.status}).`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_IMAGE_BYTES) throw new PrototypeError('A screen image is larger than 20 MB.');
  return Buffer.from(await response.arrayBuffer());
}

export class Prototypes {
  private recorder: EvidenceRecorder;
  constructor(private root: string) { this.recorder = new EvidenceRecorder(root); }
  private directory(id: string) { return join(this.root, 'prototypes', prototypeIdSchema.parse(id)); }
  async get(id: string): Promise<StoredPrototype> {
    try { return JSON.parse(await readFile(join(this.directory(id), 'prototype.json'), 'utf8')); }
    catch { throw new PrototypeError(`Prototype ${id} is not imported. Use usability_import_prototype first.`); }
  }
  async import(raw: unknown, signal?: AbortSignal): Promise<StoredPrototype> {
    const manifest = prototypeManifestSchema.parse(raw);
    const id = `prototype-${randomUUID()}`;
    const directory = this.directory(id);
    await mkdir(join(directory, 'screens'), { recursive: true, mode: 0o700 });
    const screens: StoredScreen[] = [];
    for (const [index, screen] of manifest.screens.entries()) {
      let png: Buffer;
      try { png = await loadImage(screen.image, signal); }
      catch (error) { throw error instanceof PrototypeError ? error : new PrototypeError(`Could not read the image for screen "${screen.name}".`); }
      if (png.length > MAX_IMAGE_BYTES) throw new PrototypeError('A screen image is larger than 20 MB.');
      const size = pngSize(png);
      const file = join(directory, 'screens', `${String(index + 1).padStart(3, '0')}.png`);
      if ('path' in screen.image) await copyFile(screen.image.path, file); else await writeFile(file, png, { mode: 0o600 });
      screens.push({ id: screen.id, name: screen.name, image: file, ...size, ...(screen.visibleText ? { visibleText: screen.visibleText } : {}) });
    }
    for (const target of manifest.targets) {
      const screen = screens.find(s => s.id === target.screenId)!;
      if (target.x + target.width > screen.width + 1 || target.y + target.height > screen.height + 1) {
        throw new PrototypeError(`The target on screen "${screen.name}" lies outside the frame (${screen.width}×${screen.height}). Use frame pixel coordinates.`);
      }
    }
    const stored: StoredPrototype = { id, createdAt: new Date().toISOString(), name: manifest.name, source: manifest.source, device: manifest.device, screens, targets: manifest.targets };
    await this.recorder.json(join(directory, 'prototype.json'), stored);
    return stored;
  }
}
export function prototypeSummary(p: StoredPrototype) {
  return { prototypeId: p.id, name: p.name, device: p.device, screens: p.screens.map((s, i) => {
    const target = p.targets.find(t => t.screenId === s.id);
    const scoring = target ? `${target.basis}${target.label ? `: ${target.label}` : ''}` : i === p.screens.length - 1 ? 'end of flow' : 'unscored';
    return { step: i + 1, id: s.id, name: s.name, size: `${s.width}×${s.height}`, target: scoring };
  }) };
}
