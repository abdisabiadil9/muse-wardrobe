import test from 'node:test';
import assert from 'node:assert/strict';
import {agentDefinition,basicTools} from './agent.mjs';
test('basic tools remain available without memory and business tools are preserved',()=>{
 const a=agentDefinition('auto',{memoryEnabled:false});
 assert.deepEqual(a.tools[0].enabled_tools,basicTools);
 assert.ok(basicTools.length>0);
 assert.ok(!basicTools.includes('ImageGen')&&!basicTools.includes('VideoGen'));
 assert.deepEqual(a.tools.filter(t=>t.type==='custom').map(t=>t.name),['read_wardrobe','propose_outfit']);
 assert.ok(!a.system.includes('不调用内置工具'));
});
