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
  outputs.oxygenSupply.value = `${controls.oxygenSupply.value}%`;
  outputs.matrixDensity.value = `${controls.matrixDensity.value}%`;
  outputs.suppression.value = `${controls.suppression.value}%`;
  outputs.tInfiltration.value = `${controls.tInfiltration.value}%`;
  outputs.macrophageRecruitment.value = `${controls.macrophageRecruitment.value}%`;
  outputs.fibroblastActivation.value = `${controls.fibroblastActivation.value}%`;
  outputs.mutationRate.value = `${(Number(controls.mutationRate.value) / 10).toFixed(1)}×`;
  outputs.chemoDose.value = `${controls.chemoDose.value}%`;
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
  showToast('默认剧本已启动：第 5 天自动施加治疗');
}

worker.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'snapshot') {
    snapshot = message.snapshot;
    renderer.setSnapshot(snapshot);
    if (autoScript && !autoTreatmentDone && snapshot.time >= 5) {
      autoTreatmentDone = true;
      worker.postMessage({ type: 'intervene', kind: 'chemo', value: 0.82 });
      showToast('第 5 天：已自动施加高剂量治疗');
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
  $('simDay').textContent = `第 ${snapshot.time.toFixed(1)} 天`;
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
  $('toxicityValue').textContent = pct(metrics.toxicity);
  $('toxicityBar').style.width = pct(metrics.toxicity);

  const history = snapshot.history;
  if (history.length > 1) {
    const first = history[Math.max(0, history.length - 25)].cancerCount;
    const delta = (metrics.cancerCount - first) / Math.max(1, first);
    $('tumorDelta').textContent = `近 ${Math.min(25, history.length)} 个记录点 ${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta * 100).toFixed(1)}%`;
  }
  $('chartRange').textContent = `${Math.round(history[0]?.time || 0)}–${Math.round(history.at(-1)?.time || 0)} 天`;
  drawBurdenChart($('burdenChart'), history);
  drawSparkline($('tumorSpark'), history);
  renderCloneBars(metrics.cloneCounts, metrics.cloneFractions);
  renderTimeline();
  renderLegend();

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
    appendText(content, 'small', `第 ${event.time.toFixed(1)} 天 · ${event.detail}`);
    article.append(dot, content);
    root.appendChild(article);
  }
  root.scrollLeft = root.scrollWidth;
}

