import type { JourneyStep } from './types.js';

export function describeAction(step: JourneyStep): string {
  const action = step.decision.selectedAction;
  if ('target' in action) {
    const candidate = step.before.candidates.find(c => c.ref === action.target);
    return `${action.type} ${candidate ? `${candidate.role} "${candidate.name}"` : action.target}`;
  }
  if (action.type === 'tap_point') return `tap visible control "${action.visibleLabel}" at ${action.x}, ${action.y}`;
  if (action.type === 'enter_text') return `enter text in "${action.visibleLabel}"`;
  if (action.type === 'key') return `press ${action.key}`;
  if (action.type === 'scroll') return `scroll ${action.direction}`;
  return action.type;
}
