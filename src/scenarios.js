export const CLONES = [
  {
    id: 0,
    key: 'sensitive',
    name: '高增殖敏感型',
    shortName: '敏感型',
    color: '#ff7fae',
    edge: '#ffd0df',
    proliferation: 1.0,
    drugSensitivity: 1.0,
    oxygenTolerance: 0.18,
    immuneEvasion: 0.14,
    motility: 0.42,
    metabolicDemand: 1.0,
  },
  {
    id: 1,
    key: 'resistant',
    name: '慢增殖耐药型',
    shortName: '耐药型',
    color: '#ae84ff',
    edge: '#dfd0ff',
    proliferation: 0.54,
    drugSensitivity: 0.16,
    oxygenTolerance: 0.35,
    immuneEvasion: 0.34,
    motility: 0.34,
    metabolicDemand: 0.72,
  },
  {
    id: 2,
    key: 'hypoxia',
    name: '缺氧耐受型',
    shortName: '缺氧型',
    color: '#ffbb73',
    edge: '#ffe2b7',
    proliferation: 0.72,
    drugSensitivity: 0.62,
    oxygenTolerance: 0.64,
    immuneEvasion: 0.22,
    motility: 0.38,
    metabolicDemand: 0.8,
  },
];

const SHARED_DEFAULTS = Object.freeze({
  initialMacrophages: 24,
  initialFibroblasts: 20,
  macrophageRecruitment: 40,
  fibroblastActivation: 42,
  macrophageBias: 0.08,
  fibroblastBias: 0.08,
  autoTreatmentDay: null,
});

export const SCENARIOS = {
  rebound: {
    id: 'rebound',
    name: '一次看似成功的治疗',
    description: '默认演示剧本：敏感克隆占主导，治疗后耐药克隆获得空间并反弹。',
    initialCancer: 255,
    initialTCells: 24,
    initialMacrophages: 28,
    initialFibroblasts: 24,
    cloneFractions: [0.90, 0.05, 0.05],
    oxygenSupply: 76,
    matrixDensity: 42,
    suppression: 36,
    tInfiltration: 44,
    mutationRate: 20,
    macrophageRecruitment: 42,
    fibroblastActivation: 48,
    macrophageBias: 0.14,
    fibroblastBias: 0.10,
    vesselPattern: 'abnormal',
    autoTreatmentDay: null,
  },
  growth: {
    id: 'growth',
    name: '基础生长',
    description: '较均衡的供氧和免疫浸润，用于观察空间竞争与增殖边缘。',
    initialCancer: 180,
    initialTCells: 32,
    initialMacrophages: 22,
    initialFibroblasts: 18,
    cloneFractions: [0.78, 0.07, 0.15],
    oxygenSupply: 90,
    matrixDensity: 24,
    suppression: 20,
    tInfiltration: 58,
    mutationRate: 12,
    macrophageRecruitment: 34,
    fibroblastActivation: 30,
    macrophageBias: -0.06,
    fibroblastBias: 0,
    vesselPattern: 'balanced',
  },
  hypoxic: {
    id: 'hypoxic',
    name: '缺氧核心',
    description: '供血不均且代谢压力高，肿瘤中心会快速形成低氧与坏死区域。',
    initialCancer: 330,
    initialTCells: 18,
    initialMacrophages: 38,
    initialFibroblasts: 28,
    cloneFractions: [0.52, 0.06, 0.42],
    oxygenSupply: 50,
    matrixDensity: 48,
    suppression: 54,
    tInfiltration: 30,
    mutationRate: 18,
    macrophageRecruitment: 64,
    fibroblastActivation: 54,
    macrophageBias: 0.34,
    fibroblastBias: 0.14,
    vesselPattern: 'sparse',
  },
  immuneCold: {
    id: 'immuneCold',
    name: '免疫冷肿瘤',
    description: '高基质、高抑制、低浸润；免疫激活本身不会凭空产生足够的 T 细胞。',
    initialCancer: 270,
    initialTCells: 6,
    initialMacrophages: 42,
    initialFibroblasts: 40,
    cloneFractions: [0.72, 0.12, 0.16],
    oxygenSupply: 70,
    matrixDensity: 78,
    suppression: 82,
    tInfiltration: 8,
    mutationRate: 16,
    macrophageRecruitment: 72,
    fibroblastActivation: 80,
    macrophageBias: 0.48,
    fibroblastBias: 0.34,
    vesselPattern: 'rim',
  },
  fibrotic: {
    id: 'fibrotic',
    name: '纤维化屏障',
    description: '致密基质使 T 细胞主要停留在外周，并减慢药物扩散。',
    initialCancer: 250,
    initialTCells: 36,
    initialMacrophages: 30,
    initialFibroblasts: 56,
    cloneFractions: [0.68, 0.12, 0.20],
    oxygenSupply: 68,
    matrixDensity: 88,
    suppression: 48,
    tInfiltration: 52,
    mutationRate: 14,
    macrophageRecruitment: 48,
    fibroblastActivation: 92,
    macrophageBias: 0.20,
    fibroblastBias: 0.52,
    vesselPattern: 'rim',
  },
  resistant: {
    id: 'resistant',
    name: '隐藏耐药亚克隆',
    description: '初始耐药克隆比例极低，治疗前增长慢，治疗后相对比例迅速提高。',
    initialCancer: 270,
    initialTCells: 22,
    initialMacrophages: 26,
    initialFibroblasts: 24,
    cloneFractions: [0.965, 0.02, 0.015],
    oxygenSupply: 80,
    matrixDensity: 36,
    suppression: 40,
    tInfiltration: 38,
    mutationRate: 8,
    macrophageRecruitment: 40,
    fibroblastActivation: 44,
    macrophageBias: 0.12,
    fibroblastBias: 0.08,
    vesselPattern: 'abnormal',
  },
};

