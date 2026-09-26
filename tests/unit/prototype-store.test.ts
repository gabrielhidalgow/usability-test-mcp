import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Prototypes, PrototypeError } from '../../src/prototypes/store.js';
import { renderPrototypeFixture } from '../fixtures/prototype.js';

test('prototype import accepts file, base64 and localhost images and rejects bad manifests', async () => {
  const { dir, manifest } = await renderPrototypeFixture();
  const root = await mkdtemp(join(tmpdir(), 'prototype-store-'));
  const png = await readFile(join(dir, 'plan.png'));
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'image/png'); res.end(png); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const store = new Prototypes(root);
    const port = (server.address() as { port: number }).port;
    const mixed = structuredClone(manifest);
    mixed.screens[1]!.image = { url: `http://localhost:${port}/asset.png` } as never;
    mixed.screens[2]!.image = { base64: (await readFile(join(dir, 'done.png'))).toString('base64') } as never;
    const stored = await store.import(mixed);
    assert.equal(stored.screens.length, 3);
    assert.deepEqual([stored.screens[0]!.width, stored.screens[0]!.height], [400, 300]);
    assert.equal((await store.get(stored.id)).targets[0]!.label, 'Get started');
    await writeFile(join(dir, 'fake.png'), 'not a png');
    const bad = (change: (m: typeof manifest) => void) => { const m = structuredClone(manifest); change(m); return m; };
    await assert.rejects(store.import(bad(m => { m.screens[0]!.image = { path: join(dir, 'fake.png') }; })), PrototypeError);
    await assert.rejects(store.import(bad(m => { m.targets[0]!.x = 390; })), /outside the frame/);
    await assert.rejects(store.import(bad(m => { m.targets[0]!.screenId = 'done'; })), 'the last screen has no next screen');
    await assert.rejects(store.import(bad(m => { m.targets.push({ ...m.targets[0]! }); })), 'one target per screen');
    await assert.rejects(store.import(bad(m => { m.screens[1]!.id = 'welcome'; })), 'unique screen IDs');
    await assert.rejects(store.import(bad(m => { m.screens[0]!.image = { url: 'http://example.com/x.png' } as never; })), /https/);
    await assert.rejects(store.get('prototype-00000000-0000-0000-0000-000000000000'), /not imported/);
  } finally { await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true }); await rm(dir, { recursive: true, force: true }); }
});
