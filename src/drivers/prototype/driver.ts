import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DriverStartConfig, ProductDriver } from '../product-driver.js';
import type { ActionResult, EvidenceArtifact, ProductObservation } from '../../core/types.js';
import { Prototypes, type StoredPrototype } from '../../prototypes/store.js';

// After this many misses on one screen the facilitator moves the participant on, as Krug suggests when someone is stuck.
export const MISCLICK_LIMIT = 3;
const STATIC_TEXT = 'Static design screen: use the attached image. No hidden layers or route information are supplied.';

/** Static Figma frames shown one at a time. Targets and frame names stay private to the evaluator. */
export class PrototypeProductDriver implements ProductDriver {
  readonly kind = 'prototype' as const;
  readonly limitations = [
    'Static design: no hover, loading, animation, typing or in-frame scrolling. Content may be placeholder.',
    'Single linear flow in the designed order. Taps outside a marked target show nothing; unmarked steps always advance to the next frame.',
    'The participant is an AI reading static images; findings describe how clear the screens and their order are, not interaction polish.',
    'No automated accessibility scan is possible on static images.',
  ];
  private prototype?: StoredPrototype;
  private config?: DriverStartConfig;
  private index = 0;
  private history: number[] = [];
  private misses = 0;
  private sequence = 0;
  constructor(private readonly store: Prototypes) {}
  async start(config: DriverStartConfig): Promise<void> {
    if (config.input.platform !== 'prototype') throw new Error('Prototype driver requires a prototype session.');
    this.config = config; this.prototype = await this.store.get(config.input.target);
  }
  async stop(): Promise<void> {}
  private get screen() { return this.prototype!.screens[this.index]!; }
  async screenshot(): Promise<EvidenceArtifact> {
    const path = join(this.config!.directory, 'screenshots', `${String(++this.sequence).padStart(4, '0')}.png`);
    await copyFile(this.screen.image, path);
    return { path, mimeType: 'image/png' };
  }
  async getObservation(): Promise<ProductObservation> {
    const screenshot = await this.screenshot();
    return { timestamp: new Date().toISOString(), location: `prototype://${this.prototype!.id}/current`, title: '',
      visibleText: this.screen.visibleText ?? STATIC_TEXT, semantics: { tree: '', focused: null }, candidates: [],
      viewport: { width: this.screen.width, height: this.screen.height }, screenshot, dialogs: [] };
  }
  /** Evaluator-side position, never sent to participants. */
  currentScreen() { return { id: this.screen.id, name: this.screen.name, index: this.index }; }
  private advance(): void { this.history.push(this.index); this.index++; this.misses = 0; }
  async tapPoint(x: number, y: number): Promise<ActionResult> {
    const last = this.index === this.prototype!.screens.length - 1;
    const screenId = this.screen.id;
    if (last) return { ok: true, message: 'End of the designed flow: nothing further happens.', prototype: { screenId, target: 'unscored' } };
    const target = this.prototype!.targets.find(t => t.screenId === screenId);
    if (!target) { this.advance(); return { ok: true, message: 'The next screen in the designed flow is shown.', prototype: { screenId, target: 'unscored' } }; }
    const px = x * this.screen.width, py = y * this.screen.height;
    if (px >= target.x && px <= target.x + target.width && py >= target.y && py <= target.y + target.height) {
      this.advance(); return { ok: true, message: 'The next screen is shown.', prototype: { screenId, target: 'hit' } };
    }
    this.misses++;
    if (this.misses >= MISCLICK_LIMIT) {
      this.advance();
      return { ok: true, message: `Nothing happened there. After ${MISCLICK_LIMIT} tries the facilitator moved on to the next screen.`, prototype: { screenId, target: 'miss', movedOn: true } };
    }
    return { ok: true, message: 'Nothing happens when tapping there.', prototype: { screenId, target: 'miss' } };
  }
  async enterText(): Promise<ActionResult> {
    return { ok: false, message: 'Typing is not possible on a static design. Describe what you would type in your commentary, then tap where you would continue.' };
  }
  async goBack(): Promise<ActionResult> {
    const previous = this.history.pop();
    if (previous === undefined) return { ok: false, message: 'This is the first screen of the flow.' };
    this.index = previous; this.misses = 0;
    return { ok: true, message: 'The previous screen is shown.' };
  }
  async scroll(): Promise<ActionResult> { return { ok: true, message: 'The whole screen is already visible.' }; }
  async click(): Promise<ActionResult> { return { ok: false, message: 'Use tap_point with the position on the screen image and the visible label.' }; }
  async tap() { return this.click(); }
  async type() { return this.enterText(); }
  async pressKey(): Promise<ActionResult> { return { ok: false, message: 'Keys are not available on a static design.' }; }
  async getAccessibilitySnapshot() { return null; }
  async getCurrentLocation() { return `prototype://${this.prototype?.id}/current`; }
  async scanAccessibility(step: number, screenshot: string) { return { step, screenshot, findings: [], error: 'Accessibility scanning is not available for static images.' }; }
  setActionCapability(): void {}
}
