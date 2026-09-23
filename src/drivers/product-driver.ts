import type { SessionInput } from '../config/schema.js';
import type { AccessibilityScan, AccessibilitySnapshot, ActionResult, EvidenceArtifact,
  InteractionTarget, PolicyDiagnostic, ProductObservation } from '../core/types.js';

export class BrowserWindowClosed extends Error {}
export type ViewStatus = { participant: string; step: number; phase: 'waiting' | 'planned' | 'executing' | 'completed' | 'finished'; action?: string };
export type DriverStartConfig = { onWindowClosed?: () => void; input: SessionInput; directory: string; signal: AbortSignal };
export interface ProductDriver {
  readonly kind: 'web' | 'mobile';
  readonly limitations?: string[];
  setViewStatus?(status: ViewStatus): Promise<void>;
  tapPoint?(x: number, y: number): Promise<ActionResult>;
  enterText?(value: string): Promise<ActionResult>;
  takePolicyDiagnostics?(): PolicyDiagnostic[];
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
