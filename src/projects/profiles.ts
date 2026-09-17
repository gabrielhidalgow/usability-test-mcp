import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { personaSchema, sessionInputSchema, roundInputSchema, isHttpUrlWithoutCredentials } from '../config/schema.js';
import { EvidenceRecorder } from '../evidence/recorder.js';

const answer = z.string().trim().min(1).max(2000);
export const projectIdSchema = z.string().regex(/^project-[0-9a-f-]{36}$/);
export const intakeSchema = z.strictObject({ purpose: answer, audience: answer, priority: answer, success: answer, boundaries: answer });
export const questions = {
  purpose: 'What does the product help people do?',
  audience: 'Who are its main users, and what experience or constraints matter?',
  priority: 'Which user outcome or journey matters most for this test?',
  success: 'What visible evidence would show that the user succeeded?',
  boundaries: 'What is safe to test, and what must be avoided? Do not include passwords or secrets.',
};
export const planSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  target: z.url().refine(isHttpUrlWithoutCredentials),
  answers: intakeSchema,
  personas: z.array(personaSchema).min(1).max(5),
  journeys: z.array(z.strictObject({
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    scenario: answer, goal: answer,
    successCriteria: z.array(answer).min(1).max(10),
  })).min(1).max(5),
}).refine(p => new Set(p.journeys.map(j => j.id)).size === p.journeys.length, 'Journey IDs must be unique');
const profileSchema = z.strictObject({ id: projectIdSchema, createdAt: z.string(), approvedAt: z.string().nullable(), plan: planSchema });
export type ProjectProfile = z.infer<typeof profileSchema>;

// Plans are immutable: edits create a new draft ID requiring a new review.
export class ProjectProfiles {
  private recorder: EvidenceRecorder;
  constructor(private root: string) { this.recorder = new EvidenceRecorder(root); }
  private path(id: string) { return join(this.root, 'projects', `${projectIdSchema.parse(id)}.json`); }
  async save(raw: unknown): Promise<ProjectProfile> {
    const profile: ProjectProfile = { id: `project-${randomUUID()}`, createdAt: new Date().toISOString(), approvedAt: null, plan: planSchema.parse(raw) };
    await mkdir(join(this.root, 'projects'), { recursive: true, mode: 0o700 });
    await this.recorder.json(this.path(profile.id), profile);
    return this.get(profile.id);
  }
  async get(id: string): Promise<ProjectProfile> { return profileSchema.parse(JSON.parse(await readFile(this.path(id), 'utf8'))); }
  async list() {
    let files: string[];
    try { files = await readdir(join(this.root, 'projects')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    return Promise.all(files.filter(f => f.endsWith('.json') && projectIdSchema.safeParse(f.slice(0, -5)).success).map(async f => {
      const p = await this.get(f.slice(0, -5));
      return { id: p.id, name: p.plan.name, target: p.plan.target, approvedAt: p.approvedAt };
    }));
  }
  async approve(id: string) {
    const profile = await this.get(id);
    profile.approvedAt ??= new Date().toISOString();
    await this.recorder.json(this.path(id), profile);
    return profile;
  }
}
export function projectRun(profile: ProjectProfile, journeyId: string, participantCount: number) {
  if (!profile.approvedAt) throw new Error('Review and approve this draft plan before running it.');
  const journey = profile.plan.journeys.find(j => j.id === journeyId);
  if (!journey) throw new Error('Choose a journey ID from the saved plan.');
  if (!Number.isInteger(participantCount) || participantCount < 1 || participantCount > profile.plan.personas.length) throw new Error('The plan needs one persona per requested participant.');
  // Owner priorities, evaluator criteria, and suggested routes never enter participant inputs.
  const task = { target: profile.plan.target, scenario: journey.scenario, goal: journey.goal };
  return participantCount === 1
    ? { kind: 'session' as const, input: sessionInputSchema.parse({ ...task, persona: profile.plan.personas[0] }) }
    : { kind: 'round' as const, input: roundInputSchema.parse({ ...task, participantCount, personas: profile.plan.personas.slice(0, participantCount) }) };
}
