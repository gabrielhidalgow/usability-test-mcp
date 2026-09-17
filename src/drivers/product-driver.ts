import type { SessionInput } from '../config/schema.js';
import type { AccessibilityScan, AccessibilitySnapshot, ActionResult, EvidenceArtifact,
  InteractionTarget, ProductObservation } from '../core/types.js';

export type DriverStartConfig = { input: SessionInput; directory: string; signal: AbortSignal };
export interface ProductDriver {
  readonly kind: 'web' | 'mobile';
  start(config: DriverStartConfig): Promise<void>;
  stop(): Promise<void>;
  getObservation(): Promise<ProductObservation>;
  click(target: InteractionTarget): Promise<ActionResult>;
  tap(target: InteractionTarget): Promise<ActionResult>;
  type(target: InteractionTarget, value: string): Promise<ActionResult>;
  scroll(direction: 'up' | 'down' | 'left' | 'right'): Promise<ActionResult>;
  pressKey(key: string): Promise<ActionResult>;
  goBack(): Promise<ActionResult>;
  screenshot(label?: string): Promise<EvidenceArtifact>;
  getAccessibilitySnapshot(): Promise<AccessibilitySnapshot | null>;
  getCurrentLocation(): Promise<string | null>;
  scanAccessibility(step: number, screenshot: string): Promise<AccessibilityScan>;
  setActionCapability(capability: SessionInput['allowedCapabilities'][number] | null): void;
}
