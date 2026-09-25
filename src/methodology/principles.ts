import { z } from 'zod';

// Original paraphrase of published guidance. Sources are linked, never copied.
// Reviewers and facilitators use this; participant packets never include it.
export const METHODOLOGY_VERSION = '2026.09-2';

const SOURCES = {
  krugTestScript: 'https://sensible.com/downloads/test-script-web.pdf',
  krugTherapist: 'https://sensible.com/downloads/things-a-therapist-would-say.pdf',
  krugObservers: 'https://sensible.com/downloads/instructions-for-observers.pdf',
  krugDmmt: 'https://sensible.com/dont-make-me-think/',
  krugRsme: 'https://sensible.com/rocket-surgery-made-easy/',
  weinschenkBook: 'https://www.peachpit.com/store/100-things-every-designer-needs-to-know-about-people-9780136746911',
  // Weinschenk's own blog series that preceded the book's numbered items.
  w03Memory: 'https://www.blog.theteamw.com/2009/10/28/100-things-you-should-know-about-people-3-the-magic-number-3-or-3-to-4/',
  w10Choices: 'https://www.blog.theteamw.com/2009/11/13/100-things-you-should-know-about-people-10-your-want-more-choices-and-information-than-you-can-actually-process/',
  w18Instructions: 'https://www.blog.theteamw.com/2009/12/11/100-things-you-should-know-about-people-18-what-people-look-at-on-a-picture-or-screen-depends-on-what-you-say-to-them/',
  w22Peripheral: 'https://www.blog.theteamw.com/2010/01/23/100-things-you-should-know-about-people-22-peripheral-vison-keeping-you-alive-or-channel-surfing/',
  w33Chunks: 'https://www.blog.theteamw.com/2010/05/07/100-things-you-should-know-about-people-33-bite-sized-chunks-of-info-are-best/',
  w35Mistakes: 'https://www.blog.theteamw.com/2010/06/08/100-things-you-should-know-about-people-35-people-make-mistakes/',
  w52MentalModels: 'https://www.blog.theteamw.com/2011/01/16/100-things-you-should-know-about-people-52-people-create-mental-models/',
  w90Recognition: 'https://www.blog.theteamw.com/2011/03/25/100-things-you-should-know-about-people-90-recognition-is-easier-than-recall/',
  miller1956: 'https://doi.org/10.1037/h0043158',
  cowan2001: 'https://doi.org/10.1017/S0140525X01003922',
  iyengarLepper2000: 'https://doi.org/10.1037/0022-3514.79.6.995',
  scheibehenne2010: 'https://doi.org/10.1086/651235',
} as const;

export type Principle = {
  id: string;
  source: 'krug-dmmt' | 'krug-rsme' | 'weinschenk';
  title: string;
  appliesTo: ('task' | 'ux' | 'content')[];
  lookFor: string;
  counterexamples: string;
  limits: string;
  sources: string[];
  /** How the attribution was checked: against the author's own published writing, or only the book outline. */
  verification?: string;
};