const legends = {
  cells: [['#ff7fae', '癌细胞'], ['#63dce9', 'T 细胞'], ['#72cbbf', '巨噬细胞'], ['#d7bd8b', '成纤维细胞'], ['#526b79', '血管'], ['#3b3941', '碎片']],
  clones: CLONES.map((clone) => [clone.color, clone.shortName]),
  oxygen: [['#241d58', '严重缺氧'], ['#1f89a8', '中等'], ['#7ef2d9', '高氧']],
  drug: [['#321549', '低浓度'], ['#8642b6', '有效暴露'], ['#f0cfff', '高浓度']],
  matrix: [['#302c27', '疏松'], ['#9d7650', '中等'], ['#ffdeb0', '致密']],
  suppression: [['#431c22', '低'], ['#b54d3e', '中等'], ['#ffb264', '高']],
  inflammation: [['#1c3044', '低'], ['#257089', '中等'], ['#cfffdc', '高']],
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
      ['应激水平', pct(Math.max(cell.stress, cell.damage))], ['年龄', `${cell.age.toFixed(1)} 天`], ['最近事件', cell.lastEvent],
    ]);
  } else if (cell.type === 'tcell') {
    inspectorRows(`T 细胞 #${cell.id}`, '#63dce9', [
      ['状态', cell.state], ['激活程度', pct(cell.activation)], ['耗竭程度', pct(cell.exhaustion)],
      ['能量', pct(cell.energy)], ['累计杀伤', cell.kills], ['局部抑制', pct(cell.suppression)],
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
      ['局部抑制', pct(cell.suppression)], ['年龄', `${cell.age.toFixed(1)} 天`], ['最近事件', cell.lastEvent],
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
  const rows = ['day,tumor_cells,hypoxic_fraction,t_cells,active_t_fraction,exhausted_t_fraction,macrophages,mean_macrophage_axis,suppressive_macrophage_fraction,efferocytosed_count,fibroblasts,activated_fibroblast_fraction,mean_caf_exclusion,resistant_fraction,drug_level,matrix_level,inflammation,angiogenic_support,toxicity,cumulative_kills'];
  for (const metrics of snapshot.history) {
    rows.push([
      metrics.time.toFixed(3), metrics.cancerCount, metrics.hypoxicFraction.toFixed(5), metrics.tCellCount,
      metrics.activeTCellFraction.toFixed(5), metrics.exhaustedTCellFraction.toFixed(5), metrics.macrophageCount,
      metrics.meanMacrophageActivation.toFixed(5), metrics.suppressiveMacrophageFraction.toFixed(5), metrics.efferocytosedCount,
      metrics.fibroblastCount, metrics.activatedFibroblastFraction.toFixed(5), metrics.meanCAFExclusion.toFixed(5),
      metrics.resistantFraction.toFixed(5), metrics.averageDrug.toFixed(5), metrics.averageMatrix.toFixed(5),
      metrics.averageInflammation.toFixed(5), metrics.averageAngiogenicSupport.toFixed(5), metrics.toxicity.toFixed(5), metrics.cumulativeKills,
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
      paragraphs: ['建议先使用默认剧本。启动后观察四类细胞围绕血管和肿瘤边缘重排，切换氧气、炎症、基质与血管支持图层寻找空间差异。第 5 天药物会从血管附近扩散，敏感克隆首先下降，随后耐药克隆可能获得空间。'],
      bullets: ['滚轮缩放，拖拽平移，点击任一细胞查看局部状态。', '暂停后逐步推进，比较短期治疗反应与长期生态适应。', '固定随机种子与相同参数会复现相同初始生态。'],
    },
    rules: {
      title: '当前简化规则',
      paragraphs: [
        '氧气、药物、基质、免疫抑制、炎症和血管支持以网格场表示。癌细胞、T 细胞、巨噬细胞和成纤维细胞是独立 Agent。',
        '巨噬细胞使用连续功能轴而非硬性 M1/M2 分类；CAF 使用活化、基质活动和排斥活动三个维度。治疗不会主动创造耐药，而是改变竞争与相对组成。',
      ],
    },
    limits: {
      title: '科学与伦理边界',
      paragraphs: [
        '本项目是证据约束的机制性教育模拟。参数并非患者数据，药物、毒性、时间和浓度均是归一化抽象量，结果只反映当前规则和随机种子。',
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

function applyValidatedState(state) {
  $('scenarioSelect').value = state.scenarioId;
  $('seedInput').value = state.seed;
  applyParamsToControls(state.params);
  worker.postMessage({ type: 'loadState', state });
  isRunning = false;
  updateRunUI();
  $('emptyPrompt').classList.add('hide');
}

initScenarioOptions();
applyScenarioToControls('rebound');
updateControlOutputs();
renderLegend();
renderStaticHelp('how');

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
$('stepBtn').addEventListener('click', () => {
  if (isRunning) toggleRun(false);
  worker.postMessage({ type: 'step' });
  $('emptyPrompt').classList.add('hide');
});
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
  worker.postMessage({ type: 'intervene', kind: 'chemo', value: Number(controls.chemoDose.value) / 100 });
  $('emptyPrompt').classList.add('hide');
  showToast('药物脉冲已施加，切换药物图层可观察扩散');
});
$('immuneBtn').addEventListener('click', () => {
  worker.postMessage({ type: 'intervene', kind: 'immune', value: 1 });
  showToast('免疫激活已施加');
});
$('oxygenBtn').addEventListener('click', () => {
  worker.postMessage({ type: 'intervene', kind: 'oxygen', value: 1 });
  showToast('已对肿瘤核心进行局部供氧');
});
$('macrophageBtn').addEventListener('click', () => {
  worker.postMessage({ type: 'intervene', kind: 'macrophage', value: 1 });
  showToast('巨噬细胞功能轴正在向炎症支持端短时移动');
});
$('stromaBtn').addEventListener('click', () => {
  worker.postMessage({ type: 'intervene', kind: 'stroma', value: 1 });
  showToast('基质正常化已启动：降低过量沉积，但不清除 CAF');
});
document.querySelectorAll('.section-toggle').forEach((button) => button.addEventListener('click', () => {
  const section = button.closest('.control-section');
  section.classList.toggle('open');
  button.setAttribute('aria-expanded', section.classList.contains('open'));
}));
document.querySelectorAll('.layer-btn').forEach((button) => button.addEventListener('click', () => {
  renderer.setLayer(button.dataset.layer);
  document.querySelectorAll('.layer-btn').forEach((item) => item.classList.toggle('active', item === button));
  renderLegend();
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
document.querySelectorAll('[data-help]').forEach((button) => button.addEventListener('click', () => showHelp(button.dataset.help)));
document.querySelectorAll('[data-export]').forEach((button) => button.addEventListener('click', async () => {
  try {
    const kind = button.dataset.export;
    if (kind === 'png') exportPNG();
    if (kind === 'csv') exportCSV();
    if (kind === 'json') await exportJSON();
    if (kind === 'share') await copyShareCode();
    if (kind === 'import') $('importFile').click();
    if (kind !== 'import') $('exportDialog').close();
  } catch (error) {
    showToast(error instanceof Error ? error.message : '导出失败');
  }
}));

$('saveBtn').addEventListener('click', async () => {
  try {
    const state = await requestState();
    localStorage.setItem('tme-aquarium-save-v2', JSON.stringify(state));
    showToast('完整模拟已保存到当前浏览器');
  } catch {
    showToast('浏览器存储空间不足，请导出 JSON');
  }
});
$('loadBtn').addEventListener('click', () => {
  const raw = localStorage.getItem('tme-aquarium-save-v2') || localStorage.getItem('tme-aquarium-save-v1');
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
  if (hit.type === 'tcell') return [`T 细胞 #${hit.id}`, `${hit.state} · 耗竭 ${pct(hit.exhaustion)}`];
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
    } else clearInspector();
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
