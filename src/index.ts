#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { readConfig } from './config/schema.js';
import { createServer } from './mcp/server.js';

try {
  const config = readConfig();
  const servers = new Set<ReturnType<typeof createServer>>();
  const handle = serveStdio(() => { const server = createServer(config); servers.add(server); return server; }, {
    onerror: () => console.error('Usability MCP protocol error; request could not be completed.'),
  });
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await Promise.all([...servers].map(server => server.close()));
    await handle.close();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void shutdown().finally(() => process.exit(0)); });
  }
  process.stdin.once('end', () => { void shutdown(); });
} catch {
  console.error('Usability MCP startup failed. Check environment configuration against .env.example.');
  process.exitCode = 1;
}
