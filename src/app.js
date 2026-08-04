import { scenarioList, getScenario, CLONES } from './scenarios.js';
import { makeShareCode } from './rng.js';
import { AquariumRenderer } from './renderer.js';
import { drawBurdenChart, drawSparkline } from './charts.js';
import { MECHANISMS, REFERENCES, referenceById, pubmedUrl } from './evidence.js';
import { MAX_SAVE_BYTES, parseAndValidateStateText } from './state.js';

const $ = (id) => document.getElementById(id);
const worker = new Worker(new URL('./simulation.worker.js', import.meta.url), { type: 'module' });
const renderer = new AquariumRenderer($('simCanvas'));

let snapshot = null;
let isRunning = false;
let currentSpeed = 1;
let selectedCell = null;
let autoScript = false;
let autoTreatmentDone = false;
let clearedBeforeEventId = 0;
let toastTimer = null;
let requestCounter = 1;
let baselineSnapshot = null;
let probeSample = null;
let colorVisionFriendly = false;
let reducedMotion = false;
const visitedLayers = new Set(['cells']);
const interventionKinds = new Set();
const pendingState = new Map();

const controls = {
  oxygenSupply: $('oxygenSupply'),
  matrixDensity: $('matrixDensity'),
  suppression: $('suppression'),
  tInfiltration: $('tInfiltration'),
  macrophageRecruitment: $('macrophageRecruitment'),
  fibroblastActivation: $('fibroblastActivation'),
  mutationRate: $('mutationRate'),
  chemoDose: $('chemoDose'),
};
const outputs = {
  oxygenSupply: $('oxygenSupplyOut'),
  matrixDensity: $('matrixDensityOut'),
  suppression: $('suppressionOut'),
  tInfiltration: $('tInfiltrationOut'),
  macrophageRecruitment: $('macrophageRecruitmentOut'),
  fibroblastActivation: $('fibroblastActivationOut'),
  mutationRate: $('mutationRateOut'),
  chemoDose: $('chemoDoseOut'),
};

const LESSONS = {
  hypoxia: {
    title: '血管距离与低氧核心',
    scenarioId: 'hypoxic',
    params: { oxygenSupply: 50, matrixDensity: 48, suppression: 54, tInfiltration: 30, macrophageRecruitment: 64, fibroblastActivation: 54, mutationRate: 18 },
    hypothesis: '假设：降低供氧强度后，远离血管的区域会先出现低氧代理信号。',
    steps: ['应用设置并启动模拟。', '切换到“氧气”图层，观察虚线低氧边界与血管的相对位置。', '把供氧强度从 50 提高到 100，仅比较方向变化，不把数值解释为氧分压。'],
    readout: (m) => `当前低氧代理面积 ${pct(m.hypoxicFraction)}；平均氧场 ${pct(m.averageOxygen)}。`,
  },
  exclusion: {
    title: '基质与免疫排斥',
    scenarioId: 'fibrotic',
    params: { oxygenSupply: 68, matrixDensity: 88, suppression: 48, tInfiltration: 52, macrophageRecruitment: 48, fibroblastActivation: 92, mutationRate: 14 },
    hypothesis: '假设：高基质阻力与 CAF 排斥程序会降低 T 细胞进入和移动，但不等于所有基质都应被清除。',
    steps: ['应用设置并观察“基质”图层。', '记录 T 细胞数量、CAF 活化比例和平均基质。', '施加“基质正常化”，比较方向变化，并注意模型保留基质下限。'],
    readout: (m) => `T 细胞 ${formatNumber(m.tCellCount)}；平均基质 ${pct(m.averageMatrix)}；CAF 高活化 ${pct(m.activatedFibroblastFraction)}。`,
  },
  selection: {
    title: '治疗压力与克隆选择',
    scenarioId: 'resistant',
    params: { oxygenSupply: 80, matrixDensity: 36, suppression: 40, tInfiltration: 38, macrophageRecruitment: 40, fibroblastActivation: 44, mutationRate: 8 },
    hypothesis: '假设：一次强治疗可降低总负荷，却可能提高预存耐受克隆的相对比例。',
    steps: ['应用设置，先运行到模拟日 4–5。', '记录总癌细胞数与耐药克隆比例。', '施加一次抽象细胞毒性脉冲，比较最低负荷与后续克隆构成。'],
    readout: (m) => `活癌细胞 ${formatNumber(m.cancerCount)}；耐药克隆 ${pct(m.resistantFraction)}；累计模型杀伤 ${m.cumulativeKills}。`,
  },
};

function showToast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.add('show');
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600);
}

function appendText(parent, tag, text, className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.appendChild(element);
  return element;
}

function initScenarioOptions() {
  const select = $('scenarioSelect');
  select.replaceChildren();
  for (const scenario of scenarioList()) {
    const option = document.createElement('option');
    option.value = scenario.id;
    option.textContent = scenario.name;
    option.title = scenario.description;
    select.appendChild(option);
  }
  select.value = 'rebound';
}

function paramsFromUI() {
  return {
    oxygenSupply: Number(controls.oxygenSupply.value),
    matrixDensity: Number(controls.matrixDensity.value),
    suppression: Number(controls.suppression.value),
    tInfiltration: Number(controls.tInfiltration.value),
    macrophageRecruitment: Number(controls.macrophageRecruitment.value),
    fibroblastActivation: Number(controls.fibroblastActivation.value),
    mutationRate: Number(controls.mutationRate.value),
  };
}

function applyParamsToControls(params = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (controls[key] && key !== 'chemoDose') controls[key].value = value;
  }
  updateControlOutputs();
}

function applyScenarioToControls(id) {
  applyParamsToControls(getScenario(id));
}

function updateControlOutputs() {
  outputs.oxygenSupply.value = `${controls.oxygenSupply.value} a.u.`;
  outputs.matrixDensity.value = `${controls.matrixDensity.value}/100`;
  outputs.suppression.value = `${controls.suppression.value}/100`;
  outputs.tInfiltration.value = `${controls.tInfiltration.value}/100`;
  outputs.macrophageRecruitment.value = `${controls.macrophageRecruitment.value}/100`;
  outputs.fibroblastActivation.value = `${controls.fibroblastActivation.value}/100`;
  outputs.mutationRate.value = `${Math.round(Number(controls.mutationRate.value) * 2)}/100`;
  outputs.chemoDose.value = `${controls.chemoDose.value}/100`;
}

