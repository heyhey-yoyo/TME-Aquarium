import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.js';
import { SCENARIOS, getScenario } from '../src/scenarios.js';
import { validateAndMigrateState } from '../src/state.js';

function advance(simulation, steps, dt) {
  for (let index = 0; index < steps; index += 1) simulation.step(dt);
  return simulation;
}

function average(field) {
  let sum = 0;
  for (const value of field) sum += value;
  return sum / field.length;
}

test('六个场景均定义并初始化巨噬细胞与成纤维细胞', () => {
  for (const id of Object.keys(SCENARIOS)) {
    const scenario = getScenario(id);
    const simulation = new Simulation({ scenarioId: id, seed: `SCENE-${id}` });
    assert.ok(Number.isInteger(scenario.initialMacrophages) && scenario.initialMacrophages > 0, `${id} 缺少巨噬细胞初值`);
    assert.ok(Number.isInteger(scenario.initialFibroblasts) && scenario.initialFibroblasts > 0, `${id} 缺少成纤维细胞初值`);
    assert.equal(simulation.macrophages.length, scenario.initialMacrophages);
    assert.equal(simulation.fibroblasts.length, scenario.initialFibroblasts);
    assert.ok(Number.isFinite(simulation.params.macrophageRecruitment));
    assert.ok(Number.isFinite(simulation.params.fibroblastActivation));
  }
});

test('固定种子复现新增实体和新增环境场', () => {
  const left = advance(new Simulation({ scenarioId: 'fibrotic', seed: 'NEW-REPRO' }), 180);
  const right = advance(new Simulation({ scenarioId: 'fibrotic', seed: 'NEW-REPRO' }), 180);
  assert.deepEqual(left.macrophages, right.macrophages);
  assert.deepEqual(left.fibroblasts, right.fibroblasts);
  assert.deepEqual(Array.from(left.inflammation), Array.from(right.inflammation));
  assert.deepEqual(Array.from(left.angiogenic), Array.from(right.angiogenic));
});

test('所有环境场和细胞功能轴保持有效边界', () => {
  const simulation = advance(new Simulation({ scenarioId: 'immuneCold', seed: 'ALL-BOUNDS' }), 700);
  for (const field of [simulation.oxygen, simulation.drug, simulation.matrix, simulation.suppression, simulation.inflammation, simulation.angiogenic]) {
    for (const value of field) assert.ok(value >= 0 && value <= 1);
  }
  for (const cell of simulation.macrophages) assert.ok(cell.activation >= -1 && cell.activation <= 1);
  for (const cell of simulation.fibroblasts) {
    assert.ok(cell.activation >= 0 && cell.activation <= 1);
    assert.ok(cell.matrixActivity >= 0 && cell.matrixActivity <= 1);
    assert.ok(cell.exclusionActivity >= 0 && cell.exclusionActivity <= 1);
  }
});

test('巨噬细胞清除凋亡碎片并增加清除记忆', () => {
  const simulation = new Simulation({ scenarioId: 'growth', seed: 'EFFEROCYTOSIS' });
  const macrophage = simulation.macrophages[0];
  macrophage.x = 40;
  macrophage.y = 30;
  macrophage.efferocytosisMemory = 0;
  simulation.debris = [{
    id: simulation.nextId++, type: 'debris', x: 40, y: 30, age: 0,
    cause: '药物诱导死亡', mode: 'apoptotic', alpha: 1,
  }];
  simulation.updateMacrophages(0.045);
  assert.equal(simulation.debris.length, 0);
  assert.equal(macrophage.phagocytosed, 1);
  assert.ok(macrophage.efferocytosisMemory > 0);
  assert.equal(simulation.efferocytosedCount, 1);
});

test('巨噬细胞重编程推动平均功能轴向炎症支持端移动且不删除细胞', () => {
  const simulation = new Simulation({ scenarioId: 'rebound', seed: 'MAC-REPROGRAM' });
  simulation.macrophages.forEach((cell) => { cell.activation = 0.7; });
  simulation.oxygen.fill(1);
  simulation.suppression.fill(0);
  simulation.inflammation.fill(0);
  const before = simulation.computeMetrics().meanMacrophageActivation;
  const count = simulation.macrophages.length;
  simulation.intervene('macrophage', 1);
  advance(simulation, 150);
  assert.ok(simulation.computeMetrics().meanMacrophageActivation < before - 0.25);
  assert.ok(simulation.macrophages.length >= count);
});

test('CAF 局部沉积提高基质，无 CAF 对照不出现同等沉积', () => {
  const withCAF = new Simulation({ scenarioId: 'growth', seed: 'CAF-MATRIX', params: { matrixDensity: 0, fibroblastActivation: 100 } });
  const withoutCAF = Simulation.fromState(withCAF.serialize());
  withoutCAF.fibroblasts = [];
  withCAF.matrix.fill(0);
  withoutCAF.matrix.fill(0);
  advance(withCAF, 400);
  advance(withoutCAF, 400);
  assert.ok(average(withCAF.matrix) > average(withoutCAF.matrix) + 0.001);
});

