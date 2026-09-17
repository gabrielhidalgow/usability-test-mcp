import { createServer, type Server } from 'node:http';

export async function startFixture(port = 0): Promise<{ url: string; close: () => Promise<void>; mutations: () => number; reads: () => number }> {
  let mutations = 0;
  let reads = 0;
  const server: Server = createServer((req, res) => {
    reads++;
    if (req.method === 'POST') { mutations++; res.writeHead(200); res.end('stored'); return; }
    const path = new URL(req.url!, 'http://fixture').pathname;
    if (path === '/redirect') {
      res.writeHead(302, { Location: new URL(req.url!, 'http://fixture').searchParams.get('to') ?? '/plans' }); res.end(); return;
    }
    const content = path === '/plans' ? `
      <h1>Plans for small teams</h1><p>Starter: $12 per month. Includes one workspace and five projects.</p>
      <a href="/start">Try this plan</a><p><a href="/">Home</a></p>`
      : path === '/start' ? `<h1>Set up your workspace</h1><p>Starter plan: $12 per month.</p>
      <label>Workspace name <input name="workspace"></label><button onclick="document.querySelector('main').insertAdjacentHTML('beforeend','<p>Draft saved locally</p>')">Save draft</button>`
      : path === '/safety' ? `<h1>Disposable safety fixture</h1><button onclick="fetch('/write',{method:'POST'})">Ping</button>
      <button onclick="fetch('/write',{method:'POST'})">Delete all records</button>
      <label>Password <input type="password" value="fixture-secret"></label>`
      : `<h1>Little Ledger</h1><p>Simple accounting for your small business.</p>
      <a href="/plans">Options</a><p>Get organized in minutes.</p><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='30' height='30'%3E%3Crect width='30' height='30' fill='gray'/%3E%3C/svg%3E">
      <p id="fresh"></p><p hidden>HIDDEN_ROUTE_SECRET</p><script>document.querySelector('#fresh').textContent=localStorage.getItem('visited')?'Returning visitor':'First visit'; localStorage.setItem('visited','yes')</script>
      <p style="margin-top:1500px">OFFSCREEN_SECRET</p>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Little Ledger test fixture</title>
      <style>body{font:20px system-ui;max-width:850px;margin:48px auto;padding:0 24px;line-height:1.5}a,button,input{font:inherit;margin:12px 0}a{display:inline-block;color:#154fa1}button{padding:8px 20px}:focus-visible{outline:4px solid #d64d00;outline-offset:4px}</style></head><body><main>${content}</main></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not start');
  return { url: `http://127.0.0.1:${address.port}`, mutations: () => mutations, reads: () => reads,
    close: () => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) };
}