function initSimulation({
  scenarioId = $('scenarioSelect').value,
  seed = $('seedInput').value.trim() || 'TME-7FH2-K9P4',
  params = paramsFromUI(),
} = {}) {
  isRunning = false;
  autoScript = false;
  autoTreatmentDone = false;
  selectedCell = null;
  renderer.selectedId = null;
  clearExperimentBaseline(false);
  interventionKinds.clear();
  visitedLayers.clear();
  visitedLayers.add(renderer.layer || 'cells');
  probeSample = null;
  renderMapProbe();
  updateRunUI();
  $('emptyPrompt').classList.remove('hide');
  worker.postMessage({ type: 'init', payload: { scenarioId, seed, params } });
}

function updateRunUI() {
  $('playBtn').querySelector('.play-symbol').textContent = isRunning ? 'Ⅱ' : '▶';
  $('playBtn').lastElementChild.textContent = isRunning ? '暂停模拟' : '启动模拟';
  $('simStatus').textContent = isRunning ? `${currentSpeed}× 运行中` : '已暂停';
  $('simStatus').classList.toggle('running', isRunning);
  $('simStatus').classList.toggle('paused', !isRunning);
}

function toggleRun(force) {
  isRunning = typeof force === 'boolean' ? force : !isRunning;
  worker.postMessage({ type: 'run', value: isRunning });
  if (isRunning) $('emptyPrompt').classList.add('hide');
  updateRunUI();
}

function startDefaultScript() {
  autoScript = true;
  autoTreatmentDone = false;
  toggleRun(true);
  showToast('默认剧本已启动：模拟日 5.0 自动施加模型脉冲');
}

worker.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'snapshot') {
    snapshot = message.snapshot;
    renderer.setSnapshot(snapshot);
    if (autoScript && !autoTreatmentDone && snapshot.time >= 5) {
      autoTreatmentDone = true;
      worker.postMessage({ type: 'intervene', kind: 'chemo', value: 0.82 });
      showToast('模拟日 5.0：已自动施加高强度模型脉冲');
    }
    updateDashboard();
  } else if (message.type === 'state') {
    const pending = pendingState.get(message.requestId);
    if (pending) {
      pending.resolve(message.state);
      pendingState.delete(message.requestId);
    }
  } else if (message.type === 'loaded') {
    showToast(message.migratedFromVersion
      ? `v${message.migratedFromVersion} 存档已迁移到 v${message.modelVersion}`
      : `v${message.modelVersion} 存档已恢复`);
  } else if (message.type === 'error') {
    const pending = pendingState.get(message.requestId);
    if (pending) {
      pending.reject(new Error(message.message));
      pendingState.delete(message.requestId);
    }
    console.error(message.message);
    showToast(`模拟错误：${message.message}`);
    if (isRunning) toggleRun(false);
  }
};

function requestState() {
  return new Promise((resolve, reject) => {
    const requestId = requestCounter++;
    pendingState.set(requestId, { resolve, reject });
    worker.postMessage({ type: 'getState', requestId });
    setTimeout(() => {
      if (pendingState.has(requestId)) {
        pendingState.delete(requestId);
        reject(new Error('获取存档超时'));
      }
    }, 5000);
  });
}

function formatNumber(number) {
  return new Intl.NumberFormat('zh-CN').format(Math.round(number));
}
function pct(number) {
  return `${Math.round((number || 0) * 100)}%`;
}

function macrophageStateLabel(metrics) {
  const axis = metrics.meanMacrophageActivation || 0;
  if (axis > 0.25) return `偏修复/抑制端 · 轴值 ${axis.toFixed(2)}`;
  if (axis < -0.25) return `偏炎症支持端 · 轴值 ${axis.toFixed(2)}`;
  return `混合连续状态 · 轴值 ${axis.toFixed(2)}`;
}

function updateDashboard() {
  if (!snapshot) return;
  const metrics = snapshot.metrics;
  $('simDay').textContent = `模拟日 ${snapshot.time.toFixed(1)}`;
  $('snapshotAge').textContent = snapshot.modelVersion ? `模型 ${snapshot.modelVersion}` : '实时';
  $('entityCount').textContent = formatNumber(
    snapshot.cancer.length + snapshot.tCells.length + snapshot.macrophages.length
    + snapshot.fibroblasts.length + snapshot.debris.length,
  );
  $('tumorMetric').textContent = formatNumber(metrics.cancerCount);
  $('hypoxiaMetric').textContent = pct(metrics.hypoxicFraction);
  $('tcellMetric').textContent = formatNumber(metrics.tCellCount);
  $('killMetric').textContent = `累计 ${metrics.cumulativeKills} 次杀伤`;
  $('resistantMetric').textContent = pct(metrics.resistantFraction);
  $('dominanceMetric').textContent = metrics.resistantFraction > 0.5
    ? '已成为主导克隆'
    : metrics.resistantFraction > 0.2 ? '正在获得生态优势' : '尚未主导';
  $('macrophageMetric').textContent = formatNumber(metrics.macrophageCount);
  $('macrophageStateMetric').textContent = macrophageStateLabel(metrics);
  $('fibroblastMetric').textContent = formatNumber(metrics.fibroblastCount);
  $('fibroblastStateMetric').textContent = `${pct(metrics.activatedFibroblastFraction)} 高活化 · 排斥 ${pct(metrics.meanCAFExclusion)}`;
  $('diversityMetric').textContent = (metrics.clonalDiversity ?? 0).toFixed(2);
  $('exclusionMetric').textContent = pct(metrics.immuneExclusionIndex);
  $('tStateMetric').textContent = `${pct(metrics.stemlikeTCellFraction)} / ${pct(metrics.terminalExhaustedTCellFraction)}`;
  $('tStateDetail').textContent = '前体样 / 终末耗竭代理';
  $('toxicityValue').textContent = pct(metrics.toxicity);
  $('toxicityBar').style.width = pct(metrics.toxicity);

  const history = snapshot.history;
  if (history.length > 1) {
    const first = history[Math.max(0, history.length - 25)].cancerCount;
    const delta = (metrics.cancerCount - first) / Math.max(1, first);
    $('tumorDelta').textContent = `近 ${Math.min(25, history.length)} 个记录点 ${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta * 100).toFixed(1)}%`;
  }
  $('chartRange').textContent = `模拟日 ${Math.round(history[0]?.time || 0)}–${Math.round(history.at(-1)?.time || 0)}`;
  drawBurdenChart($('burdenChart'), history);
  drawSparkline($('tumorSpark'), history);
  renderCloneBars(metrics.cloneCounts, metrics.cloneFractions);
  renderTimeline();
  renderLegend();
  renderFieldScale();
  updateLessonReadout();
  renderComparison();
  renderMissions();

  if (selectedCell) {
    const updated = allCells(snapshot).find((cell) => cell.id === selectedCell.id);
    if (updated) {
      selectedCell = updated;
      renderInspector(updated);
    } else {
      clearInspector('该细胞已经死亡或离开组织。');
    }
  }
}

