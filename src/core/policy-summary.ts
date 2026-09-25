import type { PolicyDiagnostic } from './types.js';

// Groups blocked requests by what they could have changed for the participant.
// Third-party tracking writes are aborted before sending and leave the page as shown.
export type PolicyEffect = 'tracking' | 'page-resource' | 'site-write' | 'navigation';
const WRITE = (d: PolicyDiagnostic) => !['GET', 'HEAD', 'OPTIONS'].includes(d.method.toUpperCase());
export function policyEffect(d: PolicyDiagnostic): PolicyEffect {
  if (d.mainFrameNavigation) return 'navigation';
  if (WRITE(d)) return d.destination === 'third-party' && !d.stopsJourney && ['fetch', 'xhr', 'ping'].includes(d.resourceType) ? 'tracking' : 'site-write';
  return 'page-resource';
}
export function summarizePolicy(diagnostics: PolicyDiagnostic[] = []) {
  const counts: Record<PolicyEffect, number> = { tracking: 0, 'page-resource': 0, 'site-write': 0, navigation: 0 };
  for (const d of diagnostics) counts[policyEffect(d)]++;
  // Anything other than third-party tracking may have changed what the participant saw or could do.
  const affectsFidelity = counts['page-resource'] + counts['site-write'] + counts.navigation > 0;
  return { total: diagnostics.length, counts, affectsFidelity };
}
export function describePolicy(summary: ReturnType<typeof summarizePolicy>): string {
  const { counts } = summary;
  return [counts.tracking ? `${counts.tracking} third-party tracking request(s) (no effect on what was shown)` : '',
    counts['page-resource'] ? `${counts['page-resource']} page resource(s) such as scripts, images or frames (may have changed what was shown)` : '',
    counts['site-write'] ? `${counts['site-write']} write(s) to the site itself (may have changed what the participant could do)` : '',
    counts.navigation ? `${counts.navigation} blocked page navigation(s)` : ''].filter(Boolean).join('; ');
}
