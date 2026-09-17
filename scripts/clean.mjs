import { rmSync } from 'node:fs';
// Build output only. Remove stale compiled files when modules are retired.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