function allCells(value) {
  return [...value.cancer, ...value.tCells, ...value.macrophages, ...value.fibroblasts];
}

function renderCloneBars(counts, fractions) {
  const root = $('cloneBars');
  root.replaceChildren();
  CLONES.forEach((clone, index) => {
    const row = document.createElement('div');
    row.className = 'clone-row';
    const label = document.createElement('span');
    const dot = document.createElement('i');
    dot.className = 'dot';
    dot.style.background = clone.color;
    label.append(dot, document.createTextNode(clone.shortName));
    const value = appendText(row, 'b', `${formatNumber(counts[index] || 0)} · ${pct(fractions[index])}`);
    const bar = document.createElement('div');
    bar.className = 'clone-bar';
    const fill = document.createElement('i');
    fill.style.width = pct(fractions[index]);
    fill.style.background = clone.color;
    bar.appendChild(fill);
    row.prepend(label);
    row.append(value, bar);
    root.appendChild(row);
  });
}

function renderTimeline() {
  if (!snapshot) return;
  const root = $('timeline');
  root.replaceChildren();
  const events = snapshot.events.filter((item) => item.id > clearedBeforeEventId).slice(-18);
  if (!events.length) {
    appendText(root, 'div', '关键生态事件将在这里出现。', 'inspector-empty');
    return;
  }
  for (const event of events) {
    const article = document.createElement('article');
    article.className = `event-item ${event.kind}`;
    const dot = document.createElement('i');
    dot.className = 'event-dot';
    const content = document.createElement('div');
    appendText(content, 'b', event.title);
    appendText(content, 'small', `模拟日 ${event.time.toFixed(1)} · ${event.detail}`);
    article.append(dot, content);
    root.appendChild(article);
  }
  root.scrollLeft = root.scrollWidth;
}

const legends = {
  cells: [['#ff7fae', '癌细胞'], ['#63dce9', 'T 细胞'], ['#72cbbf', '巨噬细胞'], ['#d7bd8b', '成纤维细胞'], ['#526b79', '血管'], ['#3b3941', '碎片']],
  clones: CLONES.map((clone) => [clone.color, clone.shortName]),
  oxygen: [['#241d58', '低氧代理'], ['#1f89a8', '中等'], ['#7ef2d9', '高氧代理']],
  drug: [['#321549', '低暴露'], ['#8642b6', '中等暴露'], ['#f0cfff', '高暴露']],
  matrix: [['#302c27', '疏松'], ['#9d7650', '中等'], ['#ffdeb0', '致密']],
  suppression: [['#431c22', '低'], ['#b54d3e', '中等'], ['#ffb264', '高']],
  inflammation: [['#1c3044', '低'], ['#257089', '中等'], ['#cfffdc', '高']],
  chronicInflammation: [['#341d2f', '低压力'], ['#8e4b5f', '中等'], ['#ffbd85', '高压力']],
  angiogenic: [['#201c4a', '低'], ['#735edc', '中等'], ['#cbc3ff', '高']],
};

function renderLegend() {
  const root = $('legend');
  root.replaceChildren();
  for (const [color, label] of legends[renderer.layer] || legends.cells) {
    const item = document.createElement('span');
    const dot = document.createElement('i');
    dot.style.background = color;
    item.append(dot, document.createTextNode(label));
    root.appendChild(item);
  }
}

const FIELD_SCALE_META = {
  oxygen: { title: '归一化氧场', low: '低', high: '高', gradient: 'linear-gradient(90deg,#241d58,#1f89a8,#7ef2d9)' },
  drug: { title: '药物暴露代理', low: '低', high: '高', gradient: 'linear-gradient(90deg,#321549,#8642b6,#f0cfff)' },
  matrix: { title: '基质阻力代理', low: '疏松', high: '致密', gradient: 'linear-gradient(90deg,#302c27,#9d7650,#ffdeb0)' },
  suppression: { title: '抑制环境代理', low: '低', high: '高', gradient: 'linear-gradient(90deg,#431c22,#b54d3e,#ffb264)' },
  inflammation: { title: '急性炎症/趋化代理', low: '低', high: '高', gradient: 'linear-gradient(90deg,#1c3044,#257089,#cfffdc)' },
  chronicInflammation: { title: '慢性炎症压力代理', low: '低', high: '高', gradient: 'linear-gradient(90deg,#341d2f,#8e4b5f,#ffbd85)' },
  angiogenic: { title: '血管支持代理', low: '低', high: '高', gradient: 'linear-gradient(90deg,#201c4a,#735edc,#cbc3ff)' },
};

function renderFieldScale() {
  const root = $('fieldScale');
  const layer = renderer.layer === 'cells' || renderer.layer === 'clones' ? 'oxygen' : renderer.layer;
  const meta = FIELD_SCALE_META[layer];
  if (!meta) {
    root.classList.add('hidden');
    return;
  }
  root.classList.remove('hidden');
  root.replaceChildren();
  appendText(root, 'b', meta.title);
  const bar = document.createElement('i');
  bar.style.background = meta.gradient;
  const labels = document.createElement('span');
  labels.append(document.createTextNode(meta.low), document.createTextNode(meta.high));
  root.append(bar, labels);
}

function inspectorRows(title, color, rows) {
  const root = $('inspectorContent');
  root.replaceChildren();
  const heading = document.createElement('div');
  heading.className = 'inspector-title';
  const dot = document.createElement('i');
  dot.style.background = color;
  appendText(heading, 'b', title);
  heading.prepend(dot);
  const grid = document.createElement('div');
  grid.className = 'inspector-grid';
  for (const [label, value] of rows) {
    const cell = document.createElement('div');
    appendText(cell, 'span', label);
    appendText(cell, 'b', String(value));
    grid.appendChild(cell);
  }
  root.append(heading, grid);
}

