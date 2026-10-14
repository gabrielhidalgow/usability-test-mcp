// A styled Little Ledger for the README images and video only (tests use tests/fixtures/site.ts).
// Visible names stay compatible with the FixtureProvider test double: "Options", "Try this plan", "Set up your workspace".
import { createServer } from 'node:http';

const css = `
*{box-sizing:border-box}body{margin:0;font:17px/1.55 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#14212b;background:#f7f9f8}
a{color:inherit;text-decoration:none}
header{display:flex;align-items:center;gap:36px;padding:22px 56px;background:#fff;border-bottom:1px solid #e3e8e6}
.brand{display:flex;align-items:center;gap:10px;font-weight:750;font-size:20px;letter-spacing:-.01em}
.brand i{width:30px;height:30px;border-radius:50%;background:#1d4ed8;display:inline-grid;place-items:center;color:#fff;font-size:15px;font-weight:700;line-height:1;font-style:normal;padding-left:1px}
nav{display:flex;gap:28px;font-size:16px;color:#4b5b63}nav a:hover{color:#1d4ed8}
.right{margin-left:auto;display:flex;gap:14px;align-items:center;font-size:16px}
.btn{display:inline-block;background:#1d4ed8;color:#fff;border-radius:10px;padding:11px 20px;font-weight:600;border:0;font:inherit;font-weight:600}
.ghost{color:#4b5b63}
main{padding:64px 56px}
.hero{display:grid;grid-template-columns:1.05fr 1fr;gap:56px;align-items:center}
h1{font-size:50px;line-height:1.08;letter-spacing:-.025em;margin:0 0 18px}
.lead{font-size:20px;color:#4b5b63;margin:0 0 30px;max-width:30ch}
.pill{display:inline-block;background:#e8efff;color:#1d4ed8;font-weight:600;font-size:14px;border-radius:999px;padding:5px 12px;margin-bottom:18px}
.mock{background:#fff;border:1px solid #e3e8e6;border-radius:18px;box-shadow:0 24px 60px #1e3a8a1a;padding:22px}
.mock h3{margin:0 0 4px;font-size:15px;color:#4b5b63;font-weight:600}.big{font-size:32px;font-weight:750;letter-spacing:-.02em}
.bars{display:flex;gap:10px;align-items:flex-end;height:110px;margin:18px 0}.bars span{flex:1;border-radius:6px 6px 2px 2px;background:#d4e0ff}.bars span.on{background:#1d4ed8}
.row{display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #eef2f1;font-size:15px}.ok{color:#1d4ed8;font-weight:600}.due{color:#b45309;font-weight:600}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:34px}
.plan{background:#fff;border:1px solid #e3e8e6;border-radius:16px;padding:26px}.plan.pick{border:2px solid #1d4ed8;box-shadow:0 18px 40px #1d4ed81f}
.plan h2{margin:0;font-size:20px}.price{font-size:36px;font-weight:750;margin:10px 0 4px;letter-spacing:-.02em}.price small{font-size:16px;color:#4b5b63;font-weight:500}
.plan ul{padding-left:18px;color:#4b5b63;font-size:15px;margin:14px 0 22px}.plan .btn{display:block;text-align:center}.plan .alt{display:block;text-align:center;border:1px solid #cdd7d4;border-radius:10px;padding:10px;font-weight:600;color:#14212b}
.setup{max-width:560px;background:#fff;border:1px solid #e3e8e6;border-radius:18px;padding:34px;box-shadow:0 24px 60px #1e3a8a14}
label{display:block;font-weight:600;font-size:15px;margin:18px 0 6px}input{width:100%;font:inherit;padding:12px 14px;border:1px solid #cdd7d4;border-radius:10px}
.sk{background:#e9eef6;border-radius:8px}.skc{background:#fff;border:1px solid #e3e8e6;border-radius:16px;padding:22px}
.skrow{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:56px}.dot{width:40px;height:40px;border-radius:12px;background:#e8efff;margin-bottom:16px}
.note{display:flex;gap:10px;align-items:center;background:#e8efff;color:#1d4ed8;border-radius:10px;padding:10px 14px;font-weight:600;font-size:15px;margin-top:6px}`;

// On the plans page "Options" is the current item (text, not a link), as in most real navs.
const header = (path: string) => `<header><a class="brand" href="/"><i>L</i>Little Ledger</a>
  <nav><a href="#">Features</a>${path === '/plans' ? '<span aria-current="page" style="color:#1d4ed8;font-weight:600">Options</span>' : '<a href="/plans">Options</a>'}<a href="#">Customers</a><a href="#">Help</a></nav>
  <div class="right"><a class="ghost" href="#">Sign in</a><a class="btn" href="#">Start free</a></div></header>`;

