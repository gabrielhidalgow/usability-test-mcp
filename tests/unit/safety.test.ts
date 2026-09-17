import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, sessionInputSchema } from '../../src/config/schema.js';
import { guardAction, redact, safeLocation } from '../../src/core/safety.js';
import type { ProductObservation } from '../../src/core/types.js';
import { artifactIdSchema } from '../../src/evidence/recorder.js';

const base = { target: 'http://localhost:3000', persona: { context: 'First-time visitor' }, scenario: 'Explore', goal: 'Find plans' };
const observation: ProductObservation = { timestamp: '', location: base.target, title: 'Fixture', visibleText: '',
  viewport: { width: 1280, height: 800 }, screenshot: { path: '/tmp/test.png', mimeType: 'image/png' },
  semantics: { tree: '', focused: 'button: Delete records' }, dialogs: [], candidates: [
    { ref: 'o1-e1', role: 'button', name: 'Delete records', disabled: false, bounds: { x: 0, y: 0, width: 100, height: 40 } },
  ] };

test('configuration requires no AI credentials and ignores existing provider environment values', () => {
  const plain = readConfig({});
  const withProviderEnvironment = readConfig({ OPENAI_API_KEY: 'unused-private-value', OPENAI_MODEL: 'unused-model' });
  assert.deepEqual(plain, withProviderEnvironment);
  assert(!JSON.stringify(withProviderEnvironment).includes('unused-private-value'));
});

test('strict input rejects unknown fields, non-web targets, untrusted capability overrides', () => {
  assert.throws(() => sessionInputSchema.parse({ ...base, target: 'file:///etc/passwd' }));
  assert.throws(() => sessionInputSchema.parse({ ...base, target: 'http://user:pass@localhost' }));
  assert.throws(() => sessionInputSchema.parse({ ...base, route: ['secret'] }));
  assert.throws(() => sessionInputSchema.parse({ ...base, allowedCapabilities: ['deletion'] }));
  assert.throws(() => sessionInputSchema.parse({ ...base, maxActions: 0 }));
  assert.equal(sessionInputSchema.parse(base).maxActions, 30);
});
test('visible labels and keyboard focus prevent model from misclassifying destruction', () => {
  const input = sessionInputSchema.parse(base);
  assert.match(guardAction({ type: 'click', target: 'o1-e1', capability: null }, observation, input)!, /deletion/);
  assert.match(guardAction({ type: 'key', key: 'Enter', capability: null }, observation, input)!, /deletion/);
  assert.match(guardAction({ type: 'click', target: 'stale', capability: null }, observation, input)!, /current visible/);
  const allowed = sessionInputSchema.parse({ ...base, testEnvironment: true, allowedCapabilities: ['deletion'] });
  assert.equal(guardAction({ type: 'click', target: 'o1-e1', capability: 'deletion' }, observation, allowed), null);
});
test('artifact IDs reject path traversal and common log secrets are redacted', () => {
  assert.throws(() => artifactIdSchema.parse('../../.env'));
  assert.equal(safeLocation('https://a:b@example.com/path?token=secret#secret'), 'https://example.com/path');
  assert(!redact('Bearer abc123 api_key=secret sk-foobar').includes('abc123'));
  assert(!redact('api_key=secret').includes('=secret'));
});
