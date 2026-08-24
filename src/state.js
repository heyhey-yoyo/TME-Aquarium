import { SCENARIOS, getScenario } from './scenarios.js';

export const SAVE_VERSION = 3;
export const MODEL_VERSION = '1.0.0';
export const GRID_WIDTH = 96;
export const GRID_HEIGHT = 60;
export const GRID_SIZE = GRID_WIDTH * GRID_HEIGHT;
export const MAX_SAVE_BYTES = 8 * 1024 * 1024;

export const PARAM_LIMITS = Object.freeze({
  oxygenSupply: [20, 120],
  matrixDensity: [0, 100],
  suppression: [0, 100],
  tInfiltration: [0, 100],
  mutationRate: [0, 50],
  macrophageRecruitment: [0, 100],
  fibroblastActivation: [0, 100],
});

const ENTITY_LIMITS = Object.freeze({
  cancer: 7000,
  tCells: 1200,
  macrophages: 500,
  fibroblasts: 500,
  debris: 6000,
  vessels: 24,
  events: 100,
  history: 1000,
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} 必须是对象`);
  return value;
}

function finite(value, label, min = -Infinity, max = Infinity) {
  if (!Number.isFinite(value) || value < min || value > max) throw new TypeError(`${label} 必须是 ${min}–${max} 范围内的有限数`);
  return value;
}

function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  finite(value, label, min, max);
  if (!Number.isInteger(value)) throw new TypeError(`${label} 必须是整数`);
  return value;
}

function text(value, label, maxLength = 240, fallback = '') {
  const normalized = value ?? fallback;
  if (typeof normalized !== 'string' || normalized.length > maxLength) throw new TypeError(`${label} 必须是长度不超过 ${maxLength} 的文本`);
  return normalized;
}

function array(value, label, maxLength, required = true) {
  if (value == null && !required) return [];
  if (!Array.isArray(value) || value.length > maxLength) throw new TypeError(`${label} 必须是长度不超过 ${maxLength} 的数组`);
  return value;
}

function validateField(value, label, { required = true } = {}) {
  if (value == null && !required) return Array(GRID_SIZE).fill(0);
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) throw new TypeError(`${label} 必须是数值数组`);
  if (value.length !== GRID_SIZE) throw new TypeError(`${label} 长度必须为 ${GRID_SIZE}`);
  const result = Array.from(value);
  for (let i = 0; i < result.length; i += 1) finite(result[i], `${label}[${i}]`, 0, 1);
  return result;
}

function validateCoordinates(entity, label) {
  finite(entity.x, `${label}.x`, 0, GRID_WIDTH - 1);
  finite(entity.y, `${label}.y`, 0, GRID_HEIGHT - 1);
}

function validateEntityId(entity, label, ids) {
  integer(entity.id, `${label}.id`, 1);
  if (ids.has(entity.id)) throw new TypeError(`发现重复实体 ID：${entity.id}`);
  ids.add(entity.id);
}

function validateCancer(list, ids) {
  return array(list, 'cancer', ENTITY_LIMITS.cancer).map((cell, index) => {
    requireObject(cell, `cancer[${index}]`);
    validateEntityId(cell, `cancer[${index}]`, ids);
    validateCoordinates(cell, `cancer[${index}]`);
    integer(cell.cloneId, `cancer[${index}].cloneId`, 0, 2);
    finite(cell.health, `cancer[${index}].health`, 0.000001, 1.1);
    finite(cell.age, `cancer[${index}].age`, 0, 100000);
    finite(cell.cycle, `cancer[${index}].cycle`, 0, 1.2);
    finite(cell.stress, `cancer[${index}].stress`, 0, 1);
    finite(cell.damage, `cancer[${index}].damage`, 0, 1);
    text(cell.state, `cancer[${index}].state`, 80);
    text(cell.lastEvent, `cancer[${index}].lastEvent`, 160);
    if (cell.deathCause != null) text(cell.deathCause, `cancer[${index}].deathCause`, 80);
    return { ...cell };
  });
}

function validateTCells(list, ids) {
  return array(list, 'tCells', ENTITY_LIMITS.tCells).map((cell, index) => {
    requireObject(cell, `tCells[${index}]`);
    validateEntityId(cell, `tCells[${index}]`, ids);
    validateCoordinates(cell, `tCells[${index}]`);
    finite(cell.energy, `tCells[${index}].energy`, 0, 1.1);
    finite(cell.exhaustion, `tCells[${index}].exhaustion`, 0, 1);
    cell.stemlike = finite(cell.stemlike ?? Math.max(0, 1 - cell.exhaustion * 1.15), `tCells[${index}].stemlike`, 0, 1);
    cell.terminalExhaustion = finite(cell.terminalExhaustion ?? Math.max(0, (cell.exhaustion - 0.45) / 0.55), `tCells[${index}].terminalExhaustion`, 0, 1);
    finite(cell.activation, `tCells[${index}].activation`, 0, 1.2);
    finite(cell.age, `tCells[${index}].age`, 0, 100000);
    integer(cell.kills, `tCells[${index}].kills`, 0, 1000000);
    text(cell.state, `tCells[${index}].state`, 80);
    text(cell.lastEvent, `tCells[${index}].lastEvent`, 160);
    return { ...cell };
  });
}

function validateMacrophages(list, ids) {
  return array(list, 'macrophages', ENTITY_LIMITS.macrophages, false).map((cell, index) => {
    requireObject(cell, `macrophages[${index}]`);
    validateEntityId(cell, `macrophages[${index}]`, ids);
    validateCoordinates(cell, `macrophages[${index}]`);
    finite(cell.activation, `macrophages[${index}].activation`, -1, 1);
    finite(cell.energy, `macrophages[${index}].energy`, 0, 1.1);
    finite(cell.age, `macrophages[${index}].age`, 0, 100000);
    integer(cell.phagocytosed, `macrophages[${index}].phagocytosed`, 0, 1000000);
    finite(cell.efferocytosisMemory, `macrophages[${index}].efferocytosisMemory`, 0, 1);
    text(cell.state, `macrophages[${index}].state`, 80);
    text(cell.lastEvent, `macrophages[${index}].lastEvent`, 160);
    return { ...cell };
  });
}

function validateFibroblasts(list, ids) {
  return array(list, 'fibroblasts', ENTITY_LIMITS.fibroblasts, false).map((cell, index) => {
    requireObject(cell, `fibroblasts[${index}]`);
    validateEntityId(cell, `fibroblasts[${index}]`, ids);
    validateCoordinates(cell, `fibroblasts[${index}]`);
    finite(cell.activation, `fibroblasts[${index}].activation`, 0, 1);
    finite(cell.matrixActivity, `fibroblasts[${index}].matrixActivity`, 0, 1);
    finite(cell.exclusionActivity, `fibroblasts[${index}].exclusionActivity`, 0, 1);
    finite(cell.age, `fibroblasts[${index}].age`, 0, 100000);
    text(cell.state, `fibroblasts[${index}].state`, 80);
    text(cell.lastEvent, `fibroblasts[${index}].lastEvent`, 160);
    return { ...cell };
  });
}

function validateDebris(list, ids) {
  return array(list, 'debris', ENTITY_LIMITS.debris).map((item, index) => {
    requireObject(item, `debris[${index}]`);
    validateEntityId(item, `debris[${index}]`, ids);
    validateCoordinates(item, `debris[${index}]`);
    finite(item.age, `debris[${index}].age`, 0, 100000);
    finite(item.alpha, `debris[${index}].alpha`, 0, 1);
    if (!['apoptotic', 'necrotic'].includes(item.mode)) throw new TypeError(`debris[${index}].mode 无效`);
    text(item.cause, `debris[${index}].cause`, 80);
    return { ...item };
  });
}

function validateVessels(list) {
  return array(list, 'vessels', ENTITY_LIMITS.vessels).map((vessel, index) => {
    requireObject(vessel, `vessels[${index}]`);
    finite(vessel.stability, `vessels[${index}].stability`, 0, 1);
    finite(vessel.perfusion, `vessels[${index}].perfusion`, 0, 1.5);
    const points = array(vessel.points, `vessels[${index}].points`, 100).map((point, pointIndex) => {
      requireObject(point, `vessels[${index}].points[${pointIndex}]`);
      finite(point.x, `vessels[${index}].points[${pointIndex}].x`, -10, GRID_WIDTH + 10);
      finite(point.y, `vessels[${index}].points[${pointIndex}].y`, -10, GRID_HEIGHT + 10);
      return { x: point.x, y: point.y };
    });
    if (!points.length) throw new TypeError(`vessels[${index}] 至少需要一个点`);
    return { ...vessel, points };
  });
}

function validateEvents(list, ids) {
  return array(list, 'events', ENTITY_LIMITS.events, false).map((event, index) => {
    requireObject(event, `events[${index}]`);
    validateEntityId(event, `events[${index}]`, ids);
    finite(event.time, `events[${index}].time`, 0, 1000000);
    text(event.kind, `events[${index}].kind`, 32);
    text(event.title, `events[${index}].title`, 100);
    text(event.detail, `events[${index}].detail`, 500);
    return { ...event };
  });
}

function validateHistory(list) {
  return array(list, 'history', ENTITY_LIMITS.history, false).map((entry, index) => {
    requireObject(entry, `history[${index}]`);
    const clean = {};
    for (const [key, value] of Object.entries(entry)) {
      if (Array.isArray(value)) {
        if (value.length > 16) throw new TypeError(`history[${index}].${key} 过长`);
        clean[key] = value.map((item, itemIndex) => finite(item, `history[${index}].${key}[${itemIndex}]`, -10000000, 10000000));
      } else if (typeof value === 'number') {
        clean[key] = finite(value, `history[${index}].${key}`, -10000000, 10000000);
      } else if (typeof value === 'string') {
        clean[key] = text(value, `history[${index}].${key}`, 100);
      }
    }
    finite(clean.time, `history[${index}].time`, 0, 1000000);
    return clean;
  });
}

export function validateParams(input = {}, scenarioId = 'rebound') {
  requireObject(input, 'params');
  const defaults = getScenario(scenarioId);
  const params = {};
  for (const [key, [min, max]] of Object.entries(PARAM_LIMITS)) {
    const value = input[key] ?? defaults[key];
    params[key] = finite(value, `params.${key}`, min, max);
  }
  for (const key of Object.keys(input)) {
    if (!(key in PARAM_LIMITS)) throw new TypeError(`未知参数：${key}`);
  }
  return params;
}

export function validateSimulationConfig(input = {}) {
  requireObject(input, '模拟配置');
  const scenarioId = text(input.scenarioId ?? 'rebound', 'scenarioId', 64);
  if (!(scenarioId in SCENARIOS)) throw new TypeError(`未知场景：${scenarioId}`);
  const seed = text(input.seed ?? 'TME-7FH2-K9P4', 'seed', 128);
  if (!seed.trim()) throw new TypeError('seed 不能为空');
  return { scenarioId, seed, params: validateParams(input.params ?? {}, scenarioId) };
}

export function validateAndMigrateState(input) {
  requireObject(input, '存档');
  const sourceVersion = integer(input.version ?? 1, 'version', 1, SAVE_VERSION);
  if (![1, 2, 3].includes(sourceVersion)) throw new TypeError(`不支持的存档版本：${sourceVersion}`);
  const migratedFromVersion = input.migratedFromVersion == null
    ? (sourceVersion < SAVE_VERSION ? sourceVersion : null)
    : integer(input.migratedFromVersion, 'migratedFromVersion', 1, SAVE_VERSION - 1);
  const scenarioId = text(input.scenarioId, 'scenarioId', 64);
  if (!(scenarioId in SCENARIOS)) throw new TypeError(`未知场景：${scenarioId}`);
  const seed = text(input.seed, 'seed', 128);
  if (!seed.trim()) throw new TypeError('seed 不能为空');
  const ids = new Set();
  const cancer = validateCancer(input.cancer, ids);
  const tCells = validateTCells(input.tCells, ids);
  const macrophages = sourceVersion >= 2 ? validateMacrophages(input.macrophages, ids) : [];
  const fibroblasts = sourceVersion >= 2 ? validateFibroblasts(input.fibroblasts, ids) : [];
  const debris = validateDebris(input.debris, ids);
  const events = validateEvents(input.events, ids);
  const history = validateHistory(input.history);
  const vessels = validateVessels(input.vessels);
  const maxId = ids.size ? Math.max(...ids) : 0;
  const nextId = integer(input.nextId ?? maxId + 1, 'nextId', 1);
  if (nextId <= maxId) throw new TypeError(`nextId 必须大于当前最大 ID ${maxId}`);
  const flags = array(input.flags, 'flags', 100, false).map((flag, index) => text(flag, `flags[${index}]`, 80));
  const state = {
    version: SAVE_VERSION,
    modelVersion: MODEL_VERSION,
    migratedFromVersion,
    scenarioId,
    seed,
    params: validateParams(input.params ?? {}, scenarioId),
    time: finite(input.time ?? 0, 'time', 0, 1000000),
    tickCount: integer(input.tickCount ?? 0, 'tickCount', 0),
    nextId,
    toxicity: finite(input.toxicity ?? 0, 'toxicity', 0, 1),
    activeChemo: finite(input.activeChemo ?? 0, 'activeChemo', 0, 1),
    activeImmuneBoost: finite(input.activeImmuneBoost ?? 0, 'activeImmuneBoost', 0, 20),
    activeMacrophageReprogramming: finite(input.activeMacrophageReprogramming ?? 0, 'activeMacrophageReprogramming', 0, 20),
    activeStromaNormalization: finite(input.activeStromaNormalization ?? 0, 'activeStromaNormalization', 0, 20),
    cumulativeKills: integer(input.cumulativeKills ?? 0, 'cumulativeKills', 0, 100000000),
    efferocytosedCount: integer(input.efferocytosedCount ?? 0, 'efferocytosedCount', 0, 100000000),
    minCancerAfterTherapy: input.minCancerAfterTherapy == null || input.minCancerAfterTherapy === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : finite(input.minCancerAfterTherapy, 'minCancerAfterTherapy', 0, 10000000),
    maxPreTherapyCancer: finite(input.maxPreTherapyCancer ?? 0, 'maxPreTherapyCancer', 0, 10000000),
    therapyStarted: Boolean(input.therapyStarted),
    flags,
    events,
    history,
    oxygen: validateField(input.oxygen, 'oxygen'),
    drug: validateField(input.drug, 'drug'),
    matrix: validateField(input.matrix, 'matrix'),
    suppression: validateField(input.suppression, 'suppression'),
    inflammation: validateField(input.inflammation, 'inflammation', { required: sourceVersion >= 2 }),
    chronicInflammation: validateField(input.chronicInflammation, 'chronicInflammation', { required: sourceVersion >= 3 }),
    angiogenic: validateField(input.angiogenic, 'angiogenic', { required: sourceVersion >= 2 }),
    vessels,
    cancer,
    tCells,
    macrophages,
    fibroblasts,
    debris,
    rngState: integer(input.rngState ?? 0, 'rngState', 0, 0xffffffff),
  };
  return state;
}

export function parseAndValidateStateText(rawText) {
  if (typeof rawText !== 'string') throw new TypeError('存档内容必须是文本');
  const bytes = new TextEncoder().encode(rawText).byteLength;
  if (bytes > MAX_SAVE_BYTES) throw new TypeError(`存档超过 ${(MAX_SAVE_BYTES / 1024 / 1024).toFixed(0)} MB 限制`);
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new TypeError('存档不是有效 JSON');
  }
  return validateAndMigrateState(parsed);
}