function renderInspector(cell) {
  $('inspectorEmpty').classList.add('hidden');
  $('inspectorContent').classList.remove('hidden');
  if (cell.type === 'cancer') {
    const clone = CLONES[cell.cloneId];
    inspectorRows(`癌细胞 #${cell.id} · ${clone.shortName}`, clone.color, [
      ['状态', cell.state], ['生命值', pct(cell.health)], ['局部氧气', pct(cell.oxygen)],
      ['药物暴露', pct(cell.drug)], ['细胞周期', pct(cell.cycle)],
      ['应激水平', pct(Math.max(cell.stress, cell.damage))], ['年龄', `${cell.age.toFixed(1)} 模拟日`], ['最近事件', cell.lastEvent],
    ]);
  } else if (cell.type === 'tcell') {
    inspectorRows(`T 细胞 #${cell.id}`, '#63dce9', [
      ['状态', cell.state], ['功能活性代理', pct(cell.activation)], ['总体耗竭代理', pct(cell.exhaustion)],
      ['前体样状态代理', pct(cell.stemlike)], ['终末耗竭代理', pct(cell.terminalExhaustion)],
      ['能量', pct(cell.energy)], ['累计杀伤', cell.kills], ['局部抑制', pct(cell.suppression)],
      ['急性炎症', pct(cell.acuteInflammation)], ['慢性炎症压力', pct(cell.chronicInflammation)],
      ['局部基质', pct(cell.matrix)], ['最近事件', cell.lastEvent],
    ]);
  } else if (cell.type === 'macrophage') {
    inspectorRows(`巨噬细胞 #${cell.id}`, cell.activation > 0 ? '#e99a6d' : '#72cbbf', [
      ['状态', cell.state], ['连续功能轴', cell.activation.toFixed(2)], ['局部氧气', pct(cell.oxygen)],
      ['局部抑制', pct(cell.suppression)], ['吞噬次数', cell.phagocytosed],
      ['清除记忆', pct(cell.efferocytosisMemory)], ['能量', pct(cell.energy)], ['最近事件', cell.lastEvent],
    ]);
  } else {
    inspectorRows(`成纤维细胞 #${cell.id}`, '#d7bd8b', [
      ['状态', cell.state], ['活化程度', pct(cell.activation)], ['基质活动', pct(cell.matrixActivity)],
      ['排斥活动', pct(cell.exclusionActivity)], ['局部基质', pct(cell.matrix)],
      ['局部抑制', pct(cell.suppression)], ['年龄', `${cell.age.toFixed(1)} 模拟日`], ['最近事件', cell.lastEvent],
    ]);
  }
}

function clearInspector(message = '选择一个细胞，查看其类型、功能状态、局部环境和近期事件。') {
  selectedCell = null;
  renderer.selectedId = null;
  $('inspectorContent').classList.add('hidden');
  $('inspectorEmpty').classList.remove('hidden');
  $('inspectorEmpty').textContent = message;
}

function downloadBlob(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function safeStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
function exportPNG() {
  renderer.draw();
  $('simCanvas').toBlob((blob) => blob && downloadBlob(blob, `tme-aquarium-${safeStamp()}.png`), 'image/png');
  showToast('PNG 截图已生成');
}
function exportCSV() {
  if (!snapshot) return;
  const rows = ['simulation_time,tumor_cells,low_oxygen_proxy_fraction,t_cells,active_t_proxy_fraction,dysfunction_proxy_fraction,stemlike_t_proxy_fraction,terminal_exhausted_t_proxy_fraction,immune_exclusion_index,clonal_diversity,macrophages,mean_macrophage_axis,suppressive_macrophage_fraction,efferocytosed_count,fibroblasts,activated_fibroblast_fraction,mean_caf_exclusion,resistant_fraction,drug_exposure_proxy,matrix_proxy,acute_inflammation_proxy,chronic_inflammation_pressure_proxy,perfusion_heterogeneity_proxy,angiogenic_support_proxy,system_cost_proxy,cumulative_kills'];
  for (const metrics of snapshot.history) {
    rows.push([
      metrics.time.toFixed(3), metrics.cancerCount, metrics.hypoxicFraction.toFixed(5), metrics.tCellCount,
      metrics.activeTCellFraction.toFixed(5), metrics.exhaustedTCellFraction.toFixed(5),
      (metrics.stemlikeTCellFraction ?? 0).toFixed(5), (metrics.terminalExhaustedTCellFraction ?? 0).toFixed(5),
      (metrics.immuneExclusionIndex ?? 0).toFixed(5), (metrics.clonalDiversity ?? 0).toFixed(5), metrics.macrophageCount,
      metrics.meanMacrophageActivation.toFixed(5), metrics.suppressiveMacrophageFraction.toFixed(5), metrics.efferocytosedCount,
      metrics.fibroblastCount, metrics.activatedFibroblastFraction.toFixed(5), metrics.meanCAFExclusion.toFixed(5),
      metrics.resistantFraction.toFixed(5), metrics.averageDrug.toFixed(5), metrics.averageMatrix.toFixed(5),
      metrics.averageInflammation.toFixed(5), (metrics.averageChronicInflammation ?? 0).toFixed(5),
      (metrics.perfusionHeterogeneity ?? 0).toFixed(5), metrics.averageAngiogenicSupport.toFixed(5), metrics.toxicity.toFixed(5), metrics.cumulativeKills,
    ].join(','));
  }
  downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }), `tme-aquarium-metrics-${safeStamp()}.csv`);
  showToast('CSV 指标已导出');
}
async function exportJSON() {
  const state = await requestState();
  downloadBlob(new Blob([JSON.stringify(state)], { type: 'application/json' }), `tme-aquarium-save-${safeStamp()}.json`);
  showToast('完整 JSON 存档已导出');
}
async function copyShareCode() {
  const config = { scenario: snapshot?.scenario.id || $('scenarioSelect').value, seed: $('seedInput').value.trim(), params: paramsFromUI() };
  const code = makeShareCode(config);
  await navigator.clipboard.writeText(`${code}\n${JSON.stringify(config)}`);
  showToast(`分享码 ${code} 已复制`);
}

