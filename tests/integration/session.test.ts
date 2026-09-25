import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceRecorder } from '../../src/evidence/recorder.js';
import { SessionOrchestrator } from '../../src/core/session-orchestrator.js';
import { PlaywrightProductDriver } from '../../src/drivers/playwright/driver.js';
import { startFixture } from '../fixtures/site.js';
import { FixtureProvider, makeDecision } from '../fixtures/provider.js';

export const fixtureInput = (target: string) => ({ target, persona: { name: 'Alex', context: 'Small business owner' },
  scenario: 'You are looking for simple accounting software.', goal: 'Find the monthly price and reach workspace setup.',
  maxActions: 10, timeoutMs: 30000 });

test('one participant navigates iteratively, stores screenshots and produces axe and evidence-linked reports', async () => {
  const fixture = await startFixture();
  const root = await mkdtemp(join(tmpdir(), 'usability-session-'));
  try {
    const runner = new SessionOrchestrator(new EvidenceRecorder(root), () => new PlaywrightProductDriver());
    const run = await runner.run(fixtureInput(fixture.url), new FixtureProvider());
    assert.equal(run.session.status, 'completed', run.session.reason);
    assert.equal(run.session.actions, 2);
    assert.equal(run.session.journey.length, 3);
    assert.equal(run.report.findings[0]?.evidence[0]?.stepNumbers[0], 1);
    assert.equal(run.session.accessibility.length, 3);
    assert(run.session.accessibility[0]?.findings.some(f => f.id === 'image-alt'));
    assert(!run.session.initialObservation?.visibleText.includes('HIDDEN_ROUTE_SECRET'));
    assert(!run.session.initialObservation?.visibleText.includes('OFFSCREEN_SECRET'));
    assert(run.session.initialObservation?.visibleText.includes('First visit'));
    for (const step of run.session.journey) {
      const png = await readFile(step.before.screenshot.path);
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      if (step.after) assert((await stat(step.after.screenshot.path)).size > 100);
    }
    const md = await readFile(run.paths.report, 'utf8');
    assert.match(md, /synthetic participants/);
    assert.match(md, /Recommended actions/);
    assert.match(md, /details.md/);
    const details = await readFile(run.paths.details, 'utf8');
    assert.match(details, /Observed behaviour/);
    assert.match(details, /Why this may be a usability problem/);
    assert.doesNotMatch(md, /overall usability score/i);
    assert.equal(JSON.parse(await readFile(run.paths.journey, 'utf8')).status, 'completed');
    assert.equal(fixture.mutations(), 0);
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test('unapproved POST is blocked even when a button label looks harmless', async () => {
  const fixture = await startFixture(); const root = await mkdtemp(join(tmpdir(), 'usability-safety-'));
  try {
    const provider = new FixtureProvider();
    provider.decideNextAction = async ({ observation }) => makeDecision({ type: 'click',
      target: observation.candidates.find(c => c.name === 'Ping')!.ref, capability: null });
    const run = await new SessionOrchestrator(new EvidenceRecorder(root), () => new PlaywrightProductDriver())
      .run({ ...fixtureInput(fixture.url + '/safety'), accessibilityChecks: false }, provider);
    assert.equal(run.session.status, 'blocked');
    assert.equal(fixture.mutations(), 0);
    assert(run.report.policyDiagnostics?.some(d => d.reason === 'mutation-denied' && d.stopsJourney));
    assert.equal(run.report.findings.length, 0);
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test('keyboard-only journey uses fresh browser focus and records every key', async () => {
  const fixture = await startFixture(); const root = await mkdtemp(join(tmpdir(), 'usability-keys-'));
  try {
    const runner = new SessionOrchestrator(new EvidenceRecorder(root), () => new PlaywrightProductDriver());
    const run = await runner.run({ ...fixtureInput(fixture.url), interactionMode: 'keyboard', accessibilityChecks: false }, new FixtureProvider());
    assert.equal(run.session.status, 'completed', run.session.reason);
    assert(run.session.journey.some(s => s.before.semantics.focused?.includes('Options')));
    assert(run.session.journey.every(s => ['key', 'finish'].includes(s.decision.selectedAction.type)));
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test('redirects cannot escape the permitted origin, while same-origin redirects work', async () => {
  const fixture = await startFixture(); const other = await startFixture();
  const root = await mkdtemp(join(tmpdir(), 'usability-redirect-'));
  try {
    const runner = new SessionOrchestrator(new EvidenceRecorder(root), () => new PlaywrightProductDriver());
    const blocked = await runner.run({ ...fixtureInput(`${fixture.url}/redirect?to=${encodeURIComponent(other.url)}`), accessibilityChecks: false }, new FixtureProvider());
    assert.equal(blocked.session.status, 'error');
    assert.equal(other.reads(), 0, 'Cross-origin redirect made a request before policy validation');
    const permitted = await runner.run({ ...fixtureInput(fixture.url + '/redirect'), accessibilityChecks: false }, new FixtureProvider());
    assert.equal(permitted.session.status, 'completed', permitted.session.reason);
  } finally { await fixture.close(); await other.close(); await rm(root, { recursive: true, force: true }); }
});


test('slow document navigation is observed without replaying the click', async () => {
  let destinationReads = 0;
  const site = createServer(async (request, response) => {
    if (request.url === '/article') { destinationReads++; await delay(6000); }
    response.setHeader('Content-Type', 'text/html');
    response.end(request.url === '/article' ? '<h1>Explanation available</h1>' : '<a href="/article">Read explanation</a>');
  });
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  assert(address && typeof address !== 'string');
  const root = await mkdtemp(join(tmpdir(), 'usability-slow-navigation-'));
  try {
    const provider = new FixtureProvider();
    provider.decideNextAction = async ({ observation }) => observation.visibleText.includes('Explanation available')
      ? makeDecision({ type: 'finish', outcome: 'completed', reason: 'Explanation reached', visibleEvidence: 'Explanation available' })
      : makeDecision({ type: 'click', target: observation.candidates.find(c => c.name === 'Read explanation')!.ref, capability: null });
    provider.evaluateObservation = async () => [];
    const run = await new SessionOrchestrator(new EvidenceRecorder(root), () => new PlaywrightProductDriver())
      .run({ ...fixtureInput(`http://127.0.0.1:${address.port}`), accessibilityChecks: false }, provider);
    assert.equal(run.session.status, 'completed', run.session.reason);
    assert.equal(run.session.journey[0]?.result.ok, true);
    assert.equal(destinationReads, 1);
  } finally { await new Promise<void>(resolve => site.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});


test('blocked passive resources are diagnosed without ending a readable journey or leaking request data', async () => {
  let prohibitedReads = 0;
  const site = createServer((request, response) => {
    if (request.url?.startsWith('/share/')) prohibitedReads++;
    response.setHeader('Content-Type', 'text/html');
    response.end(request.url === '/article'
      ? '<h1>Explanation available</h1><img src="/share/image.png?token=private-canary"><iframe src="http://127.0.0.1:1/blocked"></iframe>'
      : '<a href="/article">Read explanation</a>');
  });
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
  const address = site.address(); assert(address && typeof address !== 'string');
  const root = await mkdtemp(join(tmpdir(), 'usability-policy-resources-'));
  try {
    const provider = new FixtureProvider();
    provider.decideNextAction = async ({ observation }) => observation.visibleText.includes('Explanation available')
      ? makeDecision({ type: 'finish', outcome: 'completed', reason: 'Explanation reached', visibleEvidence: 'Explanation available' })
      : makeDecision({ type: 'click', target: observation.candidates.find(c => c.name === 'Read explanation')!.ref, capability: null });
    provider.evaluateObservation = async () => [];
    const run = await new SessionOrchestrator(new EvidenceRecorder(root), () => new PlaywrightProductDriver())
      .run({ ...fixtureInput(`http://127.0.0.1:${address.port}`), accessibilityChecks: false }, provider);
    assert.equal(run.session.status, 'completed', run.session.reason);
    assert.equal(prohibitedReads, 0, 'Blocked resource reached the server');
    assert(run.report.policyDiagnostics?.some(d => d.reason === 'capability-denied' && d.resourceType === 'image' && !d.stopsJourney));
    assert(run.report.policyDiagnostics?.some(d => d.reason === 'cross-origin-navigation' && !d.mainFrameNavigation && !d.stopsJourney));
    assert(!JSON.stringify(run.report.policyDiagnostics).includes('private-canary'));
    assert(run.report.limitations.some(l => l.includes('Background resources')));
    assert.match(await readFile(run.paths.report, 'utf8'), /Blocked requests:\*\* [^\n]*page resource\(s\)[^\n]*provisional/);
    assert.equal(run.report.findings.length, 0);
  } finally { await new Promise<void>(resolve => site.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

test('captures wait for finite entrance motion but bound continuously moving content', async () => {
  const site = createServer((request,response) => {
    const infinite = request.url === '/infinite';
    response.setHeader('Content-Type','text/html');
    response.end(`<style>@keyframes appear{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}} h1{animation:appear ${infinite?'0.6s infinite alternate':'0.8s forwards'}}</style><h1>Visible explanation</h1>`);
  });
  await new Promise<void>(resolve=>site.listen(0,'127.0.0.1',resolve));
  const address=site.address();assert(address&&typeof address!=='string');
  const root=await mkdtemp(join(tmpdir(),'usability-settle-'));
  try {
    const provider=new FixtureProvider();
    provider.decideNextAction=async()=>makeDecision({type:'finish',outcome:'completed',reason:'Heading visible',visibleEvidence:'Visible explanation'});
    provider.evaluateObservation=async()=>[];
    const runner=new SessionOrchestrator(new EvidenceRecorder(root),()=>new PlaywrightProductDriver());
    const finite=await runner.run({...fixtureInput(`http://127.0.0.1:${address.port}`),accessibilityChecks:false},provider);
    assert.equal(finite.session.initialObservation?.capture?.settled,true);
    assert(finite.session.initialObservation!.capture!.waitedMs >= 800);
    assert(finite.session.initialObservation?.visibleText.includes('Visible explanation'));
    const moving=await runner.run({...fixtureInput(`http://127.0.0.1:${address.port}/infinite`),accessibilityChecks:false},provider);
    assert.equal(moving.session.initialObservation?.capture?.settled,false);
    assert(moving.session.initialObservation!.capture!.waitedMs < 4000);
    assert(moving.report.limitations.some(l=>l.includes('did not settle')));
  } finally {await new Promise<void>(resolve=>site.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});

test('pre-interaction background writes stay blocked with warnings; delayed writes after interaction remain fatal', async () => {
  let writes = 0; let forbiddenReads = 0;
  const site = createServer((req,res) => {
    if (req.method === 'POST') writes++;
    if (req.url?.startsWith('/share/')) forbiddenReads++;
    res.setHeader('Content-Type','text/html');
    res.end(`<h1>Readable product</h1><button onclick="setTimeout(()=>fetch('/write?token=secret-request',{method:'POST',body:'secret-body'}).catch(()=>{}),150)">Explore</button><script>
      fetch('/write?token=secret-request',{method:'POST',body:'secret-body'}).catch(()=>{});
      fetch('/share/data?token=secret-request').catch(()=>{});
      const xhr=new XMLHttpRequest();xhr.open('POST','/xhr');xhr.send('secret-body');
      navigator.sendBeacon('/beacon','secret-body');
    </script>`);
  });
  await new Promise<void>(resolve=>site.listen(0,'127.0.0.1',resolve));
  const address=site.address();assert(address&&typeof address!=='string');
  const root=await mkdtemp(join(tmpdir(),'background-writes-'));
  const runner=new SessionOrchestrator(new EvidenceRecorder(root),()=>new PlaywrightProductDriver());
  const input={...fixtureInput(`http://127.0.0.1:${address.port}/`),accessibilityChecks:false};
  try {
    const provider=new FixtureProvider();provider.evaluateObservation=async()=>[];
    provider.decideNextAction=async({observation,environmentWarnings})=>{
      assert.match(environmentWarnings?.join(' ')??'',/Reduced fidelity/);
      assert.match(observation.visibleText,/Readable product/);
      return makeDecision({type:'finish',outcome:'completed',reason:'Heading visible',visibleEvidence:'Readable product'});
    };
    const readable=await runner.run(input,provider);assert.equal(readable.session.status,'completed');
    assert.equal(writes,0);assert.equal(forbiddenReads,0);
    const diagnostics=readable.report.policyDiagnostics!;
    for(const resource of ['fetch','xhr','ping'])assert(diagnostics.some(d=>d.resourceType===resource&&d.method==='POST'&&!d.stopsJourney&&d.requestContext==='before-first-interaction'));
    assert(diagnostics.every(d=>d.destination==='same-origin'));
    assert(!JSON.stringify(diagnostics).includes('secret-'));
    assert.match(await readFile(readable.paths.details,'utf8'),/purpose unknown/);
    provider.decideNextAction=async({observation,history})=>{
      if(!history.length)return makeDecision({type:'click',target:observation.candidates.find(c=>c.name==='Explore')!.ref,capability:null});
      await delay(300);
      return makeDecision({type:'finish',outcome:'completed',reason:'Still visible',visibleEvidence:'Readable product'});
    };
    const delayed=await runner.run(input,provider);assert.equal(delayed.session.status,'blocked');
    assert(delayed.report.policyDiagnostics?.some(d=>d.method==='POST'&&d.stopsJourney&&d.requestContext==='after-interaction'));
    assert.equal(writes,0);assert.equal(forbiddenReads,0);
  } finally {await new Promise<void>(resolve=>site.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});

test('third-party tracking writes after a click stay blocked but do not end the journey', async () => {
  let writes = 0;
  const tracker = createServer((req, res) => { if (req.method === 'POST') writes++; res.end('ok'); });
  await new Promise<void>(resolve => tracker.listen(0, '127.0.0.1', resolve));
  const trackerPort = (tracker.address() as { port: number }).port;
  const site = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    // 'localhost' is a different site from '127.0.0.1', standing in for an analytics domain.
    const track = `fetch('http://localhost:${trackerPort}/collect',{method:'POST',body:'event'}).catch(()=>{});navigator.sendBeacon('http://localhost:${trackerPort}/b','x')`;
    res.end(req.url === '/pricing' ? `<h1>Pricing</h1><p>Gold $159 per month</p><script>${track}</script>` : `<h1>Home</h1><a href="/pricing" onclick="${track.replace(/"/g, '&quot;')}">Pricing</a>`);
  });
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
  const address = site.address(); assert(address && typeof address !== 'string');
  const root = await mkdtemp(join(tmpdir(), 'third-party-writes-'));
  try {
    const provider = new FixtureProvider(); provider.evaluateObservation = async () => [];
    provider.decideNextAction = async ({ observation, environmentWarnings }) => observation.visibleText.includes('Gold $159')
      ? (assert.deepEqual(environmentWarnings, [], 'third-party tracking alone does not reduce fidelity'), makeDecision({ type: 'finish', outcome: 'completed', reason: 'Price visible', visibleEvidence: 'Gold $159 per month' }))
      : makeDecision({ type: 'click', target: observation.candidates.find(c => c.name === 'Pricing')!.ref, capability: null });
    const run = await new SessionOrchestrator(new EvidenceRecorder(root), () => new PlaywrightProductDriver())
      .run({ ...fixtureInput(`http://127.0.0.1:${address.port}/`), accessibilityChecks: false }, provider);
    assert.equal(run.session.status, 'completed', run.session.reason);
    const after = run.report.policyDiagnostics!.filter(d => d.requestContext === 'after-interaction' && d.method === 'POST');
    assert(after.length > 0 && after.every(d => d.destination === 'third-party' && !d.stopsJourney));
    assert.equal(writes, 0, 'blocked requests never reach the tracker');
    assert(!run.session.warnings.some(w => w.includes('Background resources were blocked')));
    const md = await readFile(run.paths.report, 'utf8');
    assert.match(md, /third-party tracking request\(s\) \(no effect on what was shown\)/); assert.match(md, /None changed what the participant saw/);
    assert.doesNotMatch(md, /Coverage gaps:\*\* [^\n]*blocked/);
    const details = await readFile(run.paths.details, 'utf8');
    assert.match(details, /\| tracking \| mutation-denied \(request\) \|/);
  } finally { await new Promise<void>(r => site.close(() => r())); await new Promise<void>(r => tracker.close(() => r())); await rm(root, { recursive: true, force: true }); }
});
