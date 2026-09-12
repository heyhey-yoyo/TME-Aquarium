import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.js';
import { SCENARIOS } from '../src/scenarios.js';
import { parseAndValidateStateText } from '../src/state.js';

test('默认场景入口边缘细胞存档可恢复，且不改变坐标或后续轨迹', () => {
  const sim = new Simulation({ scenarioId: 'rebound', seed: 'TME-7FH2-K9P4' });
  assert.ok(sim.macrophages.some(cell => cell.y < 0), '覆盖真实默认种子的边缘生成');
  const raw = JSON.stringify(sim.serialize());
  const state = parseAndValidateStateText(raw);
  assert.deepEqual(state.macrophages, JSON.parse(raw).macrophages);
  const restored = Simulation.fromState(state);
  for (let i = 0; i < 20; i++) { sim.step(); restored.step(); }
  assert.deepEqual(restored.serialize(), sim.serialize());
});

test('所有场景、多随机种子的初始化状态均可 JSON 往返恢复', () => {
  for (const scenario of Object.values(SCENARIOS)) for (let i = 0; i < 10; i++) {
    const sim = new Simulation({ scenarioId: scenario.id, seed: `storage-${i}` });
    const original = sim.serialize();
    const restored = parseAndValidateStateText(JSON.stringify(original));
    assert.deepEqual(restored.macrophages, original.macrophages);
    assert.deepEqual(restored.tCells, original.tCells);
  }
});

test('边缘入口例外仍拒绝越界、非有限坐标，且不放宽癌细胞范围', () => {
  const original = new Simulation({ scenarioId: 'rebound', seed: 'TME-7FH2-K9P4' }).serialize();
  for (const y of [-0.401, 60, Infinity]) {
    const state = structuredClone(original); state.macrophages[0].y = y;
    assert.throws(() => parseAndValidateStateText(JSON.stringify(state)), /macrophages/);
  }
  const state = structuredClone(original); state.cancer[0].y = -0.01;
  assert.throws(() => parseAndValidateStateText(JSON.stringify(state)), /cancer/);
});
