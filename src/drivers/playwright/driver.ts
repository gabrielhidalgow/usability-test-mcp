import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, devices, type Browser, type BrowserContext, type ElementHandle, type Page } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import type { Capability } from '../../config/schema.js';
import { labelCapabilities, permits, redact, safeLocation } from '../../core/safety.js';
import type { AccessibilityScan, ActionResult, Candidate, EvidenceArtifact, InteractionTarget, PolicyDiagnostic, ProductObservation } from '../../core/types.js';
import type { DriverStartConfig, ProductDriver } from '../product-driver.js';

type TargetEntry = { element: ElementHandle<Node>; candidate: Candidate };
export class PlaywrightProductDriver implements ProductDriver {
  readonly kind = 'web' as const;
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private config?: DriverStartConfig;
  private targets = new Map<string, TargetEntry>();
  private sequence = 0;
  private observationSequence = 0;
  private activeCapability: Capability | null = null;
  private denied: string[] = [];
  private policyDiagnostics: PolicyDiagnostic[] = [];
  takePolicyDiagnostics(): PolicyDiagnostic[] { return this.policyDiagnostics.splice(0); }
  private dialogs: string[] = [];
  private abortListener?: () => void;
  constructor(private readonly headless = true) {}

  async start(config: DriverStartConfig): Promise<void> {
    this.config = config;
    config.signal.throwIfAborted();
    this.abortListener = () => { void this.stop(); };
    config.signal.addEventListener('abort', this.abortListener, { once: true });
    try {
      this.browser = await chromium.launch({ headless: this.headless, timeout: 15000 });
      config.signal.throwIfAborted();
      this.context = await this.browser.newContext({
        ...(config.input.viewport === 'mobile' ? devices['iPhone 13'] : { viewport: { width: 1280, height: 800 } }),
        acceptDownloads: false, serviceWorkers: 'block', permissions: [],
      });
      // Do not let WebSockets bypass HTTP mutation guards.
      await this.context.routeWebSocket('**/*', socket => socket.close());
      const origin = new URL(config.input.target).origin;
      const blockedUrl = (url: URL, navigation: boolean): PolicyDiagnostic['reason'] | null => {
        let path = url.pathname;
        try { path = decodeURIComponent(path); } catch { /* Treat malformed escapes literally. */ }
        if (!['http:', 'https:'].includes(url.protocol)) return 'unsupported-protocol';
        if (url.username || url.password) return 'credentialed-url';
        if (navigation && url.origin !== origin) return 'cross-origin-navigation';
        if (labelCapabilities(path.replace(/[-_/]/g, ' ')).some(c => !permits(config.input, c))) return 'capability-denied';
        return null;
      };
      await this.context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method());
        const mainFrameNavigation = request.isNavigationRequest() && request.frame() === this.page?.mainFrame();
        const deny = (reason: PolicyDiagnostic['reason'], phase: PolicyDiagnostic['phase']) => {
          // Still block every forbidden request. Only navigations in the tested page
          // and mutations stop the journey; failed assets/frames reduce fidelity.
          const stopsJourney = mainFrameNavigation || mutation;
          this.policyDiagnostics.push({ reason, phase, method: request.method(), resourceType: request.resourceType(), mainFrameNavigation, stopsJourney });
          if (stopsJourney) this.denied.push(`Session safety policy blocked ${reason} (${phase}).`);
        };
        const reason = blockedUrl(url, request.isNavigationRequest()) ?? (mutation &&
          (url.origin !== origin || !this.activeCapability || !permits(config.input, this.activeCapability)) ? 'mutation-denied' : null);
        if (reason) {
          deny(reason, 'request');
          await route.abort('blockedbyclient');
        } else if (request.isNavigationRequest()) {
          // Playwright's continue() may follow redirects without re-running this handler.
          // Fetch no redirects, inspect Location, then let the browser handle the response.
          try {
            const response = await route.fetch({ maxRedirects: 0, timeout: 15000 });
            const location = response.headers()['location'];
            if (location && response.status() >= 300 && response.status() < 400 && blockedUrl(new URL(location, url), true)) {
              deny(blockedUrl(new URL(location, url), true)!, 'redirect');
              await route.abort('blockedbyclient');
            } else await route.fulfill({ response });
            await response.dispose();
          } catch { await route.abort('failed').catch(() => {}); }
        } else await route.continue();
      });
      this.page = await this.context.newPage();
      this.page.on('popup', popup => { void popup.close(); });
      this.page.on('dialog', dialog => {
        this.dialogs.push(redact(dialog.message()));
        void dialog.dismiss().catch(() => {});
      });
      this.page.on('download', download => { void download.cancel(); });
      this.page.setDefaultTimeout(5000);
      this.page.setDefaultNavigationTimeout(15000);
      await this.page.goto(config.input.target, { waitUntil: 'domcontentloaded' });
      config.signal.throwIfAborted();
    } catch {
      await this.stop();
      config.signal.throwIfAborted();
      throw new Error('Browser startup or target navigation failed. Install Chromium with npx playwright install chromium and verify the target URL is reachable.');
    }
  }
  async stop(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    await browser?.close().catch(() => {});
    if (this.config && this.abortListener) this.config.signal.removeEventListener('abort', this.abortListener);
    this.targets.clear();
  }
  private currentPage(): Page {
    this.config?.signal.throwIfAborted();
    if (!this.page || this.page.isClosed()) throw new Error('Browser is not available');
    return this.page;
  }
  setActionCapability(capability: Capability | null): void { this.activeCapability = capability; }
  async getCurrentLocation(): Promise<string> { return safeLocation(this.currentPage().url()); }
  async screenshot(_label?: string): Promise<EvidenceArtifact> {
    const page = this.currentPage();
    const path = join(this.config!.directory, 'screenshots', `${String(++this.sequence).padStart(4, '0')}.png`);
    await page.screenshot({ path, fullPage: false, timeout: 5000,
      mask: [page.locator('input[type="password"], input[autocomplete="cc-number"], input[autocomplete="cc-csc"]')] });
    await chmod(path, 0o600);
    return { path, mimeType: 'image/png' };
  }
  async getAccessibilitySnapshot() {
    const page = this.currentPage();
    const focused = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      if (!e || e === document.body) return null;
      const labels = 'labels' in e ? Array.from((e as HTMLInputElement).labels ?? []).map(l => l.innerText).join(' ') : '';
      return `${e.getAttribute('role') || e.tagName.toLowerCase()}: ${e.getAttribute('aria-label') || labels || e.innerText || e.getAttribute('placeholder') || '(unlabeled)'}`;
    });
    return { tree: [...this.targets.values()].map(t => `${t.candidate.ref}: ${t.candidate.role} "${t.candidate.name}"${t.candidate.disabled ? ' [disabled]' : ''}`).join('\n'),
      focused: focused ? redact(focused).slice(0, 1000) : null };
  }
  async getObservation(): Promise<ProductObservation> {
    // A timed-out action can still have a navigation in flight. Retry observation,
    // never the action, when the old document is replaced during collection.
    for (let attempt = 0; ; attempt++) {
      try { return await this.readObservation(); }
      catch (error) {
        if (attempt >= 2 || !(error instanceof Error) || !/Execution context was destroyed|Cannot find context/.test(error.message)) throw error;
        await this.currentPage().waitForLoadState('domcontentloaded', { timeout: 15000 });
      }
    }
  }
  private async readObservation(): Promise<ProductObservation> {
    const page = this.currentPage();
    for (const { element } of this.targets.values()) await element.dispose().catch(() => {});
    this.targets.clear();
    const epoch = ++this.observationSequence;
    const handles = await page.locator('a,button,input:not([type="hidden"]),select,textarea,[role],[tabindex],[contenteditable="true"]').elementHandles();
    for (const element of handles) {
      const data = await element.evaluate(e => {
        const node = e as HTMLElement;
        const bounds = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || node.closest('[aria-hidden="true"], [inert]') ||
          style.visibility === 'hidden' || bounds.width <= 0 || bounds.height <= 0 || bounds.bottom <= 0 || bounds.right <= 0 || bounds.top >= innerHeight || bounds.left >= innerWidth) return null;
        const tag = node.tagName.toLowerCase();
        const role = node.getAttribute('role') || ({ a: 'link', button: 'button', input: 'textbox', select: 'combobox', textarea: 'textbox' } as Record<string, string>)[tag] || 'control';
        const input = node as HTMLInputElement;
        const labels = 'labels' in node ? Array.from(input.labels ?? []).map(l => l.innerText).join(' ') : '';
        const labelledBy = (node.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
          .map(id => document.getElementById(id)?.textContent ?? '').join(' ');
        const name = node.getAttribute('aria-label') || labelledBy || labels || node.innerText || node.getAttribute('placeholder') ||
          (tag === 'input' && ['submit', 'button'].includes(input.type) ? input.value : '') || node.getAttribute('title') || '(unlabeled)';
        return { role, name: name.trim().slice(0, 300), disabled: node.matches(':disabled,[aria-disabled="true"]'),
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
      }).catch(() => null);
      if (!data || this.targets.size >= 150) { await element.dispose(); continue; }
      const ref = `o${epoch}-e${this.targets.size + 1}`;
      this.targets.set(ref, { element, candidate: { ref, ...data, name: redact(data.name) } });
    }
    const visibleText = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const text: string[] = [];
      let node: Node | null;
      while ((node = walker.nextNode()) && text.join(' ').length < 16000) {
        const el = node.parentElement;
        if (!el || el.closest('script,style,noscript,[hidden],[aria-hidden="true"],input,textarea') ||
          !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) {
          const value = node.textContent?.replace(/\s+/g, ' ').trim(); if (value) text.push(value);
        }
      }
      return text.join('\n').slice(0, 16000);
    });
    return { timestamp: new Date().toISOString(), location: await this.getCurrentLocation(), title: redact(await page.title()),
      visibleText: redact(visibleText), semantics: await this.getAccessibilitySnapshot(),
      candidates: [...this.targets.values()].map(t => t.candidate),
      viewport: page.viewportSize()!, screenshot: await this.screenshot(), dialogs: this.dialogs.splice(0) };
  }
  private async perform(operation: () => Promise<unknown>): Promise<ActionResult> {
    this.currentPage(); this.denied = [];
    try {
      await operation();
      // A frame lets client-side event handlers update visible state; no network-idle dependency.
      await this.currentPage().evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      if (this.denied.length) return { ok: false, blocked: true, message: this.denied[0]! };
      return { ok: true, message: 'Action executed; inspect the resulting interface for its effect' };
    } catch {
      this.config?.signal.throwIfAborted();
      return { ok: false, blocked: this.denied.length > 0, message: this.denied[0] ?? 'Action failed or the visible target changed; inspect the next observation' };
    }
  }
  private async target(target: InteractionTarget): Promise<ElementHandle<Node>> {
    const entry = this.targets.get(target.ref);
    if (!entry || !await entry.element.isVisible()) throw new Error('Stale or invisible target');
    const bounds = await entry.element.boundingBox();
    const viewport = this.currentPage().viewportSize()!;
    if (!bounds || bounds.x >= viewport.width || bounds.y >= viewport.height || bounds.x + bounds.width <= 0 || bounds.y + bounds.height <= 0) throw new Error('Target left viewport');
    return entry.element;
  }
  async click(target: InteractionTarget): Promise<ActionResult> { return this.perform(async () => (await this.target(target)).click({ timeout: 15000 })); }
  async tap(target: InteractionTarget): Promise<ActionResult> { return this.click(target); }
  async type(target: InteractionTarget, value: string): Promise<ActionResult> {
    return this.perform(async () => {
      const element = await this.target(target);
      const sensitive = await element.evaluate(e => (e as HTMLInputElement).type === 'password' || /cc-|password/.test((e as Element).getAttribute('autocomplete') ?? ''));
      if (sensitive) throw new Error('Sensitive field');
      if (this.config!.input.interactionMode === 'keyboard') {
        if (!await element.evaluate(e => document.activeElement === e)) throw new Error('Keyboard typing requires focus on the target');
        await this.currentPage().keyboard.insertText(value);
      } else await element.fill(value, { timeout: 5000 });
    });
  }
  async scroll(direction: 'up' | 'down' | 'left' | 'right'): Promise<ActionResult> {
    return this.perform(() => this.currentPage().mouse.wheel(
      direction === 'left' ? -500 : direction === 'right' ? 500 : 0,
      direction === 'up' ? -500 : direction === 'down' ? 500 : 0));
  }
  async pressKey(key: string): Promise<ActionResult> { return this.perform(() => this.currentPage().keyboard.press(key)); }
  async goBack(): Promise<ActionResult> { return this.perform(() => this.currentPage().goBack({ waitUntil: 'domcontentloaded' })); }
  async scanAccessibility(step: number, screenshot: string): Promise<AccessibilityScan> {
    try {
      const result = await new AxeBuilder({ page: this.currentPage() }).analyze();
      return { step, screenshot, findings: result.violations.map(v => ({ id: v.id, impact: v.impact ?? null,
        description: v.description, helpUrl: v.helpUrl, targets: v.nodes.map(n => n.target.join(' ')) })) };
    } catch {
      this.config?.signal.throwIfAborted();
      return { step, screenshot, findings: [], error: 'Accessibility scan could not complete for this state.' };
    }
  }
}
