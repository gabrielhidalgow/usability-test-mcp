import type { z } from 'zod';
import type { planSchema } from './profiles.js';
import type { Discovery } from './discovery.js';

type Plan = z.infer<typeof planSchema>;
export type TaskWarning = { journeyId?: string; focusAreaId?: string; field: 'scenario' | 'goal' | 'successCriteria' | 'personaIds' | 'focusAreaId' | 'focusAreas';
  principleId: 'realistic-tasks' | 'neutral-facilitation'; issue: string; suggestion: string };

const ROUTE_WORDS = /\b(click|tap|press|select|navigate|go to|open the|menu|tab|button|link|dropdown|breadcrumb|sidebar|header|footer|scroll)\b/i;
const PATH = /https?:\/\/|(?:^|\s)\/[a-z0-9][\w-]*/i;
const SEQUENCE = /\b(then|after that|first,|next,|followed by)\b/i;
const QUOTED = /["“‘]([^"”’]{2,60})["”’]/;
const UNOBSERVABLE = /\b(understands?|feels?|likes?|enjoys?|satisf\w*|trusts?|confident|easy|intuitive|happy|loves?)\b/i;
const UNSUPPORTED = /\b(pdf|download|data ?sheet|brochure|app store|phone call|send (?:an )?email)\b/i;
const MOTIVE = /\b(because|so that|need|needs|want|wants|looking|planning|trying|considering|deciding|preparing|comparing|for your|for their)\b/i;
// Everyday words a participant might use naturally even when they are also on-screen labels.
const GENERIC = new Set(['home', 'about', 'menu', 'search', 'contact', 'close', 'open', 'more', 'next', 'back', 'skip', 'login', 'log in', 'sign in', 'help']);

function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Advisory review of task wording (Krug: realistic tasks that do not give away the answer). Never mutates the plan. */
export function reviewPlanTasks(plan: Plan, discovery?: Pick<Discovery, 'observations'>): TaskWarning[] {
  const warnings: TaskWarning[] = [];
  const labels = [...new Set((discovery?.observations ?? []).flatMap(o => o.observation.candidates.map(c => c.name.replace(/\s+/g, ' ').trim())))]
    .filter(label => label.length >= 4 && label.length <= 60 && !GENERIC.has(label.toLowerCase()));
  for (const journey of plan.journeys) {
    for (const field of ['scenario', 'goal'] as const) {
      const value = journey[field];
      if (ROUTE_WORDS.test(value)) warnings.push({ journeyId: journey.id, field, principleId: 'realistic-tasks',
        issue: `Mentions interface mechanics ("${value.match(ROUTE_WORDS)![0]}"), which can reveal the route.`,
        suggestion: 'Describe the outcome the person wants in their own words, not where to click.' });
      if (PATH.test(value)) warnings.push({ journeyId: journey.id, field, principleId: 'realistic-tasks',
        issue: 'Contains a URL or path, which gives away the destination.', suggestion: 'Remove the address; the participant starts at the target URL.' });
      if (field === 'goal' && SEQUENCE.test(value)) warnings.push({ journeyId: journey.id, field, principleId: 'realistic-tasks',
        issue: 'Reads as a sequence of steps rather than an outcome.', suggestion: 'State the end result only and let the participant find the steps.' });
      const quoted = value.match(QUOTED);
      if (quoted) warnings.push({ journeyId: journey.id, field, principleId: 'realistic-tasks',
        issue: `Quotes "${quoted[1]}", which may be an on-screen label.`, suggestion: 'Paraphrase in the user’s own words unless the term is how real users describe their need.' });
      for (const label of labels) {
        if (new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(label)}($|[^\\p{L}\\p{N}])`, 'iu').test(value)) warnings.push({ journeyId: journey.id, field, principleId: 'realistic-tasks',
          issue: `Uses the visible control label "${label}" captured during setup discovery.`, suggestion: 'Use the words a real visitor would use for this need; keep the label only if it is also their natural term.' });
      }
      if (UNSUPPORTED.test(value)) warnings.push({ journeyId: journey.id, field, principleId: 'realistic-tasks',
        issue: 'Depends on a PDF, download, external app or real communication, which the browser cannot complete.',
        suggestion: 'End the task at locating the entry point (for example, finding the data-sheet link), or mark that part untestable.' });
    }
    if (journey.scenario.trim().split(/\s+/).length < 6 || !MOTIVE.test(journey.scenario)) warnings.push({ journeyId: journey.id, field: 'scenario', principleId: 'realistic-tasks',
      issue: 'The scenario gives little reason for the visit.', suggestion: 'Add a plausible motivation, for example what situation brought the person here.' });
    journey.successCriteria.forEach((criterion, i) => {
      if (UNOBSERVABLE.test(criterion)) warnings.push({ journeyId: journey.id, field: 'successCriteria', principleId: 'realistic-tasks',
        issue: `Criterion ${i + 1} ("${criterion.slice(0, 80)}") describes an internal state that screenshots cannot show.`,
        suggestion: 'Rewrite as visible evidence, for example "the price for the chosen plan is on screen".' });
      if (UNSUPPORTED.test(criterion)) warnings.push({ journeyId: journey.id, field: 'successCriteria', principleId: 'realistic-tasks',
        issue: `Criterion ${i + 1} needs a PDF, download or external step the browser cannot complete.`, suggestion: 'Use a visible in-browser outcome instead, or mark it untestable.' });
    });
    const focus = journey.focusAreaId ? plan.focusAreas?.find(f => f.id === journey.focusAreaId) : undefined;
    if (plan.focusAreas?.length && !journey.focusAreaId) warnings.push({ journeyId: journey.id, field: 'focusAreaId', principleId: 'realistic-tasks',
      issue: 'The plan has focus areas but this journey has none, so it will start on the home page and cover the whole site.', suggestion: 'Assign a focusAreaId, or confirm this journey is meant to be unfocused.' });
    for (const path of focus ? [focus.startPath, ...focus.includePaths].filter((x): x is string => Boolean(x) && x !== '/') : []) {
      for (const field of ['scenario', 'goal'] as const) if (journey[field].toLowerCase().includes(path.toLowerCase())) warnings.push({ journeyId: journey.id, focusAreaId: focus!.id, field, principleId: 'realistic-tasks',
        issue: `Mentions the focus path "${path}". The participant already starts there; naming it gives away the route.`, suggestion: 'Describe the goal in the user’s words; the focus area controls where the test starts and what is in scope.' });
    }
    if (plan.personas.length > 1 && !journey.personaIds) warnings.push({ journeyId: journey.id, field: 'personaIds', principleId: 'neutral-facilitation',
      issue: 'Several profiles exist but this journey does not say which ones it is for.', suggestion: 'Assign stable persona IDs so the right audience attempts this task.' });
  }
  for (const area of plan.focusAreas ?? []) {
    if (plan.platform !== 'native' && !area.startPath && !area.includePaths.length) warnings.push({ focusAreaId: area.id, field: 'focusAreas', principleId: 'realistic-tasks',
      issue: `Focus area "${area.name}" has no start page or in-scope paths, so the test cannot start there or tell when a participant leaves it.`,
      suggestion: 'Add startPath (where the participant begins) and includePaths (page prefixes that count as inside), for example /checkout.' });
  }
  return warnings;
}
export const TASK_REVIEW_INSTRUCTIONS = 'Advisory task review (methodology principle realistic-tasks). Show each warning to the owner with a proposed rewording and ask whether to change it. Never silently rewrite a plan; edits create a new draft that needs approval. An empty list does not prove the tasks are unbiased.';