function renderStaticHelp(page) {
  const root = $('helpContent');
  root.replaceChildren();
  const pages = {
    how: {
      title: '先看空间，再看曲线',
      paragraphs: ['建议先使用默认剧本。启动后观察四类细胞围绕血管和肿瘤边缘重排，切换氧气、炎症、基质与血管支持图层寻找空间差异。模拟日 5.0 时药物代理场会从血管附近扩散，敏感克隆首先下降，随后耐药克隆可能获得空间。'],
      bullets: ['滚轮缩放，拖拽平移，点击任一细胞查看局部状态。', '暂停后逐步推进，比较短期治疗反应与长期生态适应。', '固定随机种子与相同参数会复现相同初始生态。'],
    },
    lab: {
      title: 'v2.0 实验工作流',
      paragraphs: [
        '选择一个明确问题，只改变一个主要变量。运行到稳定观察点后记录基线，再施加干预并继续运行至少 1 个模拟日。',
        '基线比较显示同一次运行中的前后差异，不能排除时间趋势、随机性和其他耦合机制，因此不等价于真实对照实验或因果效应。',
      ],
      bullets: ['使用相同场景、参数和随机种子复现实验。', '同时查看空间探针、地图边界和时间序列，避免只凭单一总量下结论。', '在实验备注中写下假设、观察和可能的替代解释。'],
    },
    rules: {
      title: '当前简化规则',
      paragraphs: [
        '氧气、药物暴露、基质、免疫抑制、急性炎症、慢性炎症压力和血管支持均以归一化代理场表示。癌细胞、T 细胞、巨噬细胞和成纤维细胞是独立 Agent。',
        'T 细胞耗竭在 v2.0 中拆为总体耗竭、前体样状态和终末耗竭三个代理维度；巨噬细胞仍使用连续功能轴；CAF 使用活化、基质活动和排斥活动三个维度。治疗不会主动创造耐药，而是改变竞争与相对组成。',
      ],
    },
    limits: {
      title: '科学与伦理边界',
      paragraphs: [
        '本项目是证据约束的机制性教育模拟。参数并非患者数据，药物暴露、系统代价、模拟时间和场强均是归一化抽象量，结果只反映当前规则和随机种子。',
        '不得用于疾病诊断、药物选择、治疗决策、剂量设计、疗效预测或患者预后判断。真实肿瘤微环境包含更复杂的谱系、分子通路、力学结构、药代动力学和个体差异。',
      ],
    },
    privacy: {
      title: '数据留在浏览器',
      paragraphs: [
        '模拟不要求账号，也不会自动上传存档。浏览器存档使用 localStorage；PNG、CSV 和 JSON 仅在你主动操作时生成。',
        `导入 JSON 有 ${(MAX_SAVE_BYTES / 1024 / 1024).toFixed(0)} MB 大小限制，并会检查版本、数组长度、数值范围和实体 ID。此版本不接收患者身份字段。`,
      ],
    },
  };
  const content = pages[page] || pages.how;
  appendText(root, 'h3', content.title);
  for (const paragraph of content.paragraphs) appendText(root, 'p', paragraph);
  if (content.bullets) {
    const list = document.createElement('ul');
    content.bullets.forEach((item) => appendText(list, 'li', item));
    root.appendChild(list);
  }
}

function renderEvidenceHelp() {
  const root = $('helpContent');
  root.replaceChildren();
  appendText(root, 'h3', '机制证据追踪');
  appendText(root, 'p', `当前登记 ${MECHANISMS.length} 条机制审计记录与 ${REFERENCES.length} 篇核心文献。证据支持机制方向，不代表归一化系数已完成实验拟合。`);
  const mechanismList = document.createElement('div');
  mechanismList.className = 'evidence-list';
  for (const mechanism of MECHANISMS) {
    const details = document.createElement('details');
    details.className = 'evidence-item';
    const summary = document.createElement('summary');
    appendText(summary, 'b', mechanism.title);
    appendText(summary, 'small', mechanism.level);
    details.appendChild(summary);
    const body = document.createElement('div');
    appendText(body, 'h4', '生物学证据');
    appendText(body, 'p', mechanism.evidence);
    appendText(body, 'h4', '模型翻译');
    appendText(body, 'p', mechanism.translation);
    appendText(body, 'h4', '适用边界');
    appendText(body, 'p', mechanism.caveat);
    if (mechanism.refs.length) {
      const refs = document.createElement('div');
      refs.className = 'evidence-refs';
      for (const id of mechanism.refs) {
        const reference = referenceById(id);
        if (!reference) continue;
        const link = document.createElement('a');
        link.href = pubmedUrl(reference);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = `${reference.authors} (${reference.year})`;
        refs.appendChild(link);
      }
      body.appendChild(refs);
    }
    details.appendChild(body);
    mechanismList.appendChild(details);
  }
  root.appendChild(mechanismList);
}

function showHelp(page = 'how') {
  if (!$('helpDialog').open) $('helpDialog').showModal();
  document.querySelectorAll('[data-help]').forEach((button) => button.classList.toggle('active', button.dataset.help === page));
  if (page === 'evidence') renderEvidenceHelp();
  else renderStaticHelp(page);
}


const COMPARISON_METRICS = [
  ['cancerCount', '活癌细胞', (v) => formatNumber(v), false],
  ['hypoxicFraction', '低氧代理面积', pct, false],
  ['resistantFraction', '耐药克隆比例', pct, false],
  ['immuneExclusionIndex', '免疫排斥指数', pct, false],
  ['terminalExhaustedTCellFraction', '终末耗竭样负荷', pct, false],
  ['clonalDiversity', '克隆多样性', (v) => (v ?? 0).toFixed(2), true],
];

function captureExperimentBaseline() {
  if (!snapshot) {
    showToast('模拟尚未就绪');
    return;
  }
  baselineSnapshot = {
    time: snapshot.time,
    scenario: snapshot.scenario,
    seed: snapshot.seed,
    params: { ...snapshot.params },
    metrics: { ...snapshot.metrics },
  };
  $('baselineStatus').textContent = `已记录：模拟日 ${snapshot.time.toFixed(1)} · ${snapshot.scenario.name}`;
  renderComparison();
  renderMissions();
  showToast('基线已记录；现在只改变一个主要变量');
}

