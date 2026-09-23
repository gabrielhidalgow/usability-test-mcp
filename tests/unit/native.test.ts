import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaestroProductDriver, type MaestroRunner } from '../../src/drivers/maestro/driver.js';
import { sessionInputSchema } from '../../src/config/schema.js';
import { Discoveries } from '../../src/projects/discovery.js';
import { guardAction } from '../../src/core/safety.js';
import { actionSchema } from '../../src/core/types.js';
const native = { platform: 'native', target: 'com.example.fixture', native: { deviceId: 'emulator-5554', os: 'android', preparedTestDevice: true }, testEnvironment: true, accessibilityChecks: false, persona: { context: 'Test double only' }, scenario: 'Test', goal: 'Inspect' };

test('native input requires an explicit prepared sandbox device and cannot enable consequential overrides', () => {
  assert(sessionInputSchema.safeParse(native).success);
  for (const change of [{testEnvironment:false},{native:undefined},{accessibilityChecks:true},{target:'com.example.app; rm -rf x'},{allowedCapabilities:['payment']}]) assert(!sessionInputSchema.safeParse({...native,...change}).success);
  assert(!actionSchema.safeParse({type:'enter_text',value:'${SECRET}',visibleLabel:'Search',capability:null}).success);
});

test('Maestro adapter uses one screenshot-driven command, protects device ownership, and cleans temporary flows (test runner, no real device)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'usability-native-test-'));
  await mkdir(join(root, 'screenshots'));
  const flows: unknown[][] = [];
  const runner: MaestroRunner = async (args, cwd) => {
    assert.equal(args[0], '--device'); assert.equal(args[1], 'emulator-5554');
    assert(!args.includes('cloud')); assert(!args.includes('--analyze'));
    const yaml = await readFile(args.at(-1)!, 'utf8');
    const commands = yaml.split('\n').filter(l => l.startsWith('- ')).map(l => JSON.parse(l.slice(2)));
    flows.push(commands);
    const screenshot = commands.find(c => c.takeScreenshot)?.takeScreenshot.path;
    if (screenshot) {
      const directory = join(cwd, 'test-bundle', 'takeScreenshot'); await mkdir(directory, {recursive:true});
      // Explicit fixture PNG; this does not prove a native device was exercised.
      await writeFile(join(directory, screenshot + '.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
    }
  };
  const input = sessionInputSchema.parse(native);
  const config = { input, directory:root, signal:new AbortController().signal };
  const a = new MaestroProductDriver(runner), b = new MaestroProductDriver(runner);
  try {
    await a.start(config);
    await assert.rejects(b.start(config), /active session/);
    await b.stop(); // Must not release a's lock.
    await assert.rejects(b.start(config), /active session/);
    const observation = await a.getObservation();
    assert.equal(observation.viewport.width, 1); assert.deepEqual(observation.candidates, []);
    assert.match(guardAction({type:'tap_point',x:0.5,y:0.5,visibleLabel:'Buy',capability:null},observation,input)!, /payment/);
    await a.tapPoint(0.5, 0.25);
    assert.deepEqual(flows.at(-1), [{tapOn:{point:'50.000%,25.000%',retryTapIfNoChange:false}}]);
    assert.deepEqual(flows[0], [{launchApp:{clearState:false,stopApp:false,permissions:{all:'deny'}}}]);
    await a.stop();
    const count=flows.length; await b.startDiscovery(config); await b.getObservation();
    assert.equal(flows.length,count+1);assert.deepEqual(Object.keys(flows.at(-1)![0] as object),['takeScreenshot'],'Discovery must only capture, never launch or navigate');
    await b.stop();
    const beforeDiscovery=flows.length;
    const discoveries=new Discoveries(root,true);
    const captured=await discoveries.capture({platform:'native',appId:native.target,deviceId:'emulator-5554',os:'android',preparedTestDevice:true,currentAppConfirmed:true},undefined,()=>new MaestroProductDriver(runner));
    assert.equal(captured.observations.length,1);assert.equal(flows.length,beforeDiscovery+1);
    await assert.rejects(discoveries.verifyHandoff({...input,handoff:{discoveryId:captured.id,context:'host-reported fresh'}}),/starting state/);
    await discoveries.verifyHandoff({...input,handoff:{discoveryId:captured.id,context:'host-reported fresh',startingStateConfirmed:true}});
    await b.start(config);
  } finally { await a.stop(); await b.stop(); await rm(root,{recursive:true,force:true}); }
});
