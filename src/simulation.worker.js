import { Simulation } from './simulation.js';
import { validateAndMigrateState, validateParams, validateSimulationConfig } from './state.js';

let simulation = null;
let running = false;
let speed = 1;
let lastTime = performance.now();
let accumulator = 0;
let lastSnapshotAt = 0;
const baseStep = 0.045;
const MESSAGE_TYPES = new Set(['init', 'run', 'speed', 'step', 'params', 'intervene', 'getState', 'loadState']);
const INTERVENTIONS = new Set(['chemo', 'immune', 'oxygen', 'macrophage', 'stroma']);

function requireMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Worker 消息必须是对象');
  if (!MESSAGE_TYPES.has(value.type)) throw new TypeError(`未知 Worker 消息类型：${String(value.type)}`);
  return value;
}

function finite(value, label, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) throw new TypeError(`${label} 必须是 ${min}–${max} 的有限数`);
  return value;
}

function sendSnapshot(force = false) {
  const now = performance.now();
  if (!simulation || (!force && now - lastSnapshotAt < 80)) return;
  lastSnapshotAt = now;
  postMessage({ type: 'snapshot', snapshot: simulation.snapshot() });
}

function loop(now) {
  const elapsed = Math.min(100, now - lastTime);
  lastTime = now;
  if (running && simulation) {
    accumulator += elapsed * speed;
    let guard = 0;
    while (accumulator >= 45 && guard < 80) {
      simulation.step(baseStep);
      accumulator -= 45;
      guard += 1;
    }
    sendSnapshot();
  }
  setTimeout(() => loop(performance.now()), 16);
}
loop(performance.now());

self.onmessage = (event) => {
  let requestId;
  try {
    const message = requireMessage(event.data);
    requestId = message.requestId;
    if (message.type === 'init') {
      simulation = new Simulation(validateSimulationConfig(message.payload ?? {}));
      running = false;
      accumulator = 0;
      sendSnapshot(true);
    } else if (message.type === 'run') {
      if (typeof message.value !== 'boolean') throw new TypeError('run.value 必须是布尔值');
      running = message.value;
      sendSnapshot(true);
    } else if (message.type === 'speed') {
      speed = finite(message.value, 'speed.value', 0.25, 16);
    } else if (message.type === 'step') {
      if (!simulation) throw new TypeError('模拟尚未初始化');
      simulation.step(baseStep);
      sendSnapshot(true);
    } else if (message.type === 'params') {
      if (!simulation) throw new TypeError('模拟尚未初始化');
      simulation.setParams(validateParams(message.value ?? {}, simulation.scenario.id));
      sendSnapshot(true);
    } else if (message.type === 'intervene') {
      if (!simulation) throw new TypeError('模拟尚未初始化');
      if (!INTERVENTIONS.has(message.kind)) throw new TypeError(`未知干预类型：${String(message.kind)}`);
      simulation.intervene(message.kind, finite(message.value ?? 1, 'intervene.value', 0, 1));
      sendSnapshot(true);
    } else if (message.type === 'getState') {
      if (!Number.isInteger(message.requestId) || message.requestId < 1) throw new TypeError('requestId 必须是正整数');
      postMessage({ type: 'state', requestId: message.requestId, state: simulation?.serialize() ?? null });
    } else if (message.type === 'loadState') {
      const state = validateAndMigrateState(message.state);
      simulation = Simulation.fromState(state);
      running = false;
      accumulator = 0;
      sendSnapshot(true);
      postMessage({
        type: 'loaded',
        migratedFromVersion: state.migratedFromVersion,
        modelVersion: state.modelVersion,
      });
    }
  } catch (error) {
    postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