function clearExperimentBaseline(showMessage = true) {
  baselineSnapshot = null;
  const status = $('baselineStatus');
  if (status) status.textContent = '尚未记录基线。';
  const grid = $('comparisonGrid');
  if (grid) grid.innerHTML = '<div class="comparison-empty">记录基线后，这里会显示关键指标变化。</div>';
  if (showMessage) showToast('实验基线已清除');
  renderMissions();
}

function relativeDelta(current, base) {
  if (!Number.isFinite(current) || !Number.isFinite(base)) return null;
  if (Math.abs(base) < 1e-9) return current - base;
  return (current - base) / Math.abs(base);
}

function renderComparison() {
  const root = $('comparisonGrid');
  if (!root) return;
  root.replaceChildren();
  if (!baselineSnapshot || !snapshot) {
    appendText(root, 'div', '记录基线后，这里会显示关键指标变化。', 'comparison-empty');
    return;
  }
  for (const [key, label, formatter] of COMPARISON_METRICS) {
    const before = baselineSnapshot.metrics[key] ?? 0;
    const after = snapshot.metrics[key] ?? 0;
    const delta = relativeDelta(after, before);
    const card = document.createElement('article');
    card.className = 'comparison-item';
    appendText(card, 'span', label);
    appendText(card, 'b', `${formatter(before)} → ${formatter(after)}`);
    const deltaEl = appendText(card, 'small', delta == null ? '—' : `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta * 100).toFixed(1)}%`);
    deltaEl.className = delta > 0.015 ? 'up' : delta < -0.015 ? 'down' : 'flat';
    root.appendChild(card);
  }
}

