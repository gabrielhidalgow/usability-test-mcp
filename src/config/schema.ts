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
  name: z.string().min(1).max(80).default('Participant'),
  context: z.string().min(1).max(2000),
  technicalConfidence: z.enum(['low', 'average', 'high']).default('average'),
  productKnowledge: z.enum(['none', 'some', 'experienced']).default('none'),
  constraints: z.array(z.string().max(300)).max(10).default([]),
});
export const sessionBaseSchema = z.strictObject({
  target: z.url().refine(isHttpUrlWithoutCredentials, 'Use an HTTP(S) URL without credentials'),
  platform: z.literal('web').default('web'),
  persona: personaSchema,
  scenario: z.string().min(1).max(4000),
  goal: z.string().min(1).max(2000),
  maxActions: z.number().int().min(1).max(100).default(30),
  timeoutMs: z.number().int().min(1000).max(600000).default(180000),
  viewport: z.enum(['desktop', 'mobile']).default('desktop'),
  accessibilityChecks: z.boolean().default(true),
  interactionMode: z.enum(['standard', 'keyboard']).default('standard'),
  testEnvironment: z.boolean().default(false),
  allowedCapabilities: z.array(capabilitySchema).default([]),
});
export const sessionInputSchema = sessionBaseSchema.refine(
  x => x.testEnvironment || x.allowedCapabilities.length === 0,
  'Capability overrides require testEnvironment: true',
);
export const roundInputSchema = sessionBaseSchema.omit({ persona: true }).extend({
  personas: z.array(personaSchema).min(1).max(5).optional(),
  participantCount: z.number().int().min(1).max(5).default(3),
  personaContext: z.string().min(1).max(2000).default('A first-time visitor pursuing the supplied goal'),
}).refine(x => x.testEnvironment || x.allowedCapabilities.length === 0,
  'Capability overrides require testEnvironment: true')
  .refine(x => !x.personas || x.personas.length === x.participantCount,
    'personas length must equal participantCount');

const envSchema = z.object({
  USABILITY_ARTIFACT_DIR: z.string().min(1).default('.usability'),
  USABILITY_HEADLESS: z.enum(['true', 'false']).default('true'),
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error('Invalid Usability MCP environment configuration; check .env.example');
  const e = parsed.data;
  return {
    artifactRoot: resolve(e.USABILITY_ARTIFACT_DIR), headless: e.USABILITY_HEADLESS === 'true',
  };
}
export type AppConfig = ReturnType<typeof readConfig>;
export type SessionInput = z.infer<typeof sessionInputSchema>;
export type Persona = z.infer<typeof personaSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
