import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.js';

function run(seed, steps=300){
  const sim=new Simulation({scenarioId:'rebound',seed});
  for(let i=0;i<steps;i+=1)sim.step();
  return sim;
}

test('同一随机种子产生一致结果',()=>{
  const a=run('REPRO-SEED');
  const b=run('REPRO-SEED');
  assert.deepEqual(a.computeMetrics().cloneCounts,b.computeMetrics().cloneCounts);
  assert.equal(a.computeMetrics().cancerCount,b.computeMetrics().cancerCount);
  assert.equal(a.oxygen[1200],b.oxygen[1200]);
});

test('环境字段保持在有效范围',()=>{
  const sim=run('FIELD-BOUNDS',500);
  for(const value of sim.oxygen)assert.ok(value>=0&&value<=1);
  for(const value of sim.drug)assert.ok(value>=0&&value<=1);
  for(const cell of sim.cancer)assert.ok(cell.health>0&&cell.health<=1.1);
});

test('治疗能产生可观察的负荷下降与反弹事件',()=>{
  const sim=run('THERAPY-ARC',120);
  const before=sim.cancer.length;
  sim.intervene('chemo',0.9);
  let minimum=before;
  for(let i=0;i<1100;i+=1){sim.step();minimum=Math.min(minimum,sim.cancer.length);}
  assert.ok(minimum<before*0.85,`最低负荷 ${minimum} 应低于治疗前 ${before}`);
  assert.ok(sim.events.some(e=>e.title==='初始反应明显'));
  assert.ok(sim.events.some(e=>e.title==='治疗后反弹'));
});

test('序列化后可恢复关键状态',()=>{
  const sim=run('SAVE-LOAD',200);
  sim.intervene('immune',1);
  for(let i=0;i<40;i+=1)sim.step();
  const restored=Simulation.fromState(sim.serialize());
  assert.equal(restored.time,sim.time);
  assert.equal(restored.cancer.length,sim.cancer.length);
  assert.deepEqual(restored.computeMetrics().cloneCounts,sim.computeMetrics().cloneCounts);
});