function experimentReportText() {
  if (!snapshot) throw new Error('模拟尚未就绪');
  const lines = [
    '# TME Aquarium v2.0 实验记录',
    '',
    `- 导出时间：${new Date().toISOString()}`,
    `- 场景：${snapshot.scenario.name}`,
    `- 随机种子：${snapshot.seed}`,
    `- 当前模拟日：${snapshot.time.toFixed(2)}`,
    `- 模型版本：${snapshot.modelVersion}`,
    '',
    '## 实验问题与备注',
    '',
    $('experimentNote').value.trim() || '未填写。',
    '',
    '## 基线与当前观察',
    '',
  ];
  if (!baselineSnapshot) {
    lines.push('未记录基线。');
  } else {
    lines.push(`基线模拟日：${baselineSnapshot.time.toFixed(2)}`, '');
    lines.push('| 指标 | 基线 | 当前 | 相对变化 |', '|---|---:|---:|---:|');
    for (const [key, label, formatter] of COMPARISON_METRICS) {
      const before = baselineSnapshot.metrics[key] ?? 0;
      const after = snapshot.metrics[key] ?? 0;
      const delta = relativeDelta(after, before);
      lines.push(`| ${label} | ${formatter(before)} | ${formatter(after)} | ${delta == null ? '—' : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`} |`);
    }
  }
  lines.push(
    '',
    '## 已施加的干预',
    '',
    interventionKinds.size ? [...interventionKinds].join('、') : '未记录。',
    '',
    '## 解释边界',
    '',
    '- 所有量均为归一化教学代理，参数未经过患者或癌种特异数据校准。',
    '- 单次运行的前后差异不是随机对照实验，也不能解释为临床疗效或因果效应。',
    '- 结果仅用于讨论空间生态、选择压力和机制假设。',
    '',
  );
  return lines.join('\n');
}

function exportExperimentReport() {
  const text = experimentReportText();
  downloadBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), `tme-aquarium-lab-${safeStamp()}.md`);
  showToast('实验记录已导出');
}

const MISSIONS = [
  { title: '建立基线', detail: '在干预前记录一次状态。', done: () => Boolean(baselineSnapshot) },
  { title: '空间取样', detail: '点击无细胞区域读取局部代理场。', done: () => Boolean(probeSample) },
  { title: '切换图层', detail: '至少比较三个空间图层。', done: () => visitedLayers.size >= 3 },
  { title: '完成前后比较', detail: '施加干预并继续运行至少 1 个模拟日。', done: () => Boolean(baselineSnapshot && interventionKinds.size && snapshot && snapshot.time - baselineSnapshot.time >= 1) },
];

function renderMissions() {
  const root = $('missionList');
  if (!root) return;
  root.replaceChildren();
  let completed = 0;
  MISSIONS.forEach((mission) => {
    const done = mission.done();
    if (done) completed += 1;
    const item = document.createElement('article');
    item.className = `mission-item ${done ? 'done' : ''}`;
    appendText(item, 'i', done ? '✓' : '○');
    const body = document.createElement('div');
    appendText(body, 'b', mission.title);
    appendText(body, 'small', mission.detail);
    item.appendChild(body);
    root.appendChild(item);
  });
  $('missionProgress').textContent = `${completed}/${MISSIONS.length}`;
}

function renderMapProbe() {
  const root = $('mapProbe');
  if (!root) return;
  const oldButton = $('clearProbeBtn');
  root.replaceChildren();
  const head = document.createElement('div');
  appendText(head, 'span', '空间探针');
  const close = document.createElement('button');
  close.id = 'clearProbeBtn';
  close.type = 'button';
  close.setAttribute('aria-label', '清除空间探针');
  close.textContent = '×';
  close.addEventListener('click', () => {
    probeSample = null;
    renderMapProbe();
    renderMissions();
  });
  head.appendChild(close);
  root.appendChild(head);
  if (!probeSample) {
    appendText(root, 'p', '点击没有细胞的位置，读取该坐标的局部代理场。');
    return;
  }
  appendText(root, 'b', `坐标 (${probeSample.x}, ${probeSample.y})`);
  const grid = document.createElement('dl');
  [
    ['氧场', probeSample.oxygen], ['药物', probeSample.drug], ['基质', probeSample.matrix],
    ['抑制', probeSample.suppression], ['急性炎症', probeSample.inflammation],
    ['慢性炎症', probeSample.chronicInflammation], ['血管支持', probeSample.angiogenic],
  ].forEach(([label, value]) => {
    appendText(grid, 'dt', label);
    appendText(grid, 'dd', pct(value));
  });
  root.appendChild(grid);
}


function renderLesson() {
  const lesson = LESSONS[$('lessonSelect').value] || LESSONS.hypoxia;
  $('lessonTitle').textContent = lesson.title;
  $('lessonHypothesis').textContent = lesson.hypothesis;
  const steps = $('lessonSteps');
  steps.replaceChildren();
  lesson.steps.forEach((step) => appendText(steps, 'li', step));
  updateLessonReadout();
}

function updateLessonReadout() {
  const root = $('lessonReadout');
  if (!root) return;
  const lesson = LESSONS[$('lessonSelect').value] || LESSONS.hypoxia;
  root.textContent = snapshot ? lesson.readout(snapshot.metrics) : '等待模拟数据。';
}

function applyLesson() {
  const lesson = LESSONS[$('lessonSelect').value] || LESSONS.hypoxia;
  $('scenarioSelect').value = lesson.scenarioId;
  applyParamsToControls(lesson.params);
  initSimulation({ scenarioId: lesson.scenarioId, params: lesson.params });
  showToast(`已应用引导实验：${lesson.title}`);
}

function applyValidatedState(state) {
  $('scenarioSelect').value = state.scenarioId;
  $('seedInput').value = state.seed;
  applyParamsToControls(state.params);
  clearExperimentBaseline(false);
  interventionKinds.clear();
  visitedLayers.clear();
  visitedLayers.add(renderer.layer || 'cells');
  probeSample = null;
  renderMapProbe();
  worker.postMessage({ type: 'loadState', state });
  isRunning = false;
  updateRunUI();
  $('emptyPrompt').classList.add('hide');
}

initScenarioOptions();
applyScenarioToControls('rebound');
updateControlOutputs();
renderLegend();
renderFieldScale();
renderStaticHelp('how');
renderLesson();
renderMissions();
renderMapProbe();

$('scenarioSelect').addEventListener('change', () => {
  applyScenarioToControls($('scenarioSelect').value);
  initSimulation();
  showToast(`已载入场景：${$('scenarioSelect').selectedOptions[0].textContent}`);
});
$('restartBtn').addEventListener('click', () => initSimulation());
$('resetParamsBtn').addEventListener('click', () => {
  applyScenarioToControls($('scenarioSelect').value);
  worker.postMessage({ type: 'params', value: paramsFromUI() });
  showToast('已恢复场景参数');
});
$('playBtn').addEventListener('click', () => toggleRun());
$('promptStartBtn').addEventListener('click', startDefaultScript);
document.querySelectorAll('[data-speed]').forEach((button) => button.addEventListener('click', () => {
  currentSpeed = Number(button.dataset.speed);
  worker.postMessage({ type: 'speed', value: currentSpeed });
  document.querySelectorAll('[data-speed]').forEach((item) => item.classList.toggle('active', item === button));
  updateRunUI();
}));
for (const [key, input] of Object.entries(controls)) {
  input.addEventListener('input', () => {
    updateControlOutputs();
    if (key !== 'chemoDose') worker.postMessage({ type: 'params', value: paramsFromUI() });
  });
}
$('chemoBtn').addEventListener('click', () => {
  interventionKinds.add('细胞毒性脉冲');
  worker.postMessage({ type: 'intervene', kind: 'chemo', value: Number(controls.chemoDose.value) / 100 });
  $('emptyPrompt').classList.add('hide');
  showToast('模型脉冲已施加，切换“药物代理”图层观察归一化暴露');
});
$('immuneBtn').addEventListener('click', () => {
  interventionKinds.add('免疫激活');
  worker.postMessage({ type: 'intervene', kind: 'immune', value: 1 });
  showToast('免疫激活已施加');
});
$('oxygenBtn').addEventListener('click', () => {
  interventionKinds.add('局部氧场提升');
  worker.postMessage({ type: 'intervene', kind: 'oxygen', value: 1 });
  showToast('已提高中心区域的归一化氧场');
});
$('macrophageBtn').addEventListener('click', () => {
  interventionKinds.add('巨噬细胞重编程');
  worker.postMessage({ type: 'intervene', kind: 'macrophage', value: 1 });
  showToast('巨噬细胞功能轴正在向炎症支持端短时移动');
});
$('stromaBtn').addEventListener('click', () => {
  interventionKinds.add('基质正常化');
  worker.postMessage({ type: 'intervene', kind: 'stroma', value: 1 });
  showToast('基质正常化已启动：降低过量沉积，但不清除 CAF');
  renderMissions();
});
document.querySelectorAll('.section-toggle').forEach((button) => button.addEventListener('click', () => {
  const section = button.closest('.control-section');
  section.classList.toggle('open');
  button.setAttribute('aria-expanded', section.classList.contains('open'));
}));
document.querySelectorAll('.layer-btn').forEach((button) => button.addEventListener('click', () => {
  renderer.setLayer(button.dataset.layer);
  visitedLayers.add(button.dataset.layer);
  renderMissions();
  document.querySelectorAll('.layer-btn').forEach((item) => item.classList.toggle('active', item === button));
  renderLegend();
  renderFieldScale();
}));
$('fitBtn').addEventListener('click', () => renderer.fit());
$('screenshotBtn').addEventListener('click', exportPNG);
$('fullscreenBtn').addEventListener('click', async () => {
  const element = $('canvasWrap');
  if (!document.fullscreenElement) await element.requestFullscreen();
  else await document.exitFullscreen();
  setTimeout(() => renderer.resize(), 60);
});
$('clearEventsBtn').addEventListener('click', () => {
  clearedBeforeEventId = snapshot?.events.at(-1)?.id || 0;
  renderTimeline();
});
$('exportBtn').addEventListener('click', () => $('exportDialog').showModal());
$('helpBtn').addEventListener('click', () => showHelp('how'));
$('lessonSelect').addEventListener('change', renderLesson);
$('applyLessonBtn').addEventListener('click', applyLesson);
$('contourToggle').addEventListener('click', () => {
  renderer.showHypoxiaContour = !renderer.showHypoxiaContour;
  $('contourToggle').textContent = `低氧边界：${renderer.showHypoxiaContour ? '开' : '关'}`;
  $('contourToggle').setAttribute('aria-pressed', String(renderer.showHypoxiaContour));
});
$('captureBaselineBtn').addEventListener('click', captureExperimentBaseline);
$('clearBaselineBtn').addEventListener('click', () => clearExperimentBaseline(true));
$('exportLabReportBtn').addEventListener('click', exportExperimentReport);
$('colorVisionBtn').addEventListener('click', () => {
  colorVisionFriendly = !colorVisionFriendly;
  renderer.setColorVision(colorVisionFriendly ? 'deuteranopia' : 'default');
  document.body.classList.toggle('color-vision-friendly', colorVisionFriendly);
  $('colorVisionBtn').setAttribute('aria-pressed', String(colorVisionFriendly));
  showToast(colorVisionFriendly ? '已启用色觉友好配色' : '已恢复默认配色');
});
$('motionBtn').addEventListener('click', () => {
  reducedMotion = !reducedMotion;
  renderer.setReducedMotion(reducedMotion);
  document.body.classList.toggle('reduce-motion', reducedMotion);
  $('motionBtn').setAttribute('aria-pressed', String(reducedMotion));
  showToast(reducedMotion ? '已减少动态效果' : '已恢复动态效果');
});
document.querySelectorAll('[data-help]').forEach((button) => button.addEventListener('click', () => showHelp(button.dataset.help)));
document.querySelectorAll('[data-export]').forEach((button) => button.addEventListener('click', async () => {
  try {
    const kind = button.dataset.export;
    if (kind === 'png') exportPNG();
    if (kind === 'csv') exportCSV();
    if (kind === 'json') await exportJSON();
    if (kind === 'share') await copyShareCode();
    if (kind === 'lab') exportExperimentReport();
    if (kind === 'import') $('importFile').click();
    if (kind !== 'import') $('exportDialog').close();
  } catch (error) {
    showToast(error instanceof Error ? error.message : '导出失败');
  }
}));

$('saveBtn').addEventListener('click', async () => {
  try {
    const state = await requestState();
    localStorage.setItem('tme-aquarium-save-v3', JSON.stringify(state));
    showToast('完整模拟已保存到当前浏览器');
  } catch {
    showToast('浏览器存储空间不足，请导出 JSON');
  }
});
$('loadBtn').addEventListener('click', () => {
  const raw = localStorage.getItem('tme-aquarium-save-v3') || localStorage.getItem('tme-aquarium-save-v2') || localStorage.getItem('tme-aquarium-save-v1');
  if (!raw) {
    showToast('当前浏览器没有存档');
    return;
  }
  try {
    applyValidatedState(parseAndValidateStateText(raw));
  } catch (error) {
    showToast(error instanceof Error ? `存档被拒绝：${error.message}` : '存档损坏，无法恢复');
  }
});
$('importFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_SAVE_BYTES) throw new TypeError(`文件超过 ${(MAX_SAVE_BYTES / 1024 / 1024).toFixed(0)} MB 限制`);
    applyValidatedState(parseAndValidateStateText(await file.text()));
    $('exportDialog').close();
  } catch (error) {
    showToast(error instanceof Error ? `无法导入：${error.message}` : '无法读取该 JSON 存档');
  }
  event.target.value = '';
});

function tooltipLines(hit) {
  if (hit.type === 'cancer') return [`癌细胞 #${hit.id}`, `${CLONES[hit.cloneId].shortName} · ${hit.state}`];
  if (hit.type === 'tcell') return [`T 细胞 #${hit.id}`, `${hit.state} · 前体样 ${pct(hit.stemlike)} · 终末耗竭 ${pct(hit.terminalExhaustion)}`];
  if (hit.type === 'macrophage') return [`巨噬细胞 #${hit.id}`, `${hit.state} · 功能轴 ${hit.activation.toFixed(2)}`];
  return [`成纤维细胞 #${hit.id}`, `${hit.state} · 活化 ${pct(hit.activation)}`];
}
function renderTooltip(hit, x, y, width) {
  const tip = $('cellTooltip');
  tip.replaceChildren();
  const [title, detail] = tooltipLines(hit);
  appendText(tip, 'b', title);
  tip.appendChild(document.createTextNode(detail));
  tip.classList.remove('hidden');
  tip.style.left = `${Math.min(width - 170, x + 12)}px`;
  tip.style.top = `${Math.max(8, y - 38)}px`;
}

let dragging = false;
let lastPoint = null;
let dragDistance = 0;
$('simCanvas').addEventListener('pointerdown', (event) => {
  dragging = true;
  dragDistance = 0;
  lastPoint = { x: event.clientX, y: event.clientY };
  $('simCanvas').setPointerCapture(event.pointerId);
});
$('simCanvas').addEventListener('pointermove', (event) => {
  const rect = $('simCanvas').getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (dragging && lastPoint) {
    const dx = event.clientX - lastPoint.x;
    const dy = event.clientY - lastPoint.y;
    dragDistance += Math.abs(dx) + Math.abs(dy);
    renderer.pan(dx, dy);
    lastPoint = { x: event.clientX, y: event.clientY };
    $('cellTooltip').classList.add('hidden');
    return;
  }
  const hit = renderer.hitTest(x, y);
  renderer.hover = hit;
  if (hit) renderTooltip(hit, x, y, rect.width);
  else $('cellTooltip').classList.add('hidden');
});
$('simCanvas').addEventListener('pointerup', (event) => {
  if (dragDistance < 6) {
    const rect = $('simCanvas').getBoundingClientRect();
    const hit = renderer.hitTest(event.clientX - rect.left, event.clientY - rect.top);
    if (hit) {
      selectedCell = hit;
      renderer.selectedId = hit.id;
      renderInspector(hit);
    } else {
      clearInspector();
      probeSample = renderer.sampleAt(event.clientX - rect.left, event.clientY - rect.top);
      renderMapProbe();
      renderMissions();
    }
  }
  dragging = false;
  lastPoint = null;
});
$('simCanvas').addEventListener('pointerleave', () => {
  $('cellTooltip').classList.add('hidden');
  if (!dragging) lastPoint = null;
});
$('simCanvas').addEventListener('wheel', (event) => {
  event.preventDefault();
  const rect = $('simCanvas').getBoundingClientRect();
  renderer.zoomAt(event.deltaY < 0 ? 1.13 : 0.88, event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });

const resizeObserver = new ResizeObserver(() => {
  renderer.resize();
  if (snapshot) drawBurdenChart($('burdenChart'), snapshot.history);
});
resizeObserver.observe($('canvasWrap'));
resizeObserver.observe($('burdenChart'));
let frameCount = 0;
let lastFpsAt = performance.now();
function renderLoop(now) {
  renderer.draw();
  frameCount += 1;
  if (now - lastFpsAt > 700) {
    $('fpsValue').textContent = Math.round(frameCount * 1000 / (now - lastFpsAt));
    frameCount = 0;
    lastFpsAt = now;
  }
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

initSimulation();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
