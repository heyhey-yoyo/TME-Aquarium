import fs from 'node:fs';
import { Simulation } from '../src/simulation.js';
import { SCENARIOS } from '../src/scenarios.js';

const seeds = ['AUDIT-A', 'AUDIT-B'];
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const pct = (value) => `${(value * 100).toFixed(1)}%`;
const num = (value) => Number(value).toFixed(2);

function run({ scenarioId = 'rebound', seed, params = {}, steps = 600, therapy = false }) {
  const simulation = new Simulation({ scenarioId, seed, params });
  let beforeTherapy = null;
  let minimum = Infinity;
  for (let index = 0; index < steps; index += 1) {
    if (therapy && beforeTherapy === null && simulation.time >= 5) {
      beforeTherapy = simulation.cancer.length;
      simulation.intervene('chemo', 0.82);
    }
    simulation.step();
    if (beforeTherapy !== null) minimum = Math.min(minimum, simulation.cancer.length);
  }
  return { metrics: simulation.computeMetrics(), events: simulation.events, beforeTherapy, minimum };
}

const lines = [
  '# v2.0 场景校准与单参数敏感性审计',
  '',
  `- 生成日期：${new Date().toISOString().slice(0, 10)}`,
  '- 状态：内部一致性、方向与数值稳定性审计；不是实验数据拟合或临床校准。',
  '- 每个汇总使用 2 个固定种子；无治疗场景推进 600 步（约 27 个模拟日）。',
  '',
  '## 六场景中期运行',
  '',
  '| 场景 | 癌细胞 | 低氧代理面积 | 慢性炎症压力 | 克隆多样性 | 免疫排斥 | 终末耗竭样 T | 巨噬细胞 | CAF |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
];

for (const id of Object.keys(SCENARIOS)) {
  const results = seeds.map((seed) => run({ scenarioId: id, seed }).metrics);
  lines.push(`| ${SCENARIOS[id].name} | ${mean(results.map((m) => m.cancerCount)).toFixed(0)} | ${pct(mean(results.map((m) => m.hypoxicFraction)))} | ${pct(mean(results.map((m) => m.averageChronicInflammation)))} | ${num(mean(results.map((m) => m.clonalDiversity)))} | ${pct(mean(results.map((m) => m.immuneExclusionIndex)))} | ${pct(mean(results.map((m) => m.terminalExhaustedTCellFraction)))} | ${mean(results.map((m) => m.macrophageCount)).toFixed(1)} | ${mean(results.map((m) => m.fibroblastCount)).toFixed(1)} |`);
}

lines.push(
  '',
  '所有场景在该窗口内均保留活癌细胞和主要基质/免疫组分；这只排除了明显参数崩溃，不证明长期稳态或生物学真实性。',
  '',
);

const sweeps = {
  oxygenSupply: [50, 76, 100],
  matrixDensity: [20, 42, 80],
  macrophageRecruitment: [20, 42, 80],
  fibroblastActivation: [20, 48, 80],
};

lines.push('## 单参数敏感性（默认反弹场景，无治疗）', '');
for (const [parameter, values] of Object.entries(sweeps)) {
  lines.push(
    `### ${parameter}`,
    '',
    '| 参数值 | 癌细胞 | 低氧代理面积 | 慢性炎症压力 | 免疫排斥 | 终末耗竭样 T | 平均基质 |',
    '|---:|---:|---:|---:|---:|---:|---:|',
  );
  for (const value of values) {
    const results = seeds.map((seed) => run({
      seed: `${seed}-${parameter}-${value}`,
      params: { [parameter]: value },
      steps: 450,
    }).metrics);
    lines.push(`| ${value} | ${mean(results.map((m) => m.cancerCount)).toFixed(0)} | ${pct(mean(results.map((m) => m.hypoxicFraction)))} | ${pct(mean(results.map((m) => m.averageChronicInflammation)))} | ${pct(mean(results.map((m) => m.immuneExclusionIndex)))} | ${pct(mean(results.map((m) => m.terminalExhaustedTCellFraction)))} | ${pct(mean(results.map((m) => m.averageMatrix)))} |`);
  }
  lines.push('');
}

lines.push(
  '## 治疗弧检查',
  '',
  '| 基质参数 | 治疗前负荷 | 治疗后最低负荷 | 末期负荷 | 初始反应事件 | 反弹事件 |',
  '|---:|---:|---:|---:|---|---|',
);
for (const matrixDensity of [20, 42, 80]) {
  const result = run({
    seed: `THERAPY-${matrixDensity}`,
    params: { matrixDensity },
    steps: 1050,
    therapy: true,
  });
  lines.push(`| ${matrixDensity} | ${result.beforeTherapy} | ${result.minimum} | ${result.metrics.cancerCount} | ${result.events.some((event) => event.title === '初始反应明显') ? '是' : '否'} | ${result.events.some((event) => event.title === '治疗后反弹') ? '是' : '否'} |`);
}

lines.push(
  '',
  '## 解释边界',
  '',
  '- 参数扫描只用于发现方向错误、数值爆炸、状态越界和场景失活。',
  '- 不同输出受空间初态、随机种子和多机制耦合共同影响；非单调结果不能被包装成生物学定律。',
  '- 新增的慢性炎症、免疫排斥、克隆多样性与 T 细胞状态均为归一化代理指标。',
  '- 当前没有外部数据集拟合、癌种特异参数、全局敏感性分析、置信区间或临床验证。',
  '',
);

const output = lines.join('\n');
fs.writeFileSync(new URL('../docs/场景校准与敏感性审计.md', import.meta.url), output);
console.log(output);
