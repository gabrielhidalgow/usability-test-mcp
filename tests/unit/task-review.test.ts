import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewPlanTasks } from '../../src/projects/task-review.js';
import { planSchema } from '../../src/projects/profiles.js';
import type { ProductObservation } from '../../src/core/types.js';

const base = planSchema.parse({ name: 'Ledger', target: 'https://example.com/',
  answers: { purpose: 'Accounting', audience: 'Owners', priority: 'Pricing', success: 'Price visible', boundaries: 'Read only' },
  personas: [{ id: 'owner', context: 'Small business owner' }],
  journeys: [{ id: 'price', scenario: 'You run a small café and are comparing accounting tools because tax season is close.', goal: 'Find out what it would cost each month for your business.', successCriteria: ['The monthly price for a suitable plan is visible'] }] });

test('neutral tasks pass and route-revealing wording is flagged without changing the plan', () => {
  assert.deepEqual(reviewPlanTasks(base), []);
  const leading = structuredClone(base);
  leading.journeys[0]!.goal = 'Click "Options" in the menu, then go to /plans and read the price.';
  leading.journeys[0]!.scenario = 'Pricing check.';
  leading.journeys[0]!.successCriteria = ['The visitor understands the pricing', 'The data sheet PDF is downloaded'];
  const snapshot = JSON.stringify(leading);
  const warnings = reviewPlanTasks(leading);
  const issues = warnings.map(w => w.issue).join('\n');
  assert.match(issues, /interface mechanics/); assert.match(issues, /URL or path/); assert.match(issues, /sequence of steps/);
  assert.match(issues, /Quotes "Options"/); assert.match(issues, /little reason/);
  assert.match(issues, /internal state/); assert.match(issues, /PDF, download/);
  assert(warnings.every(w => w.principleId && w.suggestion && w.journeyId === 'price'));
  assert.equal(JSON.stringify(leading), snapshot, 'Task review is advisory and must not mutate the plan');
});

test('discovery labels, unassigned multi-profile journeys and generic words are handled', () => {
  const observation = { candidates: [{ ref: 'a', role: 'link', name: 'Solutions Hub', disabled: false, bounds: { x: 0, y: 0, width: 1, height: 1 } },
    { ref: 'b', role: 'link', name: 'Home', disabled: false, bounds: { x: 0, y: 0, width: 1, height: 1 } }] } as unknown as ProductObservation;
  const plan = structuredClone(base);
  plan.journeys[0]!.goal = 'Use the solutions hub to find a plan that fits, then return home.';
  plan.personas.push({ ...plan.personas[0]!, id: 'accountant' });
  delete plan.journeys[0]!.personaIds;
  const warnings = reviewPlanTasks(plan, { observations: [{ id: 'screen-1', observation }] });
  assert(warnings.some(w => /visible control label "Solutions Hub"/.test(w.issue)));
  assert(!warnings.some(w => /label "Home"/.test(w.issue)), 'Everyday words are not flagged as labels');
  assert(warnings.some(w => w.field === 'personaIds'));
});
