import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { discoveryIdSchema, sessionInputSchema, isHttpUrlWithoutCredentials, type SessionInput } from '../config/schema.js';
import type { ProductObservation } from '../core/types.js';
import { EvidenceRecorder } from '../evidence/recorder.js';
import { PlaywrightProductDriver } from '../drivers/playwright/driver.js';
import { MaestroProductDriver } from '../drivers/maestro/driver.js';
import { safeLocation } from '../core/safety.js';

export const DISCOVERY_NOTICE = 'I reviewed these screens and drafted the answers below. You can edit, replace, or remove any suggestion.';
export const TASK_LIMITS = 'PDF viewing, downloads, popups and external navigation are unsupported. Do not promise a PDF was opened. Propose a supported success criterion or explicitly mark that part untestable. Sending enquiries and submitting forms remain blocked.';
export const discoveryInputSchema = z.discriminatedUnion('platform', [
  z.strictObject({ platform: z.literal('web'), target: z.string().refine(isHttpUrlWithoutCredentials), viewport: z.enum(['desktop', 'mobile']).default('desktop'), presentation: z.enum(['visible', 'background']).optional() }),
  z.strictObject({ platform: z.literal('native'), appId: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/), deviceId: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/), os: z.enum(['ios', 'android']), currentAppConfirmed: z.literal(true), preparedTestDevice: z.literal(true) }),
]);
const suggestion = z.strictObject({ value: z.string().trim().min(1).max(2000), basis: z.enum(['observed', 'assumption']), sources: z.array(z.string().regex(/^screen-[1-4]$/)).min(1).max(4) });
export const suggestionsSchema = z.strictObject({ purpose: suggestion.optional(), audience: suggestion.optional(), success: suggestion.optional(),
  journeys: z.array(suggestion).max(3).default([]) });
export type Discovery = { id: string; platform: 'web' | 'native'; target: string; createdAt: string;
  observations: { id: string; via?: string; observation: ProductObservation }[]; limitations: string[];
  suggestions?: z.infer<typeof suggestionsSchema> };
