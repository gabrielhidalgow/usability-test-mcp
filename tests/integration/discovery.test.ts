import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../../src/mcp/server.js';
import { makeDecision } from '../fixtures/provider.js';

async function fixture() {
  const paths: string[] = []; let mutations = 0;
  const server = createHttpServer((req,res) => {
    paths.push(req.url!); if (req.method === 'POST') mutations++;
    res.setHeader('Content-Type','text/html');
    res.end(`<html><head><title>Fixture</title></head><body><h1>Visible product</h1><p>Useful plans for teams</p><a href='/contact'>Request a specification</a><a href='/about'>About</a><a href='/plans'>Plans</a><a href='/fourth'>Fourth</a><a href='/file.pdf'>Data sheet</a><a href='/hidden' hidden>Hidden</a><p id='fresh'></p><script>document.getElementById('fresh').textContent=localStorage.visited?'Returning':'First visit';localStorage.visited='yes'</script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const address = server.address() as {port:number};
  return { url:`http://127.0.0.1:${address.port}/`, paths, mutations:()=>mutations, close:()=>new Promise<void>(resolve=>server.close(()=>resolve())) };
}
test('discovery prefills are sourced and editable; clean handoff survives restart without leaking setup evidence', async () => {
  const site = await fixture(); const root = await mkdtemp(join(tmpdir(),'discovery-'));
  let server=createServer({artifactRoot:root,headless:true}); let client=new Client({name:'discovery-test-double',version:'1'});
  const connect=async()=>{const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);};
  const call=async(name:string,args:Record<string,unknown>)=>{const r=await client.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r.content));return JSON.parse((r.content as {type:string;text:string}[]).find(c=>c.type==='text')!.text);};
  try {
    await connect();
    let setup=await call('usability_setup_project',{target:site.url,answers:{purpose:'Owner purpose'}});
    const discoveryId=setup.discovery.id;
    assert.equal(setup.discovery.observations.length,4);assert(!site.paths.includes('/fourth'));assert(!site.paths.includes('/hidden'));assert(!site.paths.includes('/file.pdf'));
    assert.match(setup.limitations,/PDF/);assert.equal(setup.answers.purpose,'Owner purpose');
    const suggestion={value:'Setup-only product interpretation',basis:'assumption',sources:['screen-1']};
    const invalid=await client.callTool({name:'usability_save_setup_suggestions',arguments:{discoveryId,suggestions:{purpose:{...suggestion,sources:['screen-4','screen-9']}}}});assert(invalid.isError);
    await call('usability_save_setup_suggestions',{discoveryId,suggestions:{purpose:suggestion,audience:{...suggestion,value:'First-time team owner'},success:{...suggestion,value:'Visible information found'},journeys:[{...suggestion,value:'Explore the product category'}]}});
    setup=await call('usability_setup_project',{discoveryId,answers:{purpose:'Owner purpose'}});
    assert.equal(setup.prefilledAnswers.purpose,'Owner purpose');assert.equal(setup.prefilledAnswers.audience,'First-time team owner');assert.match(setup.notice,/edit, replace, or remove/);
    assert.deepEqual(setup.questions.map((q:{field:string})=>q.field),['priority','boundaries']);
    const saved=await call('usability_save_project',{name:'Fixture',target:site.url,discoveryId,answers:{...setup.prefilledAnswers,priority:'OWNER_ONLY',boundaries:'Read only'},personas:[{context:'First-time visitor'}],journeys:[{id:'explore',scenario:'You are considering a team product',goal:'Find product information',successCriteria:['PRIVATE_EVALUATOR_CRITERION']}]});
    const projectId=saved.profile.id;
    const approved=await call('usability_approve_project',{projectId,ownerApproved:true});assert.match(approved.handoff.prompt,/fresh/);
    for(const context of ['shared','unknown']) assert((await client.callTool({name:'usability_run_project',arguments:{projectId,journeyId:'explore',options:{handoff:{discoveryId,context}}}})).isError);
    assert((await client.callTool({name:'usability_quick_test',arguments:{target:site.url,goal:'Read'}})).isError,'Omitting discovery cannot accidentally bypass known setup evidence');
    await client.close();await server.close();server=createServer({artifactRoot:root,headless:true});client=new Client({name:'fresh-test-double',version:'1'});await connect();
    let state=await call('usability_run_project',{projectId,journeyId:'explore',options:{handoff:{discoveryId,context:'host-reported fresh'}}});
    const participant=JSON.stringify(state.participant);assert(!participant.includes('PRIVATE_EVALUATOR'));assert(!participant.includes('OWNER_ONLY'));assert(!participant.includes('Setup-only'));assert(!participant.includes(discoveryId));assert.match(participant,/First visit/);
    const decision=makeDecision({type:'finish',outcome:'completed',reason:'Visible heading',visibleEvidence:'Visible product'});
    assert((await client.callTool({name:'usability_advance_session',arguments:{runId:state.runId,requestId:state.requestId,decision}})).isError);
    decision.contextIsolation='host-reported fresh';state=await call('usability_advance_session',{runId:state.runId,requestId:state.requestId,decision});
    state=await call('usability_submit_findings',{runId:state.runId,requestId:state.requestId,findings:[]});
    assert.equal(state.status,'completed');assert.equal(state.taskOutcomes[0].handoff.discoveryId,discoveryId);assert.equal(state.taskOutcomes[0].presentation,'background');assert.equal(site.mutations(),0);
  } finally {await client.close();await server.close();await site.close();await rm(root,{recursive:true,force:true});}
});
