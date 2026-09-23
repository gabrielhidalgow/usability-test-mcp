import type { Capability, SessionInput } from '../config/schema.js';
import type { Action, ProductObservation } from './types.js';

// Defense in depth only: text cannot prove what arbitrary application code will do.
const consequentialLabels: [Capability, RegExp][] = [
  ['payment', /\b(pay|purchase|buy|checkout|transfer|donate|place order)\b/i],
  ['accountClosure', /\b(close|terminate|deactivate)\s+(my\s+)?account\b/i],
  ['deletion', /\b(delete|remove|erase|destroy|purge)\b/i],
  ['communication', /\b(send|email|message|invite|contact|subscribe)\b/i],
  ['publicPosting', /\b(publish|post|share|upload)\b/i],
  ['accountCreation', /\b(create account|register|sign up|signup|join)\b/i],
  ['formSubmission', /\b(submit|save|confirm|apply|continue)\b/i],
];
export function labelCapabilities(label: string): Capability[] {
  return consequentialLabels.filter(([, re]) => re.test(label)).map(([capability]) => capability);
}
export function permits(input: SessionInput, capability: Capability): boolean {
  return input.testEnvironment && input.allowedCapabilities.includes(capability);
}
export function guardAction(action: Action, observation: ProductObservation, input: SessionInput): string | null {
  if (action.type === 'finish' || action.type === 'back' || action.type === 'scroll') return null;
  if (input.interactionMode === 'keyboard' && (action.type === 'click' || action.type === 'tap')) {
    return 'Keyboard sessions cannot click or tap.';
  }
  let label = '';
  if (action.type === 'tap_point' || action.type === 'enter_text') {
    if (input.platform !== 'native') return 'Coordinate and native text actions require a native test session.';
    label = action.visibleLabel;
    if (action.type === 'enter_text' && /password|secret|api.?key|credit.?card|card.?number|cvv/i.test(label)) return 'Secret and payment fields are excluded.';
  }

  if ('target' in action) {
    const target = observation.candidates.find(x => x.ref === action.target);
    if (!target) return 'The selected target is not in the current visible observation.';
    if (target.disabled) return 'The selected control is disabled.';
    label = target.name;
    if (action.type === 'type' && /password|secret|api.?key|credit.?card|card.?number|cvv/i.test(label)) {
      return 'Secret and payment fields are excluded from this MVP.';
    }
  }
  if (action.type === 'key' && ['Enter', 'Space'].includes(action.key)) {
    // Activating an unknown control is not safe to infer from the model's classification.
    if (!observation.semantics.focused) return 'Cannot safely identify the focused control.';
    label = observation.semantics.focused;
  }
  const required = new Set<Capability>(labelCapabilities(label));
  if ('capability' in action && action.capability) required.add(action.capability);
  for (const cap of required) {
    if (!permits(input, cap)) return `Blocked ${cap}: requires testEnvironment and explicit ${cap} opt-in.`;
  }
  return null;
}

export function safeLocation(value: string): string {
  try {
    const url = new URL(value);
    url.username = ''; url.password = ''; url.hash = '';
    // Query strings often carry tokens or PII. Participant decisions do not need them.
    url.search = '';
    return url.toString();
  } catch { return '[unavailable location]'; }
}
export function redact(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*)[^\s&,;]+/gi, '$1[REDACTED]');
}
