import type { JourneyStep, SuggestedChange } from './types.js';

export const CHANGE_INSTRUCTIONS = 'For actionable fixes include suggestedChange: kind (copy/design/interaction), exact screen or control location, a concrete proposal, and an observable retest check in verify. Prefer precise layout/behaviour changes or proposed replacement wording over vague advice such as improve clarity. Optional replacement.before must quote visible text from the cited steps; replacement.after is proposed wording, not an observed result. Do not invent product promises, clinical claims, prices, implementation effort or owners. Omit replacement when exact current wording is unavailable. Keep titles short and recommendations concise. A recommendation is a hypothesis to test, not a guaranteed improvement.';
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
export function isGroundedChange(change: SuggestedChange | undefined, steps: JourneyStep[]): boolean {
  if (!change?.replacement) return true;
  return steps.some(step => [step.before, step.after].some(observation => observation &&
    [observation.visibleText, ...observation.candidates.map(c => c.name)].some(text => normalize(text).includes(normalize(change.replacement!.before)))));
}
