import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusSchema, focusStartUrl, isInFocus, sessionInputSchema } from '../../src/config/schema.js';
import { planSchema, projectRun, type ProjectProfile } from '../../src/projects/profiles.js';
import { reviewPlanTasks } from '../../src/projects/task-review.js';

const plan = { name: 'Shop', target: 'https://shop.example/', answers: { purpose: 'Shop', audience: 'Buyers', priority: 'Checkout', success: 'Order summary visible', boundaries: 'No orders' },
  personas: [{ id: 'buyer', context: 'Returning buyer' }],
  focusAreas: [{ id: 'checkout', name: 'Checkout', startPath: '/cart', includePaths: ['/cart', '/checkout'] }],
  journeys: [{ id: 'pay', personaIds: ['buyer'], focusAreaId: 'checkout', scenario: 'You are buying a gift because a birthday is next week and want to check delivery costs.', goal: 'Find out the total you would pay including delivery.', successCriteria: ['Total with delivery is visible'] }] };

test('focus paths are same-origin prefixes and never escape the product', () => {
  const focus = focusSchema.parse({ name: 'Checkout', includePaths: ['/checkout', '/cart/'] });
  assert.equal(focus.leaveLimit, 3);
  assert(isInFocus(focus, 'https://shop.example/checkout')); assert(isInFocus(focus, 'https://shop.example/checkout/step-2'));
  assert(isInFocus(focus, 'https://shop.example/cart')); assert(!isInFocus(focus, 'https://shop.example/checkout-help'));
  assert(!isInFocus(focus, 'https://shop.example/')); assert(isInFocus(undefined, 'https://shop.example/anything'));
  const home = focusSchema.parse({ name: 'Home and pricing', includePaths: ['/', '/pricing'] });
  assert(isInFocus(home, 'https://shop.example/')); assert(isInFocus(home, 'https://shop.example/pricing/gold'));
  assert(!isInFocus(home, 'https://shop.example/contact-us'), '"/" means the home page only, not every page');
  for (const bad of ['//evil.example/x', '/\\evil.example', 'https://evil.example/', '/cart?token=1', 'checkout']) assert(!focusSchema.safeParse({ name: 'x', startPath: bad }).success, bad);
  assert.equal(focusStartUrl('https://shop.example/home', focusSchema.parse({ name: 'x', startPath: '/cart' })), 'https://shop.example/cart');
  assert(!sessionInputSchema.safeParse({ platform: 'native', target: 'com.example.app', native: { deviceId: 'emulator-5554', os: 'android', preparedTestDevice: true }, testEnvironment: true, accessibilityChecks: false,
    persona: { context: 'x' }, scenario: 'x', goal: 'y', focus: { name: 'Checkout', includePaths: ['/cart'] } }).success, 'native focus cannot use page paths');
});

test('plans assign one focus area per journey, start there, and old plans still load', () => {
  const parsed = planSchema.parse(plan);
  const legacy = structuredClone(plan) as Record<string, unknown>; delete legacy.focusAreas;
  (legacy.journeys as Record<string, unknown>[])[0]!.focusAreaId = undefined;
  assert(planSchema.safeParse(legacy).success, 'plans saved before focus areas still load');
  assert(!planSchema.safeParse({ ...plan, journeys: [{ ...plan.journeys[0], focusAreaId: 'missing' }] }).success);
  assert(!planSchema.safeParse({ ...plan, focusAreas: [plan.focusAreas[0], plan.focusAreas[0]] }).success);
  const profile: ProjectProfile = { id: 'project-00000000-0000-0000-0000-000000000000', createdAt: '', approvedAt: 'now', plan: parsed };
  const run = projectRun(profile, 'pay', 1);
  assert.equal(run.input.target, 'https://shop.example/cart');
  assert.equal(run.input.focus?.name, 'Checkout'); assert.equal(run.assignment.focusArea, 'checkout');
  assert.deepEqual(reviewPlanTasks(parsed), []);
  const leaky = structuredClone(parsed);
  leaky.journeys[0]!.goal = 'Get to the /checkout total.';
  leaky.journeys.push({ ...leaky.journeys[0]!, id: 'browse', focusAreaId: undefined });
  leaky.focusAreas!.push({ id: 'vague', name: 'Vague area', includePaths: [], leaveLimit: 3 });
  const warnings = reviewPlanTasks(leaky);
  assert(warnings.some(w => /focus path "\/checkout"/.test(w.issue)));
  assert(warnings.some(w => w.journeyId === 'browse' && w.field === 'focusAreaId'));
  assert(warnings.some(w => w.focusAreaId === 'vague' && w.field === 'focusAreas'));
});
