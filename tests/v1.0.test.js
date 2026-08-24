import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.js';
import { validateAndMigrateState } from '../src/state.js';

function run(sim, steps = 240) {
  for (let i = 0; i < steps; i += 1) sim.step();
  return sim;
}

test('v1.0 存档格式与模型版本正确', () => {
  const sim = new Simulation({ scenarioId: 'rebound', seed: 'V2-SAVE' });
  const state = sim.serialize();
  assert.equal(state.version, 3);
  assert.equal(state.modelVersion, '1.0.0');
  assert.equal(state.chronicInflammation.length, sim.width * sim.height);
});

test('慢性炎症压力场保持有限且在长期运行中形成空间信号', () => {
  const sim = run(new Simulation({ scenarioId: 'hypoxic', seed: 'V2-CHRONIC' }), 520);
  const values = Array.from(sim.chronicInflammation);
  assert.ok(values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
  assert.ok(values.some((value) => value > 0.01));
  assert.ok(sim.computeMetrics().averageChronicInflammation > 0);
});

test('T 细胞前体样与终末耗竭代理保持有效范围', () => {
  const sim = run(new Simulation({
    scenarioId: 'immuneCold',
    seed: 'V2-TCELL',
    params: { suppression: 92, matrixDensity: 76, tInfiltration: 70 },
  }), 420);
  assert.ok(sim.tCells.length > 0);
  for (const cell of sim.tCells) {
    assert.ok(cell.stemlike >= 0 && cell.stemlike <= 1);
    assert.ok(cell.terminalExhaustion >= 0 && cell.terminalExhaustion <= 1);
  }
  const metrics = sim.computeMetrics();
  assert.ok(metrics.stemlikeTCellFraction >= 0 && metrics.stemlikeTCellFraction <= 1);
  assert.ok(metrics.terminalExhaustedTCellFraction >= 0 && metrics.terminalExhaustedTCellFraction <= 1);
});

test('新增生态指标保持归一化边界', () => {
  const metrics = run(new Simulation({ scenarioId: 'resistant', seed: 'V2-METRICS' }), 380).computeMetrics();
  for (const key of ['clonalDiversity', 'immuneExclusionIndex', 'perfusionHeterogeneity', 'necroticDebrisFraction']) {
    assert.ok(Number.isFinite(metrics[key]), `${key} 应为有限数`);
    assert.ok(metrics[key] >= 0 && metrics[key] <= 1, `${key} 应位于 0–1`);
  }
});

test('v2 存档可迁移并补入 v1.0 字段', () => {
  const sim = run(new Simulation({ scenarioId: 'rebound', seed: 'V2-MIGRATE' }), 30);
  const legacy = sim.serialize();
  legacy.version = 2;
  legacy.modelVersion = '1.1.0';
  delete legacy.chronicInflammation;
  legacy.tCells = legacy.tCells.map(({ stemlike, terminalExhaustion, ...cell }) => cell);
  const migrated = validateAndMigrateState(legacy);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.migratedFromVersion, 2);
  assert.equal(migrated.chronicInflammation.length, sim.width * sim.height);
  assert.ok(migrated.tCells.every((cell) => Number.isFinite(cell.stemlike) && Number.isFinite(cell.terminalExhaustion)));
  const restored = Simulation.fromState(migrated);
  assert.equal(restored.serialize().version, 3);
});


test('持续低氧与慢性压力提高终末耗竭样状态负荷', () => {
  const createControlled = (stressed) => {
    const sim = new Simulation({
      scenarioId: 'growth',
      seed: stressed ? 'V2-T-STRESS' : 'V2-T-CONTROL',
      params: { suppression: stressed ? 92 : 0, tInfiltration: 0 },
    });
    sim.cancer = [];
    sim.macrophages = [];
    sim.fibroblasts = [];
    sim.tCells = [];
    const cell = sim.spawnTCell(false);
    cell.x = sim.width / 2;
    cell.y = sim.height / 2;
    cell.energy = 1;
    cell.stemlike = 0.9;
    cell.exhaustion = 0.12;
    cell.terminalExhaustion = 0;
    sim.oxygen.fill(stressed ? 0.08 : 0.9);
    sim.suppression.fill(stressed ? 0.85 : 0.02);
    sim.chronicInflammation.fill(stressed ? 0.72 : 0);
    return sim;
  };
  const stressed = createControlled(true);
  const control = createControlled(false);
  for (let i = 0; i < 140; i += 1) {
    stressed.updateTCells(0.045);
    control.updateTCells(0.045);
  }
  assert.ok(stressed.tCells.length > 0 && control.tCells.length > 0);
  assert.ok(stressed.tCells[0].terminalExhaustion > control.tCells[0].terminalExhaustion + 0.08);
  assert.ok(stressed.tCells[0].stemlike < control.tCells[0].stemlike);
});

test('巨噬细胞低氧方向感知指向更低氧邻域', () => {
  const sim = new Simulation({ scenarioId: 'growth', seed: 'V2-MAC-HYPOXIA' });
  sim.oxygen.fill(0.8);
  const x = Math.floor(sim.width / 2);
  const y = Math.floor(sim.height / 2);
  const lowX = x + 2;
  const lowY = y;
  sim.oxygen[lowY * sim.width + lowX] = 0.02;
  const target = sim.hypoxiaGradientTarget(x, y);
  assert.ok(target.x > x, '目标应朝向设置的低氧邻域');
});
