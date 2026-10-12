import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFigmaUrl, planFigmaFlows, FigmaPlanError } from '../../src/prototypes/figma.js';
import { SECTION_XML } from '../fixtures/figma-section.js';

const KEY = 'AbCdEfGhIjKlMnOpQrStUv';
test('plain Figma links of every kind are understood', () => {
  assert.deepEqual(parseFigmaUrl(`https://www.figma.com/design/${KEY}/Onboarding?node-id=10-1&t=x`), { fileKey: KEY, nodeId: '10:1' });
  assert.deepEqual(parseFigmaUrl(`https://www.figma.com/file/${KEY}/Old-style`), { fileKey: KEY });
  assert.deepEqual(parseFigmaUrl(`https://www.figma.com/proto/${KEY}/Flow?node-id=10-2&starting-point-node-id=10%3A2`), { fileKey: KEY, nodeId: '10:2' });
  assert.equal(parseFigmaUrl(`https://www.figma.com/design/${KEY}/branch/BrAnChKeY1234567890abc/Flow`).fileKey, 'BrAnChKeY1234567890abc');
  for (const bad of [`https://www.figma.com/make/${KEY}/x`, `https://www.figma.com/board/${KEY}/x`, 'https://example.com/design/x', 'not a link']) assert.throws(() => parseFigmaUrl(bad), FigmaPlanError);
});

test('a section becomes one ordered flow with frame-relative @tap targets', () => {
  const plan = planFigmaFlows(`https://www.figma.com/design/${KEY}/x?node-id=10-1`, SECTION_XML);
  // Two rows: treated as a board, so the owner is shown the rows and picks the path.
  assert.equal(plan.needsChoice, true);
  assert.deepEqual('rows' in plan && plan.rows?.map(r => r.screens.map(s => s.name)), [['Welcome', 'Plan'], ['Done']]);
  const flow = plan.flows[0]!;
  assert.deepEqual(flow.screens.map(s => s.name), ['Welcome', 'Plan', 'Done'], 'rows top to bottom, left to right');
  assert.deepEqual(flow.targets, [{ screenId: '10:2', x: 150, y: 200, width: 100, height: 40, label: 'Get started', basis: 'owner-marked' }]);
  assert.deepEqual(flow.section, { width: 920, height: 720 });
  // The owner's chosen path, in the owner's order, keeps its targets and costs no extra Figma call.
  const chosen = planFigmaFlows(`https://www.figma.com/design/${KEY}/x?node-id=10-1`, SECTION_XML, ['10-3', '10:2', '10:4']);
  assert.equal(chosen.needsChoice, false);
  assert.deepEqual(chosen.flows[0]!.screens.map(s => s.name), ['Plan', 'Welcome', 'Done']);
  assert.equal(chosen.flows[0]!.targets.length, 1);
  assert.throws(() => planFigmaFlows(`https://www.figma.com/design/${KEY}/x?node-id=10-1`, SECTION_XML, ['10:2', '99:9']), /not a visible screen/);
  // A link to one frame inside the section resolves to the section.
  assert.equal(planFigmaFlows(`https://www.figma.com/design/${KEY}/x?node-id=10-3`, SECTION_XML).flows[0]!.sectionId, '10:1');
});

test('page links list every section; single screens, duplicate targets and empty pages are explained', () => {
  const page = `<canvas id="0:1" name="Page 1" x="0" y="0" width="0" height="0">${SECTION_XML}
    <section id="20:1" name="Checkout" x="0" y="1000" width="900" height="400">
      <frame id="20:2" name="Cart" x="0" y="0" width="400" height="300"><rectangle id="20:5" name="@tap pay" x="1" y="1" width="10" height="10"/><rectangle id="20:6" name="@tap other" x="2" y="2" width="10" height="10"/></frame>
      <frame id="20:3" name="Paid" x="450" y="0" width="400" height="300" />
    </section>
    <frame id="30:1" name="Loose A" x="0" y="2000" width="10" height="10" /><frame id="30:2" name="Loose B" x="20" y="2000" width="10" height="10" />
  </canvas>`;
  const plan = planFigmaFlows(`https://www.figma.com/design/${KEY}/x?node-id=0-1`, page);
  assert.equal(plan.needsChoice, true);
  assert.deepEqual(plan.flows.map(f => f.name), ['Onboarding', 'Checkout']);
  assert(plan.warnings.some(w => /2 @tap layers/.test(w)));
  assert(plan.warnings.some(w => /outside any section/.test(w)));
  assert.throws(() => planFigmaFlows(`https://www.figma.com/design/${KEY}/x?node-id=30-1`, '<frame id="30:1" name="Alone" x="0" y="0" width="10" height="10"/>'), /single screen/);
  assert.throws(() => planFigmaFlows(`https://www.figma.com/design/${KEY}/x`, ''), /empty/);
});