const pages: Record<string, string> = {
  '/': `<section class="hero"><div><span class="pill">For sole traders and small teams</span>
    <h1>Accounting that takes minutes, not weekends</h1>
    <p class="lead">Send invoices, track expenses and get ready for tax time in one simple place.</p>
    <a class="btn" href="#">Start free</a></div>
    <div class="mock"><h3>Cash this month</h3><div class="big">$18,420</div>
      <div class="bars"><span style="height:40%"></span><span style="height:62%"></span><span style="height:48%"></span><span style="height:75%"></span><span style="height:58%"></span><span class="on" style="height:92%"></span></div>
      <div class="row"><span>Invoice #1042 · Harbour Café</span><span class="ok">Paid</span></div>
      <div class="row"><span>Invoice #1043 · Northside Gym</span><span class="due">Due in 3 days</span></div></div></section>
    <div class="skrow" aria-hidden="true"><div class="skc"><div class="dot"></div><div class="sk" style="width:55%;height:14px;margin-top:0px"></div><div class="sk" style="width:90%;height:12px;margin-top:10px"></div><div class="sk" style="width:75%;height:12px;margin-top:10px"></div></div><div class="skc"><div class="dot"></div><div class="sk" style="width:55%;height:14px;margin-top:0px"></div><div class="sk" style="width:90%;height:12px;margin-top:10px"></div><div class="sk" style="width:75%;height:12px;margin-top:10px"></div></div><div class="skc"><div class="dot"></div><div class="sk" style="width:55%;height:14px;margin-top:0px"></div><div class="sk" style="width:90%;height:12px;margin-top:10px"></div><div class="sk" style="width:75%;height:12px;margin-top:10px"></div></div></div>`,
  '/plans': `<h1>Plans for small teams</h1><p class="lead">Simple monthly pricing. Cancel any time.</p>
    <div class="cards">
      <div class="plan pick"><h2>Starter</h2><div class="price">$12 <small>per month</small></div><p>Starter: $12 per month. Includes one workspace and five projects.</p><a class="btn" href="/start">Try this plan</a></div>
      <div class="plan"><h2>Growth</h2><div class="price">$29 <small>per month</small></div><ul><li>Three workspaces</li><li>Unlimited projects</li><li>Bank feeds</li></ul><a class="alt" href="#">Compare Growth</a></div>
      <div class="plan"><h2>Team</h2><div class="price">$59 <small>per month</small></div><ul><li>Ten users</li><li>Approvals</li><li>Priority support</li></ul><a class="alt" href="#">Compare Team</a></div></div>
    <div aria-hidden="true" style="margin-top:44px"><div class="sk" style="width:180px;height:16px;margin-top:0px"></div><div style="margin-top:18px"><div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:22px;padding:16px 0;border-top:1px solid #e3e8e6"><div class="sk" style="width:60%;height:12px;margin-top:0px"></div><div class="sk" style="width:40%;height:12px;margin-top:0px"></div><div class="sk" style="width:40%;height:12px;margin-top:0px"></div><div class="sk" style="width:40%;height:12px;margin-top:0px"></div></div><div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:22px;padding:16px 0;border-top:1px solid #e3e8e6"><div class="sk" style="width:60%;height:12px;margin-top:0px"></div><div class="sk" style="width:40%;height:12px;margin-top:0px"></div><div class="sk" style="width:40%;height:12px;margin-top:0px"></div><div class="sk" style="width:40%;height:12px;margin-top:0px"></div></div><div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:22px;padding:16px 0;border-top:1px solid #e3e8e6"><div class="sk" style="width:60%;height:12px;margin-top:0px"></div><div class="sk" style="width:40%;height:12px;margin-top:0px"></div><div class="sk" style="width:40%;height:12px;margin-top:0px"></div><div class="sk" style="width:40%;height:12px;margin-top:0px"></div></div></div></div>`,
  '/start': `<div style="display:flex;gap:36px;align-items:flex-start"><div class="setup"><h1 style="font-size:36px">Set up your workspace</h1><div class="note">✓ Starter plan: $12 per month</div>
    <label>Workspace name <input placeholder="Harbour Café"></label><label>Business email <input placeholder="you@example.com"></label>
    <p style="margin-top:22px"><button class="btn" type="button">Create workspace</button></p></div><div class="skc" aria-hidden="true" style="flex:1;max-width:420px"><div class="sk" style="width:45%;height:14px;margin-top:0px"></div><div class="sk" style="width:85%;height:12px;margin-top:18px"></div><div class="sk" style="width:70%;height:12px;margin-top:10px"></div><div style="display:flex;gap:12px;margin-top:26px"><div class="dot" style="margin:0"></div><div style="flex:1"><div class="sk" style="width:60%;height:12px;margin-top:4px"></div><div class="sk" style="width:90%;height:12px;margin-top:10px"></div></div></div><div style="display:flex;gap:12px;margin-top:18px"><div class="dot" style="margin:0"></div><div style="flex:1"><div class="sk" style="width:50%;height:12px;margin-top:4px"></div><div class="sk" style="width:80%;height:12px;margin-top:10px"></div></div></div></div></div>`,
};

export async function startDemoSite(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://demo').pathname;
    const body = pages[path];
    if (!body) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Little Ledger</title><style>${css}</style></head><body>${header(path)}<main>${body}</main></body></html>`);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Demo site did not start');
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((r, j) => server.close(e => e ? j(e) : r())) };
}