export const PRINCIPLES = [
  { id: 'self-evident', source: 'krug-dmmt', title: 'Controls and pages are self-evident', appliesTo: ['ux'],
    lookFor: 'Recorded hesitation, commentary questioning what something is or does, or a click on something that was not interactive.',
    counterexamples: 'The participant acted directly and the result matched their stated expectation.',
    limits: 'A model may recognise conventions faster or slower than a person; treat single hesitations as weak evidence.',
    sources: [SOURCES.krugDmmt] },
  { id: 'mindless-choices', source: 'krug-dmmt', title: 'Choices are easy to make without deliberation', appliesTo: ['ux', 'content'],
    lookFor: 'A decision point where several visible options looked equally plausible and the participant chose wrongly or hesitated.',
    counterexamples: 'Labels made the right option clearly distinct at that step.',
    limits: 'Do not count the number of clicks as a problem by itself; the issue is uncertainty at each choice.',
    sources: [SOURCES.krugDmmt] },
  { id: 'scanning-hierarchy', source: 'krug-dmmt', title: 'Pages support scanning through clear visual hierarchy', appliesTo: ['ux', 'content'],
    lookFor: 'Task-relevant content present on screen but missed, found only after scrolling past, or buried inside dense text in the screenshot.',
    counterexamples: 'Headings, grouping and emphasis led directly to the relevant section.',
    limits: 'Screenshots show the viewport only; do not claim content was unseen unless the journey shows it was passed or missed.',
    sources: [SOURCES.krugDmmt] },
  { id: 'orientation', source: 'krug-dmmt', title: 'People can tell where they are and how to move on', appliesTo: ['ux'],
    lookFor: 'Backtracking, wrong turns, or commentary about not knowing which section or page they are on; missing page names or current-location cues in screenshots.',
    counterexamples: 'Visible page names, navigation state or breadcrumbs let the participant recover or continue.',
    limits: 'Orientation cues may exist outside the captured viewport.',
    sources: [SOURCES.krugDmmt] },
  { id: 'conventions-language', source: 'krug-dmmt', title: 'Conventions and familiar words are used', appliesTo: ['ux', 'content'],
    lookFor: 'Internal jargon, brand-specific names or unconventional placement that the participant misread or had to interpret.',
    counterexamples: 'Plain labels matched the words the participant used for their goal.',
    limits: 'Familiarity depends on the audience; judge against the persona’s stated knowledge, not general expertise.',
    sources: [SOURCES.krugDmmt] },
  { id: 'omit-needless-words', source: 'krug-dmmt', title: 'Needless words and instructions are removed', appliesTo: ['content'],
    lookFor: 'Promotional or introductory text that pushed task-relevant content down, or instructions needed only because a control is unclear.',
    counterexamples: 'Concise copy put the needed information near the top of the relevant screen.',
    limits: 'Do not recommend cutting content that participants used to decide; long content is not inherently a problem.',
    sources: [SOURCES.krugDmmt] },
  { id: 'goodwill', source: 'krug-dmmt', title: 'Information people look for is not hidden', appliesTo: ['ux', 'content'],
    lookFor: 'The participant looked for something the task needed (price, contact, key facts) and could not find it, or it required extra steps.',
    counterexamples: 'The needed information was visible where the participant first looked.',
    limits: 'Do not infer emotional reactions such as frustration or distrust; report only the recorded search effort.',
    sources: [SOURCES.krugDmmt] },
  { id: 'realistic-tasks', source: 'krug-rsme', title: 'Tasks are realistic and do not give away the answer', appliesTo: ['task'],
    lookFor: 'Task wording that names on-screen labels, menus, paths or the expected steps; missing motivation for why the person is there.',
    counterexamples: 'The task describes an outcome in the user’s own words with a plausible reason.',
    limits: 'Some domain terms are unavoidable; flag them for owner review rather than rewriting automatically.',
    sources: [SOURCES.krugTestScript, SOURCES.krugRsme] },
  { id: 'neutral-facilitation', source: 'krug-rsme', title: 'Facilitation stays neutral', appliesTo: ['task'],
    lookFor: 'Anything supplied to participants beyond persona, scenario, goal and the visible screen: hints, routes, prior findings or evaluator criteria; or participants in one comparison receiving different task wording.',
    counterexamples: 'Every participant received the same neutral packet and only their own history.',
    limits: 'The server controls the packet but cannot erase knowledge already in a shared host conversation. Instructions shape where people look, so wording differences between runs weaken comparisons.',
    sources: [SOURCES.krugTherapist, SOURCES.w18Instructions],
    verification: 'Weinschenk #18 (instructions change where people look) checked against her blog.' },
  { id: 'expectation-match', source: 'weinschenk', title: 'Results match what people expected', appliesTo: ['ux'],
    lookFor: 'A step where the recorded expectation before an action differs from the resulting screen.',
    counterexamples: 'The resulting screen matched the stated expectation.',
    limits: 'Only steps with a recorded expectation can be assessed; missing expectations are inconclusive, not a pass.',
    sources: [SOURCES.krugTherapist, SOURCES.w52MentalModels],
    verification: 'Krug facilitation phrase verified; Weinschenk link is her mental-models post (#52).' },
  { id: 'mental-models', source: 'weinschenk', title: 'The interface fits the audience’s mental model', appliesTo: ['ux', 'content'],
    lookFor: 'Commentary showing the participant looked for something in a place or under a name that the product does not use, or expected a different result from a familiar-looking control.',
    counterexamples: 'The product’s structure matched where the participant looked first, or a genuinely new concept was explained where it first appeared.',
    limits: 'A synthetic profile’s model is an assumption unless the profile basis is owner research. Fixes can either match the existing model or teach a new one; do not assume matching is always right.',
    sources: [SOURCES.w52MentalModels],
    verification: 'Checked against Weinschenk #52.' },
  { id: 'recognition-over-recall', source: 'weinschenk', title: 'People recognise options instead of remembering them', appliesTo: ['ux'],
    lookFor: 'A step that required remembering information from an earlier screen that was no longer visible.',
    counterexamples: 'Needed information stayed visible or was repeated where it was used.',
    limits: 'Weinschenk cites a small working-memory capacity, which matters when items must be compared or carried between screens, not for everything visible. Never apply a numeric threshold as pass/fail.',
    sources: [SOURCES.w90Recognition, SOURCES.w03Memory, SOURCES.miller1956, SOURCES.cowan2001],
    verification: 'Checked against Weinschenk #90 and #3.' },
  { id: 'grouping', source: 'weinschenk', title: 'Related information is grouped', appliesTo: ['ux', 'content'],
    lookFor: 'Related options or facts spread across the screen so the participant compared them in the wrong place or missed one.',
    counterexamples: 'Grouping and spacing made related items read as a set.',
    limits: 'Judge from screenshots and recorded behaviour, not from layout preference.',
    sources: [SOURCES.w03Memory, SOURCES.weinschenkBook],
    verification: 'Chunking and grouping advice checked against Weinschenk #3.' },
  { id: 'feedback', source: 'weinschenk', title: 'Actions give visible feedback', appliesTo: ['ux'],
    lookFor: 'An action whose result screen showed no visible change or confirmation, followed by repetition or uncertainty.',
    counterexamples: 'The result screen showed a clear change connected to the action.',
    limits: 'Screenshots are single frames; short-lived feedback may be missed. Recheck unsettled captures.',
    sources: [SOURCES.weinschenkBook],
    verification: 'Based on the book outline only; not verified against her writing.' },
  { id: 'understandable-choices', source: 'weinschenk', title: 'Choices are understandable and comparable', appliesTo: ['ux', 'content'],
    lookFor: 'Options without the information needed to compare them for the participant’s goal.',
    counterexamples: 'Differences between options were visible side by side.',
    limits: 'Weinschenk argues people want more choices than they can process and recommends fewer; the wider evidence on choice overload is mixed. Do not recommend reducing options based on count alone.',
    sources: [SOURCES.w10Choices, SOURCES.iyengarLepper2000, SOURCES.scheibehenne2010],
    verification: 'Checked against Weinschenk #10, balanced with the Scheibehenne et al. meta-analysis.' },
  { id: 'error-recovery', source: 'weinschenk', title: 'Mistakes are easy to notice and recover from', appliesTo: ['ux'],
    lookFor: 'A wrong turn or error followed by difficulty returning to a useful state; an error message that does not say what went wrong and how to fix it in plain words; an error the design could have prevented.',
    counterexamples: 'After a wrong turn, visible navigation let the participant recover quickly, or the design prevented the error.',
    limits: 'Harness blocks and tool failures are not product errors. Prevention beats recovery, but do not speculate about errors no participant came near.',
    sources: [SOURCES.w35Mistakes],
    verification: 'Checked against Weinschenk #35.' },
  { id: 'progressive-disclosure', source: 'weinschenk', title: 'Information comes in layers: overview first, detail on demand', appliesTo: ['ux', 'content'],
    lookFor: 'A screen that presented everything at once so the participant missed the task-relevant part, or detail hidden with no visible cue that more was available.',
    counterexamples: 'An overview led the participant to the right detail in a few clear steps.',
    limits: 'Extra clicks are not a problem when each step is clear; do not count clicks. Complements Krug’s mindless choices.',
    sources: [SOURCES.w33Chunks, SOURCES.krugDmmt],
    verification: 'Checked against Weinschenk #33.' },
  { id: 'motion-distraction', source: 'weinschenk', title: 'Movement at the edge of the screen does not pull attention from the task', appliesTo: ['ux'],
    lookFor: 'Animated, auto-rotating or blinking elements near the task content, together with commentary about them or a missed step; captures flagged as not settling because of continuous motion.',
    counterexamples: 'Motion stopped or stayed away from the task area and the participant was not diverted.',
    limits: 'A model reading screenshots does not experience peripheral vision; report motion only with recorded evidence, never as an assumed distraction.',
    sources: [SOURCES.w22Peripheral],
    verification: 'Checked against Weinschenk #22.' },
  { id: 'fix-most-serious', source: 'krug-rsme', title: 'Fix the most serious problems first, with the smallest change', appliesTo: ['ux', 'content'],
    lookFor: 'Prioritisation: problems that blocked or delayed the task come before polish; recommendations prefer targeted tweaks over redesigns.',
    counterexamples: 'A recorded blocker was ranked below cosmetic suggestions.',
    limits: 'Priority here reflects synthetic evidence; validate important fixes with real users.',
    sources: [SOURCES.krugObservers, SOURCES.krugRsme] },
] as const satisfies readonly Principle[];

export type PrincipleId = (typeof PRINCIPLES)[number]['id'];
export const principleIdSchema = z.enum(PRINCIPLES.map(p => p.id) as [PrincipleId, ...PrincipleId[]]);
export const principleIdsSchema = z.array(principleIdSchema).max(4);

export function principlesFor(role: 'task' | 'ux' | 'content'): readonly Principle[] {
  return PRINCIPLES.filter(p => (p.appliesTo as readonly string[]).includes(role));
}
export function principleChecklist(role: 'ux' | 'content'): string {
  return `Methodology ${METHODOLOGY_VERSION} principles to consider (cite principleIds only where evidence supports them; they never replace step evidence): ${principlesFor(role).map(p => `${p.id} — ${p.title}. Look for: ${p.lookFor} Limit: ${p.limits}`).join(' | ')}`;
}
export const REVIEW_GUARDRAILS = 'Do not invent emotions, attention spans, memory capacities, disabilities, demographics or human task timings. A principle is a lens for reading recorded evidence, not evidence itself.';
