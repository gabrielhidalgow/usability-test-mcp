import { spawn } from 'node:child_process';
import { chmod, copyFile, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DriverStartConfig, ProductDriver } from '../product-driver.js';
import type { ActionResult, EvidenceArtifact, ProductObservation } from '../../core/types.js';

export type MaestroRunner = (args: string[], cwd: string, signal: AbortSignal) => Promise<void>;
export const runMaestro: MaestroRunner = (args, cwd, signal) => new Promise((resolve, reject) => {
  signal.throwIfAborted();
  const child = spawn('maestro', args, { cwd, stdio: 'ignore', detached: process.platform !== 'win32' });
  const kill = () => { if (child.pid) { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch { /* Process already exited. */ } } };
  const timer = setTimeout(kill, 45000);
  signal.addEventListener('abort', kill, { once: true });
  const done = (error?: Error) => { clearTimeout(timer); signal.removeEventListener('abort', kill); error ? reject(error) : resolve(); };
  child.once('error', () => done(new Error('Native setup: Maestro unavailable. Install Maestro and its Java runtime, then run usability-test-mcp doctor --native.')));
  child.once('exit', code => code === 0 && !signal.aborted ? done() : done(new Error('Maestro command failed or was cancelled. Check the selected test device and installed app; no action was retried.')));
});
const devicesInUse = new Set<string>();
export class MaestroProductDriver implements ProductDriver {
  readonly kind = 'mobile' as const;
  readonly limitations = [
    'EXPERIMENTAL native driver: device integration has not been validated on every platform. Uses screenshots, not app source or hidden view IDs.',
    'Native device/app data is not reset or isolated; use a prepared disposable test emulator/simulator. Device use is exclusive only within this server process.',
    'Native actions have no HTTP interception or independent verification of labels. App/network side effects cannot be prevented by browser policy; only use a sandbox app with fake data.',
    'App permissions are denied at launch on the prepared test device; permission-dependent journeys may be blocked.',
    'Native screenshots are not automatically masked. No axe, native accessibility or screen-reader compliance audit is performed.',
  ];
  private config?: DriverStartConfig;
  private ownedDevice?: string;
  private sequence = 0;
  constructor(private runner: MaestroRunner = runMaestro) {}
  private async flow(commands: (Record<string, unknown> | string)[]): Promise<void> {
    const config = this.config!;
    config.signal.throwIfAborted();
    const path = join(config.directory, `flow-${randomUUID()}.yaml`);
    // JSON strings and objects are valid YAML; no arbitrary flow text or selectors.
    const content = `appId: ${JSON.stringify(config.input.target)}\n---\n${commands.map(c => `- ${JSON.stringify(c)}`).join('\n')}\n`;
    await writeFile(path, content, { mode: 0o600 });
    try {
      await this.runner(['--device', config.input.native!.deviceId, '--platform', config.input.native!.os, 'test', '--test-output-dir', config.directory, path], config.directory, config.signal);
    } finally { await rm(path, { force: true }); }
  }
  private claim(config: DriverStartConfig): void {
    if (config.input.platform !== 'native' || !config.input.native?.preparedTestDevice || !config.input.testEnvironment) throw new Error('Native tests require a prepared test device.');
    const device = config.input.native.deviceId;
    if (devicesInUse.has(device)) throw new Error('This native device already has an active session.');
    devicesInUse.add(device); this.ownedDevice = device; this.config = config;
  }
  async startDiscovery(config: DriverStartConfig): Promise<void> { this.claim(config); }
  async start(config: DriverStartConfig): Promise<void> {
    this.claim(config);
    await this.flow([{ launchApp: { clearState: false, stopApp: false, permissions: { all: 'deny' } } }]);
  }
  async stop() { if (this.ownedDevice) devicesInUse.delete(this.ownedDevice); this.ownedDevice = undefined; }
  async screenshot(): Promise<EvidenceArtifact> {
    const path = join(this.config!.directory, 'screenshots', `${String(++this.sequence).padStart(4, '0')}.png`);
    const name = `capture-${randomUUID()}`;
    await this.flow([{ takeScreenshot: { path: name } }]);
    const files = await readdir(this.config!.directory, { recursive: true });
    const generated = files.find(file => file === `${name}.png` || file.endsWith(`/${name}.png`));
    if (!generated) throw new Error('Maestro did not produce the expected screenshot artifact.');
    await copyFile(join(this.config!.directory, generated), path);
    await chmod(path, 0o600);
    return { path, mimeType: 'image/png' };
  }
  async getObservation(): Promise<ProductObservation> {
    const screenshot = await this.screenshot();
    const png = await readFile(screenshot.path);
    if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Native screenshot is not a PNG');
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    if (!width || !height) throw new Error('Invalid screenshot dimensions');
    return { timestamp: new Date().toISOString(), location: this.config!.input.target, title: this.config!.input.target,
      visibleText: 'Native screen: use the attached screenshot. No OCR or hidden view hierarchy is supplied.',
      semantics: { tree: '', focused: null }, candidates: [], viewport: { width, height }, screenshot, dialogs: [] };
  }
  private async action(commands: (Record<string, unknown> | string)[]): Promise<ActionResult> {
    await this.flow(commands);
    return { ok: true, message: 'Native command executed once; inspect the next screenshot for its effect.' };
  }
  async tapPoint(x: number, y: number) { return this.action([{ tapOn: { point: `${(x * 100).toFixed(3)}%,${(y * 100).toFixed(3)}%`, retryTapIfNoChange: false } }]); }
  async enterText(value: string) { if (value.includes('${')) throw new Error('Expressions are not allowed'); return this.action([{ inputText: value }]); }
  async scroll(direction: 'up' | 'down' | 'left' | 'right') {
    // Content scrolling direction is opposite to the finger movement.
    const swipe = { down: ['50%,80%', '50%,25%'], up: ['50%,25%', '50%,80%'], left: ['25%,50%', '80%,50%'], right: ['80%,50%', '25%,50%'] }[direction];
    return this.action([{ swipe: { start: swipe[0], end: swipe[1], duration: 400 } }]);
  }
  async goBack() { if (this.config!.input.native!.os === 'ios') return { ok: false, message: 'iOS has no universal back action; tap the visible back control.' }; return this.action(['back']); }
  async click(): Promise<ActionResult> { return { ok: false, message: 'Use tap_point with screenshot-relative coordinates and the visible label.' }; }
  async tap() { return this.click(); }
  async type() { return this.click(); }
  async pressKey(): Promise<ActionResult> { return { ok: false, message: 'Native keyboard shortcuts are unsupported. Use enter_text after focusing a visible non-sensitive field.' }; }
  async getAccessibilitySnapshot() { return null; }
  async getCurrentLocation() { return this.config!.input.target; }
  async scanAccessibility(step: number, screenshot: string) { return { step, screenshot, findings: [], error: 'Native accessibility scanning is not implemented.' }; }
  setActionCapability(): void {}
}