test('基质正常化降低过量基质但不删除 CAF 或突破设计下限', () => {
  const simulation = advance(new Simulation({ scenarioId: 'fibrotic', seed: 'STROMA-NORMALIZE' }), 200);
  const before = average(simulation.matrix);
  const count = simulation.fibroblasts.length;
  const floor = simulation.params.matrixDensity / 100 * 0.28;
  simulation.intervene('stroma', 1);
  advance(simulation, 200);
  assert.ok(average(simulation.matrix) < before);
  assert.equal(simulation.fibroblasts.length, count);
  assert.ok(Math.min(...simulation.matrix) >= floor - 0.02);
});

test('高基质降低药物组织暴露和 T 细胞迁移', () => {
  const lowDrug = new Simulation({ scenarioId: 'growth', seed: 'MATRIX-DRUG', params: { matrixDensity: 0 } });
  const highDrug = new Simulation({ scenarioId: 'growth', seed: 'MATRIX-DRUG', params: { matrixDensity: 100 } });
  lowDrug.matrix.fill(0);
  highDrug.matrix.fill(1);
  lowDrug.intervene('chemo', 0.8);
  highDrug.intervene('chemo', 0.8);
  advance(lowDrug, 120);
  advance(highDrug, 120);
  assert.ok(average(highDrug.drug) < average(lowDrug.drug));

  const makeMovementCase = (matrixValue) => {
    const simulation = new Simulation({ scenarioId: 'growth', seed: 'MATRIX-MOVE', params: { matrixDensity: matrixValue, tInfiltration: 0 } });
    simulation.cancer = [{ ...simulation.cancer[0], x: 28, y: 30, health: 1, cycle: 0, stress: 0, damage: 0 }];
    simulation.tCells = [{ ...simulation.tCells[0], x: 20, y: 30, exhaustion: 0, activation: 1, energy: 1 }];
    simulation.macrophages = [];
    simulation.fibroblasts = [];
    simulation.suppression.fill(0);
    simulation.inflammation.fill(0);
    simulation.matrix.fill(matrixValue / 100);
    simulation.rng.range = () => 0;
    simulation.rng.chance = () => false;
    return simulation;
  };
  const lowMove = makeMovementCase(0);
  const highMove = makeMovementCase(100);
  for (let index = 0; index < 80; index += 1) {
    lowMove.updateTCells(0.045);
    highMove.updateTCells(0.045);
  }
  assert.ok(lowMove.tCells[0].x > highMove.tCells[0].x + 1.5);
});

test('v1 存档可迁移，v2 存档可恢复新增状态', () => {
  const original = advance(new Simulation({ scenarioId: 'rebound', seed: 'SAVE-MIGRATE' }), 120);
  original.intervene('macrophage', 1);
  original.intervene('stroma', 1);
  advance(original, 30);
  const v2 = original.serialize();
  const restored = Simulation.fromState(v2);
  assert.equal(restored.macrophages.length, original.macrophages.length);
  assert.equal(restored.fibroblasts.length, original.fibroblasts.length);
  assert.deepEqual(Array.from(restored.inflammation), Array.from(original.inflammation));
  assert.deepEqual(Array.from(restored.angiogenic), Array.from(original.angiogenic));

  const v1 = structuredClone(v2);
  v1.version = 1;
  delete v1.modelVersion;
  delete v1.macrophages;
  delete v1.fibroblasts;
  delete v1.inflammation;
  delete v1.angiogenic;
  delete v1.activeMacrophageReprogramming;
  delete v1.activeStromaNormalization;
  delete v1.efferocytosedCount;
  delete v1.params.macrophageRecruitment;
  delete v1.params.fibroblastActivation;
  const normalizedOnce = validateAndMigrateState(v1);
  const normalizedTwice = validateAndMigrateState(normalizedOnce);
  assert.equal(normalizedTwice.migratedFromVersion, 1);
  const migrated = Simulation.fromState(normalizedTwice);
  assert.ok(migrated.macrophages.length > 0);
  assert.ok(migrated.fibroblasts.length > 0);
  assert.equal(migrated.migrationInfo.fromVersion, 1);
  assert.equal(migrated.cancer.length, original.cancer.length);
});

test('损坏、NaN、重复 ID、错误数组长度和未知版本存档均被拒绝', () => {
  const base = new Simulation({ scenarioId: 'growth', seed: 'BAD-SAVE' }).serialize();
  const cases = [];
  const badLength = structuredClone(base); badLength.oxygen.pop(); cases.push(badLength);
  const badNumber = structuredClone(base); badNumber.matrix[12] = Number.NaN; cases.push(badNumber);
  const duplicate = structuredClone(base); duplicate.tCells[0].id = duplicate.cancer[0].id; cases.push(duplicate);
  const badVersion = structuredClone(base); badVersion.version = 99; cases.push(badVersion);
  const badAxis = structuredClone(base); badAxis.macrophages[0].activation = 2; cases.push(badAxis);
  for (const state of cases) assert.throws(() => validateAndMigrateState(state), TypeError);
});

test('六个场景中期长跑不会因参数错误整体清零', () => {
  for (const id of Object.keys(SCENARIOS)) {
    const simulation = advance(new Simulation({ scenarioId: id, seed: `LONG-${id}` }), 600);
    assert.ok(simulation.cancer.length > 0, `${id} 在无治疗下过早整体清零`);
    assert.ok(simulation.fibroblasts.length > 0, `${id} 的 CAF 异常消失`);
  }
});
