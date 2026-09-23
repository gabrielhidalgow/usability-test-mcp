import type { Page } from 'playwright';
import type { ViewStatus } from '../product-driver.js';
export const OBSERVER_SELECTOR = '[data-usability-observer]';
export async function installObserver(page: Page) {
  await page.addInitScript({ content: String.raw`(() => {
    const mount = () => {
      if (document.querySelector('[data-usability-observer]')) return;
      const host = document.createElement('div'); host.setAttribute('data-usability-observer', '');
      host.setAttribute('aria-hidden', 'true'); host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
      const shadow = host.attachShadow({ mode: 'closed' });
      const badge = document.createElement('div');
      badge.style.cssText = 'position:fixed;bottom:12px;left:12px;max-width:340px;padding:10px 14px;background:#132233;color:white;border-radius:10px;font:13px/1.5 system-ui;box-shadow:0 2px 12px #0005;white-space:pre-line';
      badge.textContent = 'Usability Test MCP\nPreparing — watch without interacting';
      const pointer = document.createElement('div');
      pointer.style.cssText = 'position:fixed;width:24px;height:24px;border:3px solid #ffb000;background:#ffb00033;border-radius:50%;transform:translate(-50%,-50%);display:none;box-sizing:border-box';
      shadow.append(badge, pointer); document.documentElement.append(host);
      document.addEventListener('mousemove', event => { pointer.style.left = event.clientX + 'px'; pointer.style.top = event.clientY + 'px'; pointer.style.display = 'block'; }, true);
      document.addEventListener('mousedown', () => { pointer.style.background = '#ffb000aa'; setTimeout(() => { pointer.style.background = '#ffb00033'; }, 350); }, true);
      window.__usabilityObserver = text => { badge.textContent = text; };
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
  })();` });
}
export async function showStatus(page: Page, status: ViewStatus) {
  const phases = { waiting: 'Waiting for AI decision', planned: 'Next action (not executed)', executing: 'Executing', completed: 'Action returned — inspect result', finished: 'Journey finished' };
  const text = `Usability Test MCP · ${status.participant.slice(0, 60)} · Step ${status.step}\n${phases[status.phase]}${status.action ? `: ${status.action}` : ''}\nWatch without interacting; close window to cancel`;
  await page.evaluate(text => {
    (window as unknown as { __usabilityObserver?: (text: string) => void }).__usabilityObserver?.(text);
  }, text).catch(() => {});
}
