import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Page } from 'playwright';
import { PlaywrightProductDriver } from '../../src/drivers/playwright/driver.js';
import { sessionInputSchema, readConfig } from '../../src/config/schema.js';
import { guardAction } from '../../src/core/safety.js';
import { SessionOrchestrator } from '../../src/core/session-orchestrator.js';
import { EvidenceRecorder } from '../../src/evidence/recorder.js';
import { FixtureProvider, makeDecision } from '../fixtures/provider.js';

async function fixture() {
  let writes=0;
  const server=createServer((req,res)=>{
    if(req.method==='POST') writes++;
    res.setHeader('Content-Type','text/html');
    res.end(`<html lang='en'><head><title>Contact fixture</title></head><body><h1>Product</h1>${req.url==='/contact'?"<h2>Contact information</h2><button onclick=\"fetch('/message',{method:'POST'})\">Send enquiry</button>":"<a href='/contact'>Request a specification</a><a href='/contact' onclick=\"fetch('/message',{method:'POST'})\">Contact us</a>"}</body></html>`);
  });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  return {url:`http://127.0.0.1:${(server.address() as {port:number}).port}/`,writes:()=>writes,close:()=>new Promise<void>(r=>server.close(()=>r()))};
}
const base={persona:{name:'Visible test double',context:'Fixture visitor'},scenario:'Explore',goal:'Find contact information',accessibilityChecks:false};
test('contact document links work without communication; send actions and hidden mutations remain blocked',async()=>{
  const site=await fixture();const root=await mkdtemp(join(tmpdir(),'contact-test-'));await mkdir(join(root,'screenshots'));
  const input=sessionInputSchema.parse({...base,target:site.url,presentation:'background'});let driver=new PlaywrightProductDriver(false);
  const config={input,directory:root,signal:new AbortController().signal};
  try{
    await driver.start(config);let observation=await driver.getObservation();
    assert.equal((driver as unknown as {visible:boolean}).visible,false);
    const target=observation.candidates.find(c=>c.name==='Request a specification')!;
    assert.equal(target.contactNavigation,true);
    assert.equal(guardAction({type:'click',target:target.ref,capability:'communication'},observation,input),null);
    await driver.pressKey('Tab');observation=await driver.getObservation();
    assert.equal(guardAction({type:'key',key:'Enter',capability:null},observation,input),null);
    await driver.pressKey('Enter');observation=await driver.getObservation();
    assert.match(observation.visibleText,/Contact information/);assert.equal(driver.takePolicyDiagnostics().length,0);
    const send=observation.candidates.find(c=>c.name==='Send enquiry')!;
    assert.match(guardAction({type:'click',target:send.ref,capability:null},observation,input)!,/communication/);
    await driver.stop();driver=new PlaywrightProductDriver(true);await driver.start(config);observation=await driver.getObservation();
    const malicious=observation.candidates.find(c=>c.name==='Contact us')!;
    driver.setActionCapability('communication');await driver.click({ref:malicious.ref});
    assert(driver.takePolicyDiagnostics().some(d=>d.method==='POST' && d.stopsJourney));assert.equal(site.writes(),0);
  }finally{await driver.stop();await site.close();await rm(root,{recursive:true,force:true});}
});

test('visible browser overlays stay outside evidence and closing a window cancels a waiting session', {skip:process.platform==='linux'&&!process.env.DISPLAY&&!process.env.WAYLAND_DISPLAY}, async()=>{
  const site=await fixture();const root=await mkdtemp(join(tmpdir(),'visible-test-'));await mkdir(join(root,'screenshots'));
  const driver=new PlaywrightProductDriver(true);const input=sessionInputSchema.parse({...base,target:site.url,presentation:'visible'});
  try {
    assert.equal(readConfig({}).headless,false);assert.equal(readConfig({USABILITY_HEADLESS:'true'}).headless,true);
    await driver.start({input,directory:root,signal:new AbortController().signal});
    await driver.setViewStatus({participant:'Visible test double',step:1,phase:'waiting'});
    const observation=await driver.getObservation();
    assert(!observation.visibleText.includes('Waiting for AI'));assert(!observation.semantics.tree.includes('Usability Test MCP'));
    assert(observation.capture?.settled);
    const page=(driver as unknown as {page:Page}).page;
    const raw=await page.screenshot();assert(!raw.equals(await readFile(observation.screenshot.path)),'Clean evidence must exclude the visible badge');
    const target=observation.candidates.find(c=>c.name==='Request a specification')!;
    assert((await driver.click({ref:target.ref})).ok);
    await driver.stop();
    const waitingDriver=new PlaywrightProductDriver(false);const provider=new FixtureProvider();
    provider.decideNextAction=async()=>{await (waitingDriver as unknown as {page:Page}).page.close();return new Promise(()=>{});};
    const run=await new SessionOrchestrator(new EvidenceRecorder(root),()=>waitingDriver).run(input,provider);
    assert.equal(run.session.status,'cancelled');assert.match(run.session.reason,/window closed/);assert(run.session.initialObservation);
  } finally{await driver.stop();await site.close();await rm(root,{recursive:true,force:true});}
});
