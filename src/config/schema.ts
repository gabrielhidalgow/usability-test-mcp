import { resolve } from 'node:path';
import { z } from 'zod';

export function isHttpUrlWithoutCredentials(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
export const capabilitySchema = z.enum([
  'formSubmission', 'accountCreation', 'communication', 'publicPosting',
  'deletion', 'accountClosure', 'payment',
]);
export const personaSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/).optional(),
  name: z.string().min(1).max(80).default('Participant'),
  context: z.string().min(1).max(2000),
  technicalConfidence: z.enum(['low', 'average', 'high']).default('average'),
  productKnowledge: z.enum(['none', 'some', 'experienced']).default('none'),
  basis: z.enum(['owner-research', 'assumption', 'unspecified']).optional(),
  informationNeeds: z.array(z.string().min(1).max(300)).max(10).optional(),
  constraints: z.array(z.string().max(300)).max(10).default([]),
});
export const discoveryIdSchema = z.string().regex(/^discovery-[0-9a-f-]{36}$/);
export const handoffSchema = z.strictObject({ discoveryId: discoveryIdSchema, context: z.enum(['shared', 'host-reported fresh', 'unknown']), startingStateConfirmed: z.boolean().optional() });
export const contextCheckSchema = z.strictObject({
  mode: z.enum(['first-visit', 'informed-walkthrough']).default('first-visit'),
  isolation: z.enum(['shared', 'host-reported fresh', 'unknown']),
  exposure: z.array(z.enum(['source-code', 'discovery', 'prior-findings', 'prior-journeys'])).default([]),
});
export const rerunSchema = z.strictObject({
  priorRunId: z.string().regex(/^(session|round)-[0-9a-f-]{36}$/),
  reason: z.enum(['wrong-participant', 'policy-adjustment', 'context-contamination', 'interrupted', 'other']),
  changes: z.string().trim().min(1).max(1000),
});
export const sessionBaseSchema = z.strictObject({
  target: z.string().min(1).max(4000),
  platform: z.enum(['web', 'native']).default('web'),
  native: z.strictObject({ deviceId: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/), os: z.enum(['ios', 'android']), preparedTestDevice: z.literal(true) }).optional(),
  persona: personaSchema,
  scenario: z.string().min(1).max(4000),
  goal: z.string().min(1).max(2000),
  maxActions: z.number().int().min(1).max(100).default(30),
  timeoutMs: z.number().int().min(1000).max(600000).default(180000),
  presentation: z.enum(['visible', 'background']).optional(),
  handoff: handoffSchema.optional(),
  contextCheck: contextCheckSchema.optional(),
  rerun: rerunSchema.optional(),
  exercise: z.enum(['task', 'first-impression']).default('task'),
  viewport: z.enum(['desktop', 'mobile']).default('desktop'),
  accessibilityChecks: z.boolean().default(true),
  interactionMode: z.enum(['standard', 'keyboard']).default('standard'),
  testEnvironment: z.boolean().default(false),
  allowedCapabilities: z.array(capabilitySchema).default([]),
});
export const sessionInputSchema = sessionBaseSchema.refine(x => x.platform === 'web'
  ? isHttpUrlWithoutCredentials(x.target) && !x.native
  : /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(x.target) && Boolean(x.native) && x.testEnvironment && x.allowedCapabilities.length === 0 && !x.accessibilityChecks && x.interactionMode === 'standard',
  'Web requires an HTTP(S) URL without credentials. Native requires an app ID, a prepared test device, testEnvironment=true, no capability overrides, no axe scans and standard interaction.').refine(
  x => x.testEnvironment || x.allowedCapabilities.length === 0,
  'Capability overrides require testEnvironment: true',
);
export const roundInputSchema = sessionBaseSchema.omit({ persona: true }).extend({
  personas: z.array(personaSchema).min(1).max(5).optional(),
  participantCount: z.number().int().min(1).max(5).default(3),
  personaContext: z.string().min(1).max(2000).default('A first-time visitor pursuing the supplied goal'),
}).refine(x => x.platform === 'web' && !x.native && isHttpUrlWithoutCredentials(x.target), 'Rounds currently support web targets only').refine(x => x.exercise === 'task', 'First-impression exercises are single sessions and are never pooled into rounds').refine(x => x.testEnvironment || x.allowedCapabilities.length === 0,
  'Capability overrides require testEnvironment: true')
  .refine(x => !x.personas || x.personas.length === x.participantCount,
    'personas length must equal participantCount');

const envSchema = z.object({
  USABILITY_ARTIFACT_DIR: z.string().min(1).default('.usability'),
  USABILITY_HEADLESS: z.enum(['true', 'false']).default('false'),
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error('Invalid Usability Test MCP environment configuration; check .env.example');
  const e = parsed.data;
  return {
    artifactRoot: resolve(e.USABILITY_ARTIFACT_DIR), headless: e.USABILITY_HEADLESS === 'true',
  };
}
export type AppConfig = ReturnType<typeof readConfig>;
export type SessionInput = z.infer<typeof sessionInputSchema>;
export type Persona = z.infer<typeof personaSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
