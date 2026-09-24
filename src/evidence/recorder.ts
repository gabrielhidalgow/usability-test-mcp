import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ArtifactPaths, SessionRecord, UsabilityReport } from '../core/types.js';
import { redact } from '../core/safety.js';
import { renderMarkdown, renderDetailedMarkdown } from '../reports/markdown.js';

export const artifactIdSchema = z.string().regex(/^(session|round)-[0-9a-f-]{36}$/);
export class EvidenceRecorder {
  constructor(readonly root: string) {}
  async create(kind: 'session' | 'round'): Promise<{ id: string; paths: ArtifactPaths }> {
    const id = `${kind}-${randomUUID()}`;
    const paths = this.paths(id);
    await mkdir(join(paths.directory, 'screenshots'), { recursive: true, mode: 0o700 });
    await mkdir(join(paths.directory, 'accessibility'), { recursive: true, mode: 0o700 });
    return { id, paths };
  }
  paths(id: string): ArtifactPaths {
    artifactIdSchema.parse(id);
    const directory = resolve(this.root, id.startsWith('round-') ? 'rounds' : 'sessions', id);
    return { directory, report: join(directory, 'report.md'), details: join(directory, 'details.md'), json: join(directory, 'report.json'),
      journey: join(directory, id.startsWith('round-') ? 'round.json' : 'session.json') };
  }
  async json(path: string, value: unknown): Promise<void> {
    // Redact strings recursively; redacting serialized JSON could corrupt its syntax.
    const content = JSON.stringify(value, (_key, v: unknown) => typeof v === 'string' ? redact(v) : v, 2);
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, content + '\n', { mode: 0o600 });
    await rename(temp, path);
  }
  async checkpoint(session: SessionRecord): Promise<void> {
    await this.json(this.paths(session.id).journey, session);
  }
  async provenance(report: UsabilityReport): Promise<UsabilityReport> {
    for (const [file, key] of [['correction.json', 'correction'], ['superseded.json', 'supersededBy']] as const) {
      try {
        const saved = JSON.parse(await readFile(join(this.paths(report.id).directory, file), 'utf8'));
        if (key === 'correction') report.correction = saved;
        else report.supersededBy = saved.supersededBy;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return report;
  }
  async finish(report: UsabilityReport): Promise<ArtifactPaths> {
    await this.provenance(report);
    const paths = this.paths(report.id);
    await this.json(paths.json, report);
    await writeFile(paths.details, redact(renderDetailedMarkdown(report, paths.directory)), { mode: 0o600 });
    await writeFile(paths.report, redact(renderMarkdown(report, paths.directory)), { mode: 0o600 });
    return paths;
  }
  async read(id: string, format: 'json' | 'markdown' | 'details' | 'journey'): Promise<string> {
    const paths = this.paths(id);
    if (format === 'journey') return readFile(paths.journey, 'utf8');
    const report = await this.provenance(JSON.parse(await readFile(paths.json, 'utf8')));
    if (format === 'json') return JSON.stringify(report, null, 2);
    return redact(format === 'details' ? renderDetailedMarkdown(report, paths.directory) : renderMarkdown(report, paths.directory));
  }
}