const FINITE_RANGES = Object.freeze({
  initialCancer: [0, 5000, true],
  initialTCells: [0, 1000, true],
  initialMacrophages: [0, 500, true],
  initialFibroblasts: [0, 500, true],
  oxygenSupply: [20, 120, false],
  matrixDensity: [0, 100, false],
  suppression: [0, 100, false],
  tInfiltration: [0, 100, false],
  mutationRate: [0, 50, false],
  macrophageRecruitment: [0, 100, false],
  fibroblastActivation: [0, 100, false],
  macrophageBias: [-1, 1, false],
  fibroblastBias: [-1, 1, false],
});

function assertFiniteRange(scenario, key, min, max, integer) {
  const value = scenario[key];
  if (!Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) {
    throw new TypeError(`场景 ${scenario.id} 的 ${key} 无效`);
  }
}

export function validateScenario(input) {
  const scenario = { ...SHARED_DEFAULTS, ...input };
  if (!scenario.id || typeof scenario.id !== 'string') throw new TypeError('场景缺少有效 id');
  if (!scenario.name || typeof scenario.name !== 'string') throw new TypeError(`场景 ${scenario.id} 缺少名称`);
  for (const [key, [min, max, integer]] of Object.entries(FINITE_RANGES)) {
    assertFiniteRange(scenario, key, min, max, integer);
  }
  if (!Array.isArray(scenario.cloneFractions) || scenario.cloneFractions.length !== CLONES.length) {
    throw new TypeError(`场景 ${scenario.id} 的 cloneFractions 必须包含 ${CLONES.length} 项`);
  }
  const total = scenario.cloneFractions.reduce((sum, value) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError(`场景 ${scenario.id} 的克隆比例无效`);
    return sum + value;
  }, 0);
  if (Math.abs(total - 1) > 1e-6) throw new TypeError(`场景 ${scenario.id} 的克隆比例之和必须为 1`);
  if (!['balanced', 'sparse', 'rim', 'abnormal'].includes(scenario.vesselPattern)) {
    throw new TypeError(`场景 ${scenario.id} 的血管模式无效`);
  }
  return scenario;
}

for (const [id, scenario] of Object.entries(SCENARIOS)) {
  SCENARIOS[id] = Object.freeze(validateScenario(scenario));
}

export function scenarioList() {
  return Object.values(SCENARIOS).map(({ id, name, description }) => ({ id, name, description }));
}

export function getScenario(id) {
  return structuredClone(SCENARIOS[id] || SCENARIOS.rebound);
}