export class DiscoveryError extends Error {}
export class Discoveries {
  private recorder: EvidenceRecorder;
  constructor(private root: string, private headless: boolean) { this.recorder = new EvidenceRecorder(root); }
  private directory(id: string) { return join(this.root, 'discoveries', discoveryIdSchema.parse(id)); }
  async get(id: string): Promise<Discovery> { return JSON.parse(await readFile(join(this.directory(id), 'discovery.json'), 'utf8')); }
  async saveSuggestions(id: string, raw: unknown) {
    const record = await this.get(id); const suggestions = suggestionsSchema.parse(raw);
    const values = [suggestions.purpose, suggestions.audience, suggestions.success, ...suggestions.journeys].filter(x => x !== undefined);
    if (values.some(v => v.sources.some(source => !record.observations.some(o => o.id === source)))) throw new DiscoveryError('Suggestion sources must reference captured screens.');
    record.suggestions = suggestions;
    await this.recorder.json(join(this.directory(id), 'discovery.json'), record);
    return record;
  }
  async verifyHandoff(input: SessionInput | { target: string; platform: 'web' | 'native'; handoff?: SessionInput['handoff'] }) {
    if (!input.handoff) {
      let ids: string[] = [];
      try { ids = await readdir(join(this.root, 'discoveries')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      for (const id of ids.filter(id => discoveryIdSchema.safeParse(id).success)) {
        let record: Discovery;
        try { record = await this.get(id); } catch { continue; }
        if (record.platform === input.platform && (input.platform === 'web' ? new URL(record.target).origin === new URL(input.target).origin : record.target === input.target)) throw new DiscoveryError(`This product has setup discovery evidence (${id}). Supply handoff with this discoveryId and context=host-reported fresh only from a clean participant context.`);
      }
      return;
    }
    const discovery = await this.get(input.handoff.discoveryId);
    if (input.handoff.context !== 'host-reported fresh') throw new DiscoveryError('Discovery-assisted tests require a fresh participant context. Save the approved plan and start a clean chat or fresh host agent. Freshness is host-reported, not independently verified.');
    if (discovery.platform !== input.platform || (input.platform === 'web' ? new URL(discovery.target).origin !== new URL(input.target).origin : discovery.target !== input.target)) throw new DiscoveryError('Discovery does not match this product.');
    if (input.platform === 'native' && !input.handoff.startingStateConfirmed) throw new DiscoveryError('Confirm the native app is at the intended starting state. App data is not reset or isolated.');
  }
  async capture(raw: unknown, externalSignal?: AbortSignal, nativeFactory = () => new MaestroProductDriver()) {
    const args = discoveryInputSchema.parse(raw);
    const id = `discovery-${randomUUID()}`; const directory = this.directory(id);
    await mkdir(join(directory, 'screenshots'), { recursive: true, mode: 0o700 });
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 60000);
    const signal = AbortSignal.any([controller.signal, ...(externalSignal ? [externalSignal] : [])]);
    const target = args.platform === 'web' ? args.target : args.appId;
    const record: Discovery = { id, platform: args.platform, target: args.platform === 'web' ? safeLocation(target) : target,
      createdAt: new Date().toISOString(), observations: [], limitations: [TASK_LIMITS, 'Setup evidence only. Not a usability participant; never give these screens or suggested routes to a participant.'] };
    const input = sessionInputSchema.parse({ target, platform: args.platform, persona: { name: 'Setup discovery', context: 'Observe visible screens for editable setup suggestions.' }, scenario: 'Setup only', goal: 'Observe visible interface', accessibilityChecks: false,
      ...(args.platform === 'web' ? { viewport: args.viewport, presentation: args.presentation ?? (this.headless ? 'background' : 'visible') } : { native: { deviceId: args.deviceId, os: args.os, preparedTestDevice: true }, testEnvironment: true }) });
    const driver = args.platform === 'web' ? new PlaywrightProductDriver(this.headless) : nativeFactory();
    try {
      const config = { input, directory, signal, onWindowClosed: () => controller.abort() };
      if (driver instanceof MaestroProductDriver) { await driver.startDiscovery(config); record.limitations.push('App identity is supplied by the host, not independently verified. Only the current native screen was captured. No launch, navigation, reset or isolation was performed. Confirm the starting state before testing.'); }
      else await driver.start(config);
      record.observations.push({ id: 'screen-1', observation: await driver.getObservation() });
      if (driver instanceof PlaywrightProductDriver) {
        const links = [...new Map((await driver.visibleDiscoveryLinks()).filter(link => safeLocation(link.url) !== safeLocation(target)).map(link => [safeLocation(link.url), link])).values()].slice(0, 3);
        for (const link of links) {
          if (signal.aborted) break;
          try {
            await driver.returnToDiscoveryStart();
            await driver.visitDiscoveryLink(link.url);
            record.observations.push({ id: `screen-${record.observations.length + 1}`, via: link.label, observation: await driver.getObservation() });
          } catch { record.limitations.push('A linked page could not be observed; suggestions must not assume its content.'); }
        }
        if (driver.takePolicyDiagnostics().length) record.limitations.push('Browser policy restricted some requests. Setup evidence may be incomplete.');
      }
    } catch (error) {
      if (!record.observations.length) throw new DiscoveryError(error instanceof Error && /Browser display|Native setup/.test(error.message) ? error.message : 'Discovery could not capture a screen. Check the target/device or skip scanning and answer setup questions manually.');
      record.limitations.push('Discovery was interrupted; only the saved screens were observed.');
    } finally { clearTimeout(timeout); await driver.stop(); }
    await this.recorder.json(join(directory, 'discovery.json'), record);
    return record;
  }
}
