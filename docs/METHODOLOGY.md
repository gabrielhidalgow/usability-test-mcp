# Usability Test MCP — Methodology

Version **2026.09-2**. The machine-readable source is `src/methodology/principles.ts`, also served at the MCP resource `usability://methodology`.

This is an original, practical adaptation of ideas from three books. It contains no copied book text. Read the originals:

- Steve Krug, *Don’t Make Me Think, Revisited* — [sensible.com](https://sensible.com/dont-make-me-think/)
- Steve Krug, *Rocket Surgery Made Easy* — [sensible.com](https://sensible.com/rocket-surgery-made-easy/), plus Krug’s free [test script](https://sensible.com/downloads/test-script-web.pdf), [neutral facilitation phrases](https://sensible.com/downloads/things-a-therapist-would-say.pdf) and [observer instructions](https://sensible.com/downloads/instructions-for-observers.pdf)
- Susan Weinschenk, *100 Things Every Designer Needs to Know About People*, 2nd ed. — [publisher page](https://www.peachpit.com/store/100-things-every-designer-needs-to-know-about-people-9780136746911). Weinschenk principles were checked against her own blog series [“100 Things You Should Know About People”](https://www.blog.theteamw.com/author/susan/), which preceded the book’s numbered items. Each principle below names the post it was checked against. `feedback` is the only one still based on the book outline alone.

**Boundary.** These principles make the method more disciplined and explainable. They do not make an AI reproduce human perception, memory, attention or emotion. Three synthetic profiles are not Krug’s three real users. Important conclusions still need real people.

## Where each idea is applied

| Idea | Source | Where it lives in the tool |
| --- | --- | --- |
| Realistic tasks that don’t give away the answer | Krug, *Rocket Surgery* | Advisory **task review** when a plan is saved: flags click/menu wording, URLs, step sequences, quoted on-screen labels, unobservable success criteria, PDF/download tasks and missing motivation. It never rewrites the plan. |
| Neutral facilitation (“what would you do if I weren’t here?”) | Krug, test script | Participants receive only persona, scenario, goal, the current screen and their own history. No hints, routes, methodology or prior findings. |
| Think aloud about what you notice now | Krug, test script | Participant commentary is first-person and immediate, not expert analysis. |
| “Is that what you expected to happen?” | Krug, facilitation phrases; Weinschenk, mental models | Each action records `userExpectation`. Reviewers compare it with the resulting screen, and the appendix shows *Expected → Result*. |
| Home-page tour before tasks | Krug, test script | Optional **first-impression** exercise (the `first-impression` prompt): scroll only, describe what the product seems to be, then finish. Reported separately and never pooled with task results. |
| Observers list the three most serious problems | Krug, observer instructions | The executive report shows at most **three** actions, most serious first. The rest goes in the appendix. |
| Fix the worst problems with the smallest change | Krug, *Rocket Surgery* | Ranking by task impact; recommendations prefer targeted tweaks and include a retest check. |
| Retest after changes | Krug, *Rocket Surgery* | `usability_compare_runs` / `usability_submit_run_comparison`: observed again, not observed on a comparable path, or inconclusive. Absence is not proof of a fix. |
| Self-evident pages, mindless choices, scanning, orientation, conventions, needless words, goodwill | Krug, *Don’t Make Me Think* | UX/content review checklists and optional `principleIds` tags. |
| Recognition over recall, grouping, mental models, feedback, understandable choices, error recovery, progressive disclosure, motion distraction | Weinschenk | UX/content review checklists and optional `principleIds` tags. |
| What people look at depends on the instructions they get | Weinschenk #18 | Every participant in a comparison gets identical task wording; retests with different wording are flagged as not comparable. |

## Principles

Each principle says what evidence to look for, what counts against it, and its limits. `principleIds` are labels; they never replace step evidence and never increase participant counts.

| ID | Source | Look for (recorded evidence) | Limit |
| --- | --- | --- | --- |
| `self-evident` | Krug | Hesitation or questions about what something is or does | Models may read conventions differently from people |
| `mindless-choices` | Krug | Equally plausible options leading to a wrong choice or hesitation | Click count alone is not a problem |
| `scanning-hierarchy` | Krug | Relevant content missed or buried in dense text | Screenshots show the viewport only |
| `orientation` | Krug | Backtracking or confusion about where they are | Cues may be outside the captured viewport |
| `conventions-language` | Krug | Jargon or unconventional placement that was misread | Judge against the persona’s knowledge |
| `omit-needless-words` | Krug | Text pushing needed content down, or instructions compensating for unclear controls | Long content is not a problem by itself |
| `goodwill` | Krug | Needed information (price, contact, key facts) hard to find | Do not infer frustration or distrust |
| `realistic-tasks` | Krug | Task wording naming labels, menus, paths or steps | Some domain terms are unavoidable |
| `neutral-facilitation` | Krug; Weinschenk [#18](https://www.blog.theteamw.com/2009/12/11/100-things-you-should-know-about-people-18-what-people-look-at-on-a-picture-or-screen-depends-on-what-you-say-to-them/) | Anything beyond the neutral packet reaching participants, or different task wording between compared participants | The server cannot erase a shared chat’s memory |
| `expectation-match` | Krug; Weinschenk [#52](https://www.blog.theteamw.com/2011/01/16/100-things-you-should-know-about-people-52-people-create-mental-models/) | Recorded expectation differs from the result | Missing expectations are inconclusive |
| `mental-models` | Weinschenk [#52](https://www.blog.theteamw.com/2011/01/16/100-things-you-should-know-about-people-52-people-create-mental-models/) | Looking for something where or under a name the product doesn’t use | Fixes can match the existing model or teach a new one |
| `recognition-over-recall` | Weinschenk [#90](https://www.blog.theteamw.com/2011/03/25/100-things-you-should-know-about-people-90-recognition-is-easier-than-recall/), [#3](https://www.blog.theteamw.com/2009/10/28/100-things-you-should-know-about-people-3-the-magic-number-3-or-3-to-4/) | Needing to remember something no longer visible | Her small-capacity figure matters when comparing or carrying items between screens; never a pass/fail count ([Miller 1956](https://doi.org/10.1037/h0043158), [Cowan 2001](https://doi.org/10.1017/S0140525X01003922)) |
| `grouping` | Weinschenk [#3](https://www.blog.theteamw.com/2009/10/28/100-things-you-should-know-about-people-3-the-magic-number-3-or-3-to-4/) | Related items spread apart, compared in the wrong place | Judge from evidence, not layout taste |
| `feedback` | Weinschenk (book outline only) | No visible change after an action, followed by uncertainty | Screenshots may miss brief feedback |
| `understandable-choices` | Weinschenk [#10](https://www.blog.theteamw.com/2009/11/13/100-things-you-should-know-about-people-10-your-want-more-choices-and-information-than-you-can-actually-process/) | Options lacking the information needed to compare them | She recommends fewer choices; wider evidence is mixed ([Iyengar & Lepper 2000](https://doi.org/10.1037/0022-3514.79.6.995), [Scheibehenne et al. 2010](https://doi.org/10.1086/651235)); never cut options on count alone |
| `error-recovery` | Weinschenk [#35](https://www.blog.theteamw.com/2010/06/08/100-things-you-should-know-about-people-35-people-make-mistakes/) | Hard recovery after a wrong turn; error messages that don’t say what went wrong and how to fix it; preventable errors | Harness blocks are not product errors; don’t speculate about errors nobody came near |
| `progressive-disclosure` | Weinschenk [#33](https://www.blog.theteamw.com/2010/05/07/100-things-you-should-know-about-people-33-bite-sized-chunks-of-info-are-best/) | Everything at once so task info was missed, or detail hidden with no cue | Don’t count clicks; clear steps are fine |
| `motion-distraction` | Weinschenk [#22](https://www.blog.theteamw.com/2010/01/23/100-things-you-should-know-about-people-22-peripheral-vison-keeping-you-alive-or-channel-surfing/) | Moving or blinking elements near task content, with recorded diversion or unsettled captures | A model doesn’t have peripheral vision; report only with evidence |
| `fix-most-serious` | Krug | Blockers ranked below polish | Priorities rest on synthetic evidence |

## Review rules

- **Recorded obstacle vs expert risk.** A UX/content note marked `recorded-obstacle` must cite a step where the participant showed friction or non-progress behaviour. Everything else is an `expert-risk`, reported as the reviewer’s judgement.
- **Coverage.** UX and content reviews record each relevant principle as *assessed* (evidence required), *not encountered*, *inconclusive* or *not applicable*. Missing or inconclusive coverage is never a pass.
- **Guardrails.** Reviews must not invent emotions, attention spans, memory capacities, disabilities, demographics or human timings.
- **Reports** record `methodologyVersion`. Older reports show “methodology: not recorded” and remain readable.

## Focus areas

A test can focus on one feature, page or flow (Krug: test a few key tasks, starting where they matter). The participant starts on the focus page and is **never told the boundary**, since that would be coaching. Steps are marked inside or outside the focus; after three consecutive steps outside, the journey ends as “left the focus area”, which is itself evidence. Reports keep actions on the focus area and list outside-only findings separately.

## Static design flows (Figma)

The same principles apply to static frames, with a narrower lens. Tap accuracy on a marked target is evidence for `self-evident` and `mindless-choices`; misclicks and facilitator move-ons are recorded obstacles. Expectation-versus-next-frame is evidence for `expectation-match` and `mental-models`. Content, grouping, hierarchy and choice principles read directly from the frames. Principles that depend on live behaviour (`feedback` timing, `error-recovery`, `motion-distraction`) can only be judged from what the frames show, and usually end as not-encountered or inconclusive.
