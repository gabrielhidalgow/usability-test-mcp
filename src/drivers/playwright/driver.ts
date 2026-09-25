import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, devices, type Browser, type BrowserContext, type ElementHandle, type Page } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import type { Capability } from '../../config/schema.js';
import { isContactPath, labelCapabilities, permits, redact, safeLocation } from '../../core/safety.js';
import type { AccessibilityScan, ActionResult, Candidate, EvidenceArtifact, InteractionTarget, PolicyDiagnostic, ProductObservation } from '../../core/types.js';
import { installObserver, showStatus, OBSERVER_SELECTOR } from './observer.js';
import type { ViewStatus, DriverStartConfig, ProductDriver } from '../product-driver.js';

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
  private interactionStarted = false;
  private policyDiagnostics: PolicyDiagnostic[] = [];
  takePolicyDiagnostics(): PolicyDiagnostic[] { return this.policyDiagnostics.splice(0); }
  private dialogs: string[] = [];
  private stopping = false;
  private visible = false;
  private abortListener?: () => void;
  constructor(private readonly headless = true) {}

  async start(config: DriverStartConfig): Promise<void> {
    this.config = config;
    config.signal.throwIfAborted();
    this.abortListener = () => { void this.stop(); };
    config.signal.addEventListener('abort', this.abortListener, { once: true });
    try {
      this.visible = (config.input.presentation ?? (this.headless ? 'background' : 'visible')) === 'visible';
      if (this.visible && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw new Error('Browser display unavailable. Choose presentation=background explicitly, or run on a desktop with a display.');
      this.browser = await chromium.launch({ headless: !this.visible, timeout: 15000 });
      this.browser.on('disconnected', () => { if (!this.stopping && !config.signal.aborted) config.onWindowClosed?.(); });
      config.signal.throwIfAborted();
      this.context = await this.browser.newContext({
        ...(config.input.viewport === 'mobile' ? devices['iPhone 13'] : { viewport: { width: 1280, height: 800 } }),
        acceptDownloads: false, serviceWorkers: 'block', permissions: [],
      });
      // Do not let WebSockets bypass HTTP mutation guards.
      await this.context.routeWebSocket('**/*', socket => socket.close());
      const origin = new URL(config.input.target).origin;
      const blockedUrl = (url: URL, navigation: boolean, readDocument = false): PolicyDiagnostic['reason'] | null => {
        let path = url.pathname;
        try { path = decodeURIComponent(path); } catch { /* Treat malformed escapes literally. */ }
        if (!['http:', 'https:'].includes(url.protocol)) return 'unsupported-protocol';
        if (url.username || url.password) return 'credentialed-url';
        if (navigation && url.origin !== origin) return 'cross-origin-navigation';
        if (labelCapabilities(path.replace(/[-_/]/g, ' ')).some(c => !(c === 'communication' && readDocument && url.origin === origin && isContactPath(url)) && !permits(config.input, c))) return 'capability-denied';
        return null;
      };
      await this.context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method());
        const mainFrameNavigation = request.isNavigationRequest() && request.frame() === this.page?.mainFrame();
        const deny = (reason: PolicyDiagnostic['reason'], phase: PolicyDiagnostic['phase']) => {
          // Timing is not proof of request purpose. Before the first interaction,
          // blocked background fetches can reduce fidelity without ending a readable run.
          // After any interaction, keep mutations fatal, including delayed handlers.
          const requestContext = mainFrameNavigation ? 'main-navigation' : this.interactionStarted ? 'after-interaction' : 'before-first-interaction';
          const stopsJourney = mainFrameNavigation || (mutation && (this.interactionStarted || !['fetch', 'xhr', 'ping'].includes(request.resourceType())));
          this.policyDiagnostics.push({ reason, phase, method: request.method(), resourceType: request.resourceType(), mainFrameNavigation, stopsJourney, requestContext, destination: url.origin === origin ? 'same-origin' : 'cross-origin' });
          if (stopsJourney) this.denied.push(`Session safety policy blocked ${reason} (${phase}).`);
        };
        const reason = blockedUrl(url, request.isNavigationRequest(), mainFrameNavigation && ['GET', 'HEAD'].includes(request.method())) ?? (mutation &&
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
            if (location && response.status() >= 300 && response.status() < 400 && blockedUrl(new URL(location, url), true, mainFrameNavigation && ['GET', 'HEAD'].includes(request.method()))) {
              deny(blockedUrl(new URL(location, url), true, mainFrameNavigation && ['GET', 'HEAD'].includes(request.method()))!, 'redirect');
              await route.abort('blockedbyclient');
            } else await route.fulfill({ response });
            await response.dispose();
          } catch { await route.abort('failed').catch(() => {}); }
        } else await route.continue();
      });
      // Viewer interaction is conservative too. This binding only tightens policy.
      await this.context.exposeBinding('__usabilityInteractionStarted', () => { this.interactionStarted = true; });
      await this.context.addInitScript({ content: `for (const event of ['pointerdown', 'keydown', 'submit']) addEventListener(event, e => { if (e.isTrusted) void globalThis.__usabilityInteractionStarted(); }, true);` });
      this.page = await this.context.newPage();
      this.page.on('close', () => { if (!this.stopping && !config.signal.aborted) config.onWindowClosed?.(); });
      if (this.visible) await installObserver(this.page);
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
    } catch (error) {
      await this.stop();
      config.signal.throwIfAborted();
      if (error instanceof Error && error.message.startsWith('Browser display')) throw error;
      throw new Error('Browser startup or target navigation failed. Install Chromium with npx playwright install chromium and verify the target URL is reachable.');
    }
  }
  async stop(): Promise<void> {
    this.stopping = true;
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
  async setViewStatus(status: ViewStatus) { if (this.visible && this.page) await showStatus(this.page, status); }
  setActionCapability(capability: Capability | null): void { this.activeCapability = capability; }
  async getCurrentLocation(): Promise<string> { return safeLocation(this.currentPage().url()); }
  async screenshot(_label?: string): Promise<EvidenceArtifact> {
    const page = this.currentPage();
    const path = join(this.config!.directory, 'screenshots', `${String(++this.sequence).padStart(4, '0')}.png`);
    await page.screenshot({ path, fullPage: false, timeout: 5000, style: `${OBSERVER_SELECTOR}{visibility:hidden!important}`,
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
    let focusedRef: string | undefined;
    for (const [ref, entry] of this.targets) if (await entry.element.evaluate(e => document.activeElement === e).catch(() => false)) { focusedRef = ref; break; }
    return { focusedRef, tree: [...this.targets.values()].map(t => `${t.candidate.ref}: ${t.candidate.role} "${t.candidate.name}"${t.candidate.disabled ? ' [disabled]' : ''}`).join('\n'),
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
  private async settleVisiblePage(): Promise<NonNullable<ProductObservation['capture']>> {
    // Bounded quiet-window sampling: do not disable animation or wait for network idle.
    const page = this.currentPage();
    return page.evaluate(async () => {
      const start = performance.now();
      const budget = 2000;
      let previous = ''; let quietSince = start;
      while (performance.now() - start < budget) {
        const visible = Array.from(document.querySelectorAll('h1,h2,h3,p,a,button,input,[role]')).filter(node => {
          const r = node.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0;
        }).slice(0, 160);
        const signature = JSON.stringify(visible.map(node => {
          const r = node.getBoundingClientRect(); const s = getComputedStyle(node);
          return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), s.opacity, s.visibility, (node as HTMLElement).innerText?.slice(0, 200)];
        }));
        const finiteAnimations = document.getAnimations().some(a => {
          const target = (a.effect as KeyframeEffect | null)?.target;
          if (!(target instanceof Element) || a.playState !== 'running') return false;
          const r = target.getBoundingClientRect();
          return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && a.effect?.getTiming().iterations !== Infinity;
        });
        const ready = document.readyState !== 'loading' && document.fonts.status === 'loaded';
        if (signature !== previous || finiteAnimations || !ready) quietSince = performance.now();
        previous = signature;
        if (performance.now() - start >= 450 && performance.now() - quietSince >= 300) return { settled: true, waitedMs: Math.round(performance.now() - start), reason: 'Visible layout and finite animations settled' };
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return { settled: false, waitedMs: Math.round(performance.now() - start), reason: 'Capture budget reached; transient content may remain' };
    });
  }
  private async readObservation(): Promise<ProductObservation> {
    const page = this.currentPage();
    const capture = await this.settleVisiblePage();
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
      const href = await element.evaluate(e => e instanceof HTMLAnchorElement && !e.hasAttribute('download') && (!e.target || e.target === '_self') ? e.href : null);
      let contactNavigation = false;
      if (href) { try { const url = new URL(href); contactNavigation = !/\b(send|email|message|invite|subscribe)\b/i.test(data.name) && url.origin === new URL(this.config!.input.target).origin && !url.username && !url.password && isContactPath(url); } catch {} }
      const ref = `o${epoch}-e${this.targets.size + 1}`;
      this.targets.set(ref, { element, candidate: { ref, ...data, contactNavigation, name: redact(data.name) } });
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
      viewport: page.viewportSize()!, capture, screenshot: await this.screenshot(), dialogs: this.dialogs.splice(0) };
  }
  private async perform(operation: () => Promise<unknown>): Promise<ActionResult> {
    this.currentPage(); this.interactionStarted = true; this.denied = [];
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
  async click(target: InteractionTarget): Promise<ActionResult> {
    return this.perform(async () => {
      const element = await this.target(target);
      // Recheck the link at execution time; never grant communication for navigation.
      if (this.targets.get(target.ref)?.candidate.contactNavigation) {
        const href = await element.evaluate(e => e instanceof HTMLAnchorElement && !e.hasAttribute('download') && (!e.target || e.target === '_self') ? e.href : null);
        if (!href || new URL(href).origin !== new URL(this.config!.input.target).origin || !isContactPath(new URL(href))) throw new Error('Navigation target changed');
        this.activeCapability = null;
      }
      if (this.visible) {
        const box = await element.boundingBox();
        const viewport = this.currentPage().viewportSize()!;
        if (box) {
          const x = (Math.max(0, box.x) + Math.min(viewport.width, box.x + box.width)) / 2;
          const y = (Math.max(0, box.y) + Math.min(viewport.height, box.y + box.height)) / 2;
          await this.currentPage().mouse.move(x, y, { steps: 8 });
          await new Promise(resolve => setTimeout(resolve, 200));
          await element.click({ timeout: 15000, position: { x: x - box.x, y: y - box.y } });
          await new Promise(resolve => setTimeout(resolve, 350));
          return;
        }
      }
      await element.click({ timeout: 15000 });
    });
  }
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
  async visibleDiscoveryLinks(): Promise<{ label: string; url: string }[]> {
    const links: { label: string; url: string }[] = [];
    for (const { element, candidate } of this.targets.values()) {
      const href = await element.evaluate(e => e instanceof HTMLAnchorElement && !e.hasAttribute('download') && (!e.target || e.target === '_self') ? e.href : null);
      if (!href) continue;
      const url = new URL(href); const origin = new URL(this.config!.input.target).origin;
      if (url.origin !== origin || url.username || url.password || url.search || /\.(pdf|zip|docx?|xlsx?)$/i.test(url.pathname)) continue;
      if (labelCapabilities(candidate.name).some(c => !(c === 'communication' && isContactPath(url)))) continue;
      links.push({ label: candidate.name, url: url.href });
    }
    return links;
  }
  async visitDiscoveryLink(url: string): Promise<void> {
    if (!(await this.visibleDiscoveryLinks()).some(link => link.url === url)) throw new Error('Discovery requires a currently visible link');
    await this.currentPage().goto(url, { waitUntil: 'domcontentloaded' });
  }
  async returnToDiscoveryStart(): Promise<void> {
    await this.currentPage().goto(this.config!.input.target, { waitUntil: 'domcontentloaded' });
    await this.getObservation();
  }
  async scanAccessibility(step: number, screenshot: string): Promise<AccessibilityScan> {
    try {
      const result = await new AxeBuilder({ page: this.currentPage() }).exclude(OBSERVER_SELECTOR).analyze();
      return { step, screenshot, findings: result.violations.map(v => ({ id: v.id, impact: v.impact ?? null,
        description: v.description, helpUrl: v.helpUrl, targets: v.nodes.map(n => n.target.join(' ')) })) };
    } catch {
      this.config?.signal.throwIfAborted();
      return { step, screenshot, findings: [], error: 'Accessibility scan could not complete for this state.' };
    }
  }
}
