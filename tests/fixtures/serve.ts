import { startFixture } from './site.js';
const fixture = await startFixture(4173);
console.log(`Disposable fixture: ${fixture.url}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void fixture.close(); });
