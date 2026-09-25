# Usability Test MCP — Methodology

Version **2026.09-1**. The machine-readable source is `src/methodology/principles.ts`, also served at the MCP resource `usability://methodology`.

This is an original, practical adaptation of ideas from three books. It contains no copied book text. Read the originals:

- Steve Krug, *Don’t Make Me Think, Revisited* — [sensible.com](https://sensible.com/dont-make-me-think/)
- Steve Krug, *Rocket Surgery Made Easy* — [sensible.com](https://sensible.com/rocket-surgery-made-easy/), plus Krug’s free [test script](https://sensible.com/downloads/test-script-web.pdf), [neutral facilitation phrases](https://sensible.com/downloads/things-a-therapist-would-say.pdf) and [observer instructions](https://sensible.com/downloads/instructions-for-observers.pdf)
- Susan Weinschenk, *100 Things Every Designer Needs to Know About People*, 2nd ed. — [publisher page](https://www.peachpit.com/store/100-things-every-designer-needs-to-know-about-people-9780136746911)

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
| Recognition over recall, grouping, mental models, feedback, understandable choices, error recovery | Weinschenk | UX/content review checklists and optional `principleIds` tags. |

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
| `neutral-facilitation` | Krug | Anything beyond the neutral packet reaching participants | The server cannot erase a shared chat’s memory |
| `expectation-match` | Weinschenk / Krug | Recorded expectation differs from the result | Missing expectations are inconclusive |
| `mental-models` | Weinschenk | Looking for something where or under a name the product doesn’t use | Profile models are assumptions unless owner-researched |
| `recognition-over-recall` | Weinschenk | Needing to remember something no longer visible | No fixed memory limit applies ([Miller 1956](https://doi.org/10.1037/h0043158), [Cowan 2001](https://doi.org/10.1017/S0140525X01003922)) |
| `grouping` | Weinschenk | Related items spread apart, compared in the wrong place | Judge from evidence, not layout taste |
| `feedback` | Weinschenk | No visible change after an action, followed by uncertainty | Screenshots may miss brief feedback |
| `understandable-choices` | Weinschenk | Options lacking the information needed to compare them | Choice-overload evidence is mixed ([Iyengar & Lepper 2000](https://doi.org/10.1037/0022-3514.79.6.995), [Scheibehenne et al. 2010](https://doi.org/10.1086/651235)); never cut options on count alone |
| `error-recovery` | Weinschenk | Difficulty returning to a useful state after a wrong turn | Harness blocks are not product errors |
| `fix-most-serious` | Krug | Blockers ranked below polish | Priorities rest on synthetic evidence |

## Review rules

- **Recorded obstacle vs expert risk.** A UX/content note marked `recorded-obstacle` must cite a step where the participant showed friction or non-progress behaviour. Everything else is an `expert-risk`, reported as the reviewer’s judgement.
- **Coverage.** UX and content reviews record each relevant principle as *assessed* (evidence required), *not encountered*, *inconclusive* or *not applicable*. Missing or inconclusive coverage is never a pass.
- **Guardrails.** Reviews must not invent emotions, attention spans, memory capacities, disabilities, demographics or human timings.
- **Reports** record `methodologyVersion`. Older reports show “methodology: not recorded” and remain readable.
