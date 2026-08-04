import { RNG } from './rng.js';
import { CLONES, getScenario } from './scenarios.js';
import { MODEL_VERSION, validateAndMigrateState, validateParams, validateSimulationConfig } from './state.js';

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const idx = (x, y, w) => y * w + x;
const eightNeighbors = [
  [-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1],
];

/**
 * TME Aquarium v1.0 evidence-aware educational model.
 *
 * All numeric values are dimensionless, normalized simulation coefficients. They are
 * not clinical or experimentally calibrated constants. The scientific provenance for
 * every qualitative rule is documented in src/evidence.js and docs/科学依据与模型溯源.md.
 */
export class Simulation {
  constructor(config = {}) {
    const { scenarioId, seed, params } = validateSimulationConfig(config);
    this.width = 96;
    this.height = 60;
    this.size = this.width * this.height;
    this.seed = seed;
    this.rng = new RNG(seed);
    this.scenario = getScenario(scenarioId);
    this.params = {
      oxygenSupply: params.oxygenSupply ?? this.scenario.oxygenSupply,
      matrixDensity: params.matrixDensity ?? this.scenario.matrixDensity,
      suppression: params.suppression ?? this.scenario.suppression,
      tInfiltration: params.tInfiltration ?? this.scenario.tInfiltration,
      mutationRate: params.mutationRate ?? this.scenario.mutationRate,
      macrophageRecruitment: params.macrophageRecruitment ?? this.scenario.macrophageRecruitment,
      fibroblastActivation: params.fibroblastActivation ?? this.scenario.fibroblastActivation,
    };
    this.time = 0;
    this.tickCount = 0;
    this.nextId = 1;
    this.toxicity = 0;
    this.activeChemo = 0;
    this.activeImmuneBoost = 0;
    this.activeMacrophageReprogramming = 0;
    this.activeStromaNormalization = 0;
    this.cumulativeKills = 0;
    this.recentKills = 0;
    this.efferocytosedCount = 0;
    this.lastCancerCount = 0;
    this.minCancerAfterTherapy = Infinity;
    this.maxPreTherapyCancer = 0;
    this.therapyStarted = false;
    this.flags = new Set();
    this.events = [];
    this.history = [];
    this.cancer = [];
    this.tCells = [];
    this.macrophages = [];
    this.fibroblasts = [];
    this.debris = [];
    this.vessels = [];
    this.oxygen = new Float32Array(this.size);
    this.drug = new Float32Array(this.size);
    this.matrix = new Float32Array(this.size);
    this.suppression = new Float32Array(this.size);
    this.inflammation = new Float32Array(this.size);
    this.chronicInflammation = new Float32Array(this.size);
    this.angiogenic = new Float32Array(this.size);
    this.occupancy = new Int32Array(this.size);
    this.tempA = new Float32Array(this.size);
    this.tempB = new Float32Array(this.size);
    this.tempC = new Float32Array(this.size);
    this.tempD = new Float32Array(this.size);
    this.tempE = new Float32Array(this.size);
    this.initialize();
  }

  initialize() {
    this.initializeVessels();
    this.initializeFields();
    this.initializeCancer();
    this.initializeTCells();
    this.initializeMacrophages();
    this.initializeFibroblasts();
    for (let i = 0; i < 26; i += 1) this.updateFields(0.08, true);
    this.recordEvent('start', '生态系统初始化', this.scenario.name);
    this.recordMetrics(true);
  }

  initializeVessels() {
    const h = this.height;
    const w = this.width;
    const addVessel = (baseX, amplitude, phase, stability = 0.8, perfusion = 0.85) => {
      const points = [];
      for (let y = -3; y < h + 3; y += 2) {
        const bend = Math.sin((y / h) * Math.PI * 2 + phase) * amplitude;
        const jitter = Math.sin(y * 0.31 + phase * 1.8) * amplitude * 0.22;
        points.push({ x: clamp(baseX + bend + jitter, 2, w - 3), y });
      }
      this.vessels.push({ points, stability, perfusion });
    };
    switch (this.scenario.vesselPattern) {
      case 'balanced':
        addVessel(24, 4.0, 0.5, 0.95, 0.95);
        addVessel(70, 5.2, 2.4, 0.92, 0.92);
        addVessel(49, 3.2, 4.6, 0.9, 0.88);
        break;
      case 'sparse':
        // Sparse but still tumor-adjacent perfusion: preserves a viable rim while allowing a hypoxic core.
        addVessel(27, 4.6, 1.0, 0.55, 0.64);
        addVessel(69, 6.2, 3.4, 0.48, 0.58);
        break;
      case 'rim':
        // Peritumoral vessels sit at the tumor margins rather than the world boundary.
        // This creates spatially heterogeneous access without making the whole lesion anoxic.
        addVessel(31, 3.2, 0.8, 0.78, 0.76);
        addVessel(67, 3.6, 3.2, 0.74, 0.74);
        break;
      default:
        addVessel(18, 4.8, 0.2, 0.58, 0.78);
        addVessel(76, 7.4, 2.1, 0.48, 0.68);
        addVessel(49, 5.8, 4.5, 0.42, 0.56);
    }
  }

  initializeFields() {
    const baseMatrix = this.params.matrixDensity / 100;
    const baseSuppression = this.params.suppression / 100;
    const cx = this.width * 0.51;
    const cy = this.height * 0.52;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const i = idx(x, y, this.width);
        const radial = Math.exp(-(((x-cx) ** 2) / 630 + ((y-cy) ** 2) / 240));
        const noise = (Math.sin(x * 0.41 + y * 0.17) + Math.sin(x * 0.13 - y * 0.37)) * 0.05;
        this.matrix[i] = clamp(baseMatrix * (0.52 + radial * 0.7 + noise));
        this.suppression[i] = clamp(baseSuppression * (0.35 + radial * 0.85 + noise * 0.5));
        this.inflammation[i] = clamp(0.015 + radial * 0.025);
        this.chronicInflammation[i] = clamp(0.008 + radial * baseSuppression * 0.035);
        this.angiogenic[i] = 0;
        // Initialize a vessel-distance oxygen gradient instead of a uniformly anoxic tumor bed.
        // The length scale is a normalized teaching parameter, not a measured diffusion constant.
        let nearestPerfusedSignal = 0;
        for (const vessel of this.vessels) {
          for (const point of vessel.points) {
            const dx = x - point.x;
            const dy = y - point.y;
            if (Math.abs(dy) > 6) continue;
            const signal = vessel.perfusion * Math.exp(-(dx * dx + dy * dy) / 90);
            if (signal > nearestPerfusedSignal) nearestPerfusedSignal = signal;
          }
        }
        this.oxygen[i] = clamp(0.06 + 0.84 * (this.params.oxygenSupply / 100) * nearestPerfusedSignal);
        this.drug[i] = 0;
      }
    }
  }

  initializeCancer() {
    const centerX = this.width * 0.51;
    const centerY = this.height * 0.53;
    const count = this.scenario.initialCancer;
    const fractions = this.scenario.cloneFractions;
    for (let n = 0; n < count; n += 1) {
      let x; let y; let attempts = 0;
      do {
        const angle = this.rng.range(0, Math.PI * 2);
        const radius = Math.sqrt(this.rng.next()) * (7 + Math.sqrt(count) * 0.5);
        x = Math.round(centerX + Math.cos(angle) * radius * 1.2 + this.rng.normal(0, 0.6));
        y = Math.round(centerY + Math.sin(angle) * radius * 0.72 + this.rng.normal(0, 0.45));
        x = clamp(x, 2, this.width - 3);
        y = clamp(y, 2, this.height - 3);
        attempts += 1;
      } while (this.occupancy[idx(x, y, this.width)] && attempts < 30);
      if (this.occupancy[idx(x, y, this.width)]) continue;
      const r = this.rng.next();
      const cloneId = r < fractions[0] ? 0 : r < fractions[0] + fractions[1] ? 1 : 2;
      this.addCancer(x, y, cloneId, this.rng.range(0.55, 1));
    }
  }

  initializeTCells() {
    for (let i = 0; i < this.scenario.initialTCells; i += 1) this.spawnTCell(true);
  }

  initializeMacrophages() {
    for (let i = 0; i < this.scenario.initialMacrophages; i += 1) this.spawnMacrophage(true);
  }

  initializeFibroblasts() {
    const cx = this.width * 0.51;
    const cy = this.height * 0.53;
    for (let i = 0; i < this.scenario.initialFibroblasts; i += 1) {
      const angle = this.rng.range(0, Math.PI * 2);
      const radius = this.rng.range(11, 24);
      const x = clamp(cx + Math.cos(angle) * radius * 1.25 + this.rng.normal(0, 1.4), 2, this.width - 3);
      const y = clamp(cy + Math.sin(angle) * radius * 0.72 + this.rng.normal(0, 1.1), 2, this.height - 3);
      this.fibroblasts.push({
        id: this.nextId++, type: 'fibroblast', x, y,
        activation: clamp(this.rng.range(0.22, 0.58) + this.scenario.fibroblastBias * 0.25),
        matrixActivity: clamp(this.rng.range(0.35, 0.72) + this.scenario.fibroblastBias * 0.2),
        exclusionActivity: clamp(this.rng.range(0.15, 0.5) + this.scenario.fibroblastBias * 0.25),
        age: this.rng.range(0, 18), state: '组织监视', lastEvent: '初始化',
      });
    }
  }

  addCancer(x, y, cloneId, cycle = 0) {
    const cell = {
      id: this.nextId++, type: 'cancer', x, y, cloneId,
      health: 1, age: this.rng.range(0, 4), cycle,
      stress: 0, state: '生长', damage: 0, deathCause: null, lastEvent: '初始化',
    };
    this.cancer.push(cell);
    this.occupancy[idx(x, y, this.width)] = cell.id;
    return cell;
  }

  randomVesselPoint() {
    const vessel = this.rng.pick(this.vessels);
    const valid = vessel.points.filter((p) => p.y >= 1 && p.y < this.height - 1);
    return this.rng.pick(valid);
  }

  spawnTCell(initial = false) {
    const point = this.randomVesselPoint();
    const cell = {
      id: this.nextId++, type: 'tcell', x: point.x + this.rng.range(-1, 1), y: point.y + this.rng.range(-1, 1),
      energy: this.rng.range(0.72, 1), exhaustion: initial ? this.rng.range(0.03, 0.22) : this.rng.range(0, 0.08),
      stemlike: initial ? this.rng.range(0.68, 0.96) : this.rng.range(0.82, 1),
      terminalExhaustion: 0,
      activation: this.rng.range(0.62, 1), age: 0, kills: 0, state: '巡游', lastEvent: '由血管进入',
    };
    this.tCells.push(cell);
    return cell;
  }

  spawnMacrophage(initial = false) {
    const point = this.randomVesselPoint();
    const bias = this.scenario.macrophageBias ?? 0;
    const cell = {
      id: this.nextId++, type: 'macrophage', x: point.x + this.rng.range(-1.4, 1.4), y: point.y + this.rng.range(-1.4, 1.4),
      activation: clamp(this.rng.normal(bias, initial ? 0.18 : 0.1), -1, 1),
      energy: this.rng.range(0.7, 1), age: initial ? this.rng.range(0, 8) : 0,
      phagocytosed: 0, efferocytosisMemory: 0, state: '巡查', lastEvent: '由血管进入',
    };
    this.macrophages.push(cell);
    return cell;
  }

  fieldValue(field, x, y) {
    const ix = clamp(Math.round(x), 0, this.width - 1);
    const iy = clamp(Math.round(y), 0, this.height - 1);
    return field[idx(ix, iy, this.width)];
  }

  setParams(next) {
    this.params = validateParams({ ...this.params, ...next }, this.scenario.id);
    const matrixTarget = this.params.matrixDensity / 100;
    const suppressionTarget = this.params.suppression / 100;
    for (let i = 0; i < this.size; i += 1) {
      this.matrix[i] = clamp(this.matrix[i] * 0.86 + matrixTarget * 0.14);
      this.suppression[i] = clamp(this.suppression[i] * 0.86 + suppressionTarget * 0.14);
    }
  }

  intervene(kind, value = 1) {
    if (kind === 'chemo') {
      const dose = clamp(value, 0.2, 1);
      this.activeChemo = Math.max(this.activeChemo, dose);
      this.toxicity = clamp(this.toxicity + dose * 0.34, 0, 1);
      this.therapyStarted = true;
      this.minCancerAfterTherapy = this.cancer.length;
      this.recordEvent('chemo', '施加细胞毒性治疗', `归一化剂量 ${Math.round(dose * 100)}%`);
    } else if (kind === 'immune') {
      this.activeImmuneBoost = Math.max(this.activeImmuneBoost, 3.5 + value * 2);
      this.toxicity = clamp(this.toxicity + 0.06, 0, 1);
      this.recordEvent('immune', '免疫激活', '短时提高 T 细胞功能并减缓耗竭；不增加基础浸润');
    } else if (kind === 'oxygen') {
      const cx = this.width * 0.5;
      const cy = this.height * 0.52;
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          const d2 = (x-cx) ** 2 + (y-cy) ** 2;
          if (d2 < 180) this.oxygen[idx(x,y,this.width)] = clamp(this.oxygen[idx(x,y,this.width)] + Math.exp(-d2 / 80) * 0.75);
        }
      }
      this.recordEvent('oxygen', '局部供氧', '肿瘤核心氧气短时升高');
    } else if (kind === 'macrophage') {
      this.activeMacrophageReprogramming = Math.max(this.activeMacrophageReprogramming, 5.2);
      this.toxicity = clamp(this.toxicity + 0.04, 0, 1);
      this.recordEvent('immune', '巨噬细胞功能重编程', '将连续功能轴短时推向促炎端；不是简单 M1/M2 转换');
    } else if (kind === 'stroma') {
      this.activeStromaNormalization = Math.max(this.activeStromaNormalization, 6.0);
      this.toxicity = clamp(this.toxicity + 0.03, 0, 1);
      this.recordEvent('stroma', '基质正常化', '暂时降低 CAF 活化与过量基质沉积，不执行彻底清除');
    } else {
      throw new TypeError(`未知干预类型：${kind}`);
    }
  }

  step(dt = 0.045) {
    this.tickCount += 1;
    this.time += dt;
    this.recentKills = 0;
    this.updateFields(dt);
    this.updateCancer(dt);
    this.updateTCells(dt);
    this.updateMacrophages(dt);
    this.updateFibroblasts(dt);
    this.updateDebris(dt);
    this.updateTherapy(dt);
    this.detectEvents();
    if (this.tickCount % 5 === 0) this.recordMetrics();
  }

  updateTherapy(dt) {
    this.activeChemo = Math.max(0, this.activeChemo - dt * 0.085);
    this.activeImmuneBoost = Math.max(0, this.activeImmuneBoost - dt);
    this.activeMacrophageReprogramming = Math.max(0, this.activeMacrophageReprogramming - dt);
    this.activeStromaNormalization = Math.max(0, this.activeStromaNormalization - dt);
    this.toxicity = Math.max(0, this.toxicity - dt * 0.006);
  }

  updateFields(dt, settling = false) {
    const supplyScale = this.params.oxygenSupply / 100;
    const drugPulse = this.activeChemo;
    const baseMatrix = this.params.matrixDensity / 100;
    const baseSuppression = this.params.suppression / 100;
    for (const vessel of this.vessels) {
      const wave = 0.76 + 0.24 * Math.sin(this.time * 1.7 + vessel.points[0].x);
      const perfusion = vessel.perfusion * (0.6 + vessel.stability * wave * 0.4);
      for (const p of vessel.points) {
        const px = Math.round(p.x); const py = Math.round(p.y);
        if (py < 0 || py >= this.height) continue;
        for (let oy = -2; oy <= 2; oy += 1) {
          for (let ox = -2; ox <= 2; ox += 1) {
            const x = px + ox; const y = py + oy;
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
            const d = Math.sqrt(ox*ox + oy*oy);
            if (d > 2.4) continue;
            const i = idx(x,y,this.width);
            const falloff = 1 - d / 2.7;
            const macrophageVascularSupport = 1 + this.angiogenic[i] * 0.18;
            this.oxygen[i] = clamp(this.oxygen[i] + dt * supplyScale * perfusion * falloff * macrophageVascularSupport * (settling ? 1.9 : 1.2));
            if (drugPulse > 0) {
              const penetration = 1 - this.matrix[i] * 0.58;
              this.drug[i] = clamp(this.drug[i] + dt * drugPulse * perfusion * falloff * penetration * 0.7);
            }
          }
        }
      }
    }
    this.diffuse(this.oxygen, this.tempA, 0.18 * dt, 0.013 * dt, 0.52);
    this.diffuse(this.drug, this.tempB, 0.12 * dt, 0.075 * dt, 0.52);
    this.diffuse(this.inflammation, this.tempC, 0.11 * dt, 0.052 * dt, 0.18);
    this.diffuse(this.chronicInflammation, this.tempE, 0.045 * dt, 0.006 * dt, 0.24);
    this.diffuse(this.angiogenic, this.tempD, 0.07 * dt, 0.026 * dt, 0.22);
    [this.oxygen, this.tempA] = [this.tempA, this.oxygen];
    [this.drug, this.tempB] = [this.tempB, this.drug];
    [this.inflammation, this.tempC] = [this.tempC, this.inflammation];
    [this.chronicInflammation, this.tempE] = [this.tempE, this.chronicInflammation];
    [this.angiogenic, this.tempD] = [this.tempD, this.angiogenic];
    for (let i = 0; i < this.size; i += 1) {
      const normalize = this.activeStromaNormalization > 0 ? 0.014 : 0;
      const matrixFloor = baseMatrix * 0.28;
      this.matrix[i] = clamp(this.matrix[i] + (baseMatrix * 0.55 - this.matrix[i]) * dt * 0.0025 - Math.max(0, this.matrix[i]-matrixFloor) * dt * normalize);
      this.suppression[i] = clamp(this.suppression[i] + (baseSuppression * 0.35 - this.suppression[i]) * dt * 0.005);
      this.oxygen[i] = clamp(this.oxygen[i]);
      this.drug[i] = clamp(this.drug[i]);
      const chronicDrive = this.inflammation[i] * (0.012 + this.suppression[i] * 0.018);
      this.chronicInflammation[i] = clamp(this.chronicInflammation[i] + chronicDrive * dt - this.chronicInflammation[i] * dt * 0.004);
      this.inflammation[i] = clamp(this.inflammation[i]);
      this.chronicInflammation[i] = clamp(this.chronicInflammation[i]);
      this.angiogenic[i] = clamp(this.angiogenic[i]);
    }
  }

  diffuse(source, target, diffusion, decay, matrixPenalty = 0) {
    const w = this.width; const h = this.height;
    for (let y = 0; y < h; y += 1) {
      const ym = y === 0 ? y : y - 1;
      const yp = y === h - 1 ? y : y + 1;
      for (let x = 0; x < w; x += 1) {
        const xm = x === 0 ? x : x - 1;
        const xp = x === w - 1 ? x : x + 1;
        const i = idx(x,y,w);
        const d = diffusion * (1 - this.matrix[i] * matrixPenalty);
        const lap = source[idx(xm,y,w)] + source[idx(xp,y,w)] + source[idx(x,ym,w)] + source[idx(x,yp,w)] - source[i] * 4;
        target[i] = Math.max(0, source[i] + lap * d - source[i] * decay);
      }
    }
  }

  rebuildOccupancy() {
    this.occupancy.fill(0);
    for (const cell of this.cancer) {
      const x = clamp(Math.round(cell.x), 0, this.width - 1);
      const y = clamp(Math.round(cell.y), 0, this.height - 1);
      cell.x = x; cell.y = y;
      this.occupancy[idx(x,y,this.width)] = cell.id;
    }
  }

  updateCancer(dt) {
    this.rebuildOccupancy();
    const survivors = [];
    const newborns = [];
    for (const cell of this.cancer) {
      const profile = CLONES[cell.cloneId];
      const i = idx(cell.x, cell.y, this.width);
      const oxygen = this.oxygen[i];
      const drug = this.drug[i];
      const suppression = this.suppression[i];
      const matrix = this.matrix[i];
      this.oxygen[i] = Math.max(0, this.oxygen[i] - dt * 0.045 * profile.metabolicDemand);
      this.suppression[i] = clamp(suppression + dt * (0.0015 + (1-oxygen)*0.0018));
      this.chronicInflammation[i] = clamp(this.chronicInflammation[i] + dt * (cell.stress * 0.0012 + suppression * 0.0005));

      // oxygenTolerance is a protective trait (higher means a lower oxygen requirement),
      // not a threshold that increases oxygen demand.
      const oxygenRequirement = 0.32 - profile.oxygenTolerance * 0.22;
      const hypoxiaGap = Math.max(0, oxygenRequirement - oxygen);
      const deepHypoxia = Math.max(0, 0.10 - oxygen);
      cell.stress = clamp(cell.stress + dt * (hypoxiaGap * 0.72 + deepHypoxia * 1.25) - dt * oxygen * 0.12);
      const drugDamage = drug * profile.drugSensitivity * (0.42 + cell.cycle * 0.72) * dt * 0.55;
      cell.damage = clamp(cell.damage + drugDamage - dt * oxygen * 0.018);
      cell.health -= dt * (cell.stress * 0.052 + cell.damage * 0.18 + deepHypoxia * 0.36);
      cell.age += dt;

      if (cell.health <= 0 || cell.stress > 0.98 && this.rng.chance(dt * 0.5)) {
        const cause = cell.deathCause || (drugDamage > deepHypoxia ? '药物诱导死亡' : '缺氧坏死');
        const mode = cause === '缺氧坏死' ? 'necrotic' : 'apoptotic';
        this.debris.push({ id: this.nextId++, type: 'debris', x: cell.x, y: cell.y, age: 0, cause, mode, alpha: 1 });
        if (mode === 'necrotic') this.inflammation[i] = clamp(this.inflammation[i] + 0.18);
        this.occupancy[i] = 0;
        continue;
      }

      const oxygenFactor = clamp((oxygen - oxygenRequirement * 0.45) / 0.42, 0.05, 1);
      const damageFactor = clamp(1 - cell.damage * 1.4, 0, 1);
      const crowd = this.countOccupiedNeighbors(cell.x, cell.y);
      const spaceFactor = crowd >= 7 ? 0 : 1 - crowd / 10;
      const growth = dt * 0.34 * profile.proliferation * oxygenFactor * damageFactor * spaceFactor;
      cell.cycle += growth;
      cell.state = drug > 0.14 ? '药物应激' : oxygen < oxygenRequirement ? '缺氧应激' : crowd >= 7 ? '拥挤静息' : cell.cycle > 0.82 ? '分裂准备' : '生长';
      cell.lastEvent = cell.state;

      if (cell.cycle >= 1) {
        const spot = this.findEmptyNeighbor(cell.x, cell.y);
        if (spot) {
          let childClone = cell.cloneId;
          const mutationChance = (this.params.mutationRate / 1000) * dt * 0.8;
          if (this.rng.chance(mutationChance)) childClone = this.rng.pick([0,1,2]);
          newborns.push({ x: spot.x, y: spot.y, cloneId: childClone });
          this.occupancy[idx(spot.x,spot.y,this.width)] = -1;
          cell.cycle = this.rng.range(0.08,0.22);
          cell.health = Math.min(1, cell.health + 0.06);
          cell.lastEvent = childClone === cell.cloneId ? '完成分裂' : '分裂并发生性状漂移';
        } else {
          cell.cycle = 0.96;
        }
      } else if (crowd > 5 && this.rng.chance(dt * profile.motility * (1-matrix) * 0.12)) {
        const spot = this.findEmptyNeighbor(cell.x, cell.y);
        if (spot) {
          this.occupancy[i] = 0;
          cell.x = spot.x; cell.y = spot.y;
          this.occupancy[idx(spot.x,spot.y,this.width)] = cell.id;
        }
      }
      survivors.push(cell);
    }
    this.cancer = survivors;
    for (const child of newborns) this.addCancer(child.x, child.y, child.cloneId, this.rng.range(0.02,0.16));
  }

  countOccupiedNeighbors(x, y) {
    let count = 0;
    for (const [dx,dy] of eightNeighbors) {
      const nx=x+dx, ny=y+dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height && this.occupancy[idx(nx,ny,this.width)] !== 0) count += 1;
    }
    return count;
  }

  findEmptyNeighbor(x, y) {
    const candidates = [];
    for (const [dx,dy] of eightNeighbors) {
      const nx=x+dx, ny=y+dy;
      if (nx < 1 || nx >= this.width-1 || ny < 1 || ny >= this.height-1) continue;
      const i=idx(nx,ny,this.width);
      if (this.occupancy[i] === 0) {
        const oxygen = this.oxygen[i];
        const matrix = this.matrix[i];
        candidates.push({x:nx,y:ny,score:oxygen*0.65+(1-matrix)*0.2+this.rng.next()*0.25});
      }
    }
    candidates.sort((a,b)=>b.score-a.score);
    return candidates[0] || null;
  }

  updateTCells(dt) {
    const infiltration = this.params.tInfiltration / 100;
    const entryBarrier = clamp(this.averageField(this.matrix) * 0.35 + this.averageCAFExclusion() * 0.35, 0, 0.75);
    if (this.rng.chance(dt * infiltration * 0.44 * (1 - this.toxicity * 0.55) * (1-entryBarrier))) this.spawnTCell(false);
    const survivors = [];
    for (const t of this.tCells) {
      t.age += dt;
      const localSuppression = this.fieldValue(this.suppression,t.x,t.y);
      const localMatrix = this.fieldValue(this.matrix,t.x,t.y);
      const localOxygen = this.fieldValue(this.oxygen,t.x,t.y);
      const localInflammation = this.fieldValue(this.inflammation,t.x,t.y);
      const localChronicInflammation = this.fieldValue(this.chronicInflammation,t.x,t.y);
      const hypoxicStress = clamp((0.38 - localOxygen) / 0.38);
      const macrophageBarrier = this.macrophageBarrierAt(t.x,t.y);
      const immuneBoost = this.activeImmuneBoost > 0 ? 0.38 : 0;
      const exhaustionDrive = 0.006 + localSuppression * 0.036 + macrophageBarrier * 0.018 + localChronicInflammation * 0.05 + hypoxicStress * 0.012;
      t.exhaustion = clamp(t.exhaustion + dt * exhaustionDrive - dt * immuneBoost * 0.018);
      t.stemlike = clamp((t.stemlike ?? Math.max(0, 1-t.exhaustion)) - dt * (localChronicInflammation * 0.035 + t.exhaustion * 0.01 + hypoxicStress * 0.012) + dt * immuneBoost * 0.004);
      const terminalTarget = clamp(((t.exhaustion - 0.28) / 0.72) * 0.75 + localChronicInflammation * 0.45 + hypoxicStress * 0.28 + localSuppression * 0.12 - t.stemlike * 0.18);
      t.terminalExhaustion = clamp((t.terminalExhaustion ?? 0) + (terminalTarget - (t.terminalExhaustion ?? 0)) * dt * 0.22);
      t.energy = clamp(t.energy - dt * (0.006 + t.exhaustion * 0.012 + t.terminalExhaustion * 0.008) + dt * localInflammation * 0.004);
      t.activation = clamp(0.84 - t.exhaustion * 0.56 - t.terminalExhaustion * 0.38 - localSuppression * 0.28 - macrophageBarrier * 0.22 + localInflammation * 0.09 + immuneBoost);
      if (t.age > 18 + this.rng.range(-2,5) || t.energy <= 0.02 || this.rng.chance(dt * this.toxicity * 0.012)) continue;
      const target = this.nearestCancer(t.x,t.y,8.5);
      if (target && this.distance(t,target) < 1.7) {
        const profile = CLONES[target.cloneId];
        const chance = dt * 0.9 * t.activation * (1-profile.immuneEvasion) * (1-localSuppression*0.6) * (1-macrophageBarrier*0.45);
        if (this.rng.chance(chance)) {
          target.health -= 0.38 + t.activation * 0.34;
          target.deathCause = target.health <= 0 ? 'T 细胞杀伤' : target.deathCause;
          target.lastEvent = `受到 T 细胞 #${t.id} 攻击`;
          t.energy = clamp(t.energy - 0.08);
          t.exhaustion = clamp(t.exhaustion + 0.035);
          t.stemlike = clamp(t.stemlike - 0.018);
          t.kills += target.health <= 0 ? 1 : 0;
          if (target.health <= 0) {
            this.cumulativeKills += 1;
            this.recentKills += 1;
            t.lastEvent = `杀伤癌细胞 #${target.id}`;
          }
          t.state = '攻击';
        } else t.state = macrophageBarrier > 0.35 ? '巨噬细胞阻滞' : '识别目标';
      } else {
        const speed = dt * (1.8 - localMatrix * 1.15) * (0.4 + t.activation) * (1-macrophageBarrier*0.5);
        const vector = target ? this.directionTo(t,target) : {x:this.rng.range(-1,1),y:this.rng.range(-1,1)};
        t.x = clamp(t.x + vector.x * speed + this.rng.range(-0.18,0.18), 0.5, this.width-1.5);
        t.y = clamp(t.y + vector.y * speed + this.rng.range(-0.18,0.18), 0.5, this.height-1.5);
        t.state = macrophageBarrier > 0.42 ? '巨噬细胞阻滞' : target ? '趋化' : '巡游';
        t.lastEvent = t.terminalExhaustion > 0.62 ? '终末耗竭偏高' : t.exhaustion > 0.72 ? '明显耗竭' : t.state;
      }
      survivors.push(t);
    }
    this.tCells = survivors;
  }

  updateMacrophages(dt) {
    const recruitment = this.params.macrophageRecruitment / 100;
    const damageSignal = clamp(this.debris.length / 70 + this.computeMetricsLight().hypoxicFraction * 0.35, 0, 1);
    if (this.macrophages.length < 120 && this.rng.chance(dt * recruitment * (0.10 + damageSignal * 0.34))) this.spawnMacrophage(false);
    const survivors = [];
    const consumed = new Set();
    for (const m of this.macrophages) {
      m.age += dt;
      m.efferocytosisMemory = Math.max(0, m.efferocytosisMemory - dt * 0.055);
      const oxygen = this.fieldValue(this.oxygen,m.x,m.y);
      const suppression = this.fieldValue(this.suppression,m.x,m.y);
      const inflammation = this.fieldValue(this.inflammation,m.x,m.y);
      const chronicInflammation = this.fieldValue(this.chronicInflammation,m.x,m.y);
      const hypoxiaCue = clamp((0.3-oxygen)/0.3);
      const reprogramming = this.activeMacrophageReprogramming > 0 ? 0.85 : 0;
      const targetActivation = clamp(
        hypoxiaCue * 0.58 + suppression * 0.48 + chronicInflammation * 0.26 + m.efferocytosisMemory * 0.75
        - inflammation * 0.45 - reprogramming,
        -1, 1,
      );
      m.activation = clamp(m.activation + (targetActivation-m.activation) * dt * 0.22, -1, 1);
      m.energy = clamp(m.energy - dt * 0.004 + dt * 0.002);
      const debris = this.nearestDebris(m.x,m.y,7.5,consumed);
      if (debris && this.distance(m,debris) < 1.45) {
        consumed.add(debris.id);
        m.phagocytosed += 1;
        this.efferocytosedCount += 1;
        m.energy = clamp(m.energy + 0.08);
        if (debris.mode === 'apoptotic') {
          m.efferocytosisMemory = clamp(m.efferocytosisMemory + 0.28);
          m.activation = clamp(m.activation + 0.07, -1, 1);
          this.addFieldAt(this.suppression,m.x,m.y,0.045,2);
          m.lastEvent = `清除凋亡碎片 #${debris.id}`;
        } else {
          m.activation = clamp(m.activation - 0.05, -1, 1);
          this.addFieldAt(this.inflammation,m.x,m.y,0.08,2.2);
          m.lastEvent = `清除坏死碎片 #${debris.id}`;
        }
        m.state = '吞噬清除';
      } else {
        const cancerTarget = this.nearestCancer(m.x,m.y,10);
        const hypoxiaTarget = this.hypoxiaGradientTarget(m.x,m.y);
        const target = debris || (hypoxiaCue > 0.18 ? hypoxiaTarget : cancerTarget) || cancerTarget;
        const speed = dt * (0.65 + (1-this.fieldValue(this.matrix,m.x,m.y))*0.42);
        const vector = target ? this.directionTo(m,target) : {x:this.rng.range(-1,1),y:this.rng.range(-1,1)};
        m.x = clamp(m.x + vector.x * speed + this.rng.range(-0.11,0.11), 0.8, this.width-1.8);
        m.y = clamp(m.y + vector.y * speed + this.rng.range(-0.11,0.11), 0.8, this.height-1.8);
        m.state = m.activation > 0.35 ? '修复/抑制偏向' : m.activation < -0.25 ? '促炎偏向' : target ? '趋化巡查' : '巡查';
        m.lastEvent = m.state;
      }
      if (m.activation > 0) {
        this.addFieldAt(this.suppression,m.x,m.y,dt * m.activation * 0.018,2.5);
        this.addFieldAt(this.angiogenic,m.x,m.y,dt * m.activation * hypoxiaCue * 0.021,3);
      } else {
        this.addFieldAt(this.inflammation,m.x,m.y,dt * -m.activation * 0.014,2.1);
        this.addFieldAt(this.suppression,m.x,m.y,-dt * -m.activation * 0.006,1.7);
      }
      if (m.age < 32 + this.rng.range(-3,8) && m.energy > 0.02) survivors.push(m);
    }
    this.macrophages = survivors;
    if (consumed.size) this.debris = this.debris.filter((d)=>!consumed.has(d.id));
  }

  updateFibroblasts(dt) {
    const globalActivation = this.params.fibroblastActivation / 100;
    for (const f of this.fibroblasts) {
      f.age += dt;
      const cancerDensity = this.localCancerDensity(f.x,f.y,5);
      const suppression = this.fieldValue(this.suppression,f.x,f.y);
      const inflammation = this.fieldValue(this.inflammation,f.x,f.y);
      const macrophageSupport = this.macrophageBarrierAt(f.x,f.y);
      const normalization = this.activeStromaNormalization > 0 ? 0.62 : 0;
      const activationTarget = clamp(globalActivation * 0.42 + cancerDensity * 0.62 + suppression * 0.22 - normalization, 0, 1);
      f.activation = clamp(f.activation + (activationTarget-f.activation) * dt * 0.12);
      const matrixTarget = clamp(0.25 + suppression * 0.48 + cancerDensity * 0.35 - inflammation * 0.25 - normalization * 0.35);
      const exclusionTarget = clamp(0.08 + suppression * 0.5 + macrophageSupport * 0.36 + cancerDensity * 0.18 - inflammation * 0.12 - normalization * 0.25);
      f.matrixActivity = clamp(f.matrixActivity + (matrixTarget-f.matrixActivity) * dt * 0.085);
      f.exclusionActivity = clamp(f.exclusionActivity + (exclusionTarget-f.exclusionActivity) * dt * 0.08);

      const matrixOutput = dt * f.activation * f.matrixActivity * 0.017 * (this.activeStromaNormalization > 0 ? 0.22 : 1);
      const exclusionOutput = dt * f.activation * f.exclusionActivity * 0.009;
      this.addFieldAt(this.matrix,f.x,f.y,matrixOutput,2.7);
      this.addFieldAt(this.suppression,f.x,f.y,exclusionOutput,2.8);
      f.state = f.activation < 0.25 ? '低活化' : f.matrixActivity > f.exclusionActivity + 0.18 ? '基质重塑' : f.exclusionActivity > f.matrixActivity + 0.18 ? '免疫排斥信号' : '混合活化';
      f.lastEvent = this.activeStromaNormalization > 0 ? '基质正常化响应' : f.state;

      if (this.rng.chance(dt * 0.014)) {
        const target = this.nearestCancer(f.x,f.y,12);
        if (target) {
          const vector = this.directionTo(f,target);
          const distance = this.distance(f,target);
          const direction = distance < 5 ? -1 : 1;
          f.x = clamp(f.x + vector.x * direction * dt * 0.12, 1.5, this.width-2.5);
          f.y = clamp(f.y + vector.y * direction * dt * 0.12, 1.5, this.height-2.5);
        }
      }
    }
  }

  addFieldAt(field,x,y,amount,radius=2) {
    const cx=Math.round(x), cy=Math.round(y);
    const r=Math.ceil(radius);
    for(let oy=-r;oy<=r;oy+=1){
      for(let ox=-r;ox<=r;ox+=1){
        const nx=cx+ox,ny=cy+oy;
        if(nx<0||nx>=this.width||ny<0||ny>=this.height)continue;
        const d=Math.hypot(ox,oy);if(d>radius)continue;
        const weight=1-d/(radius+0.001);
        const i=idx(nx,ny,this.width);
        field[i]=clamp(field[i]+amount*weight);
      }
    }
  }

  hypoxiaGradientTarget(x,y) {
    let best = { x, y };
    let lowest = this.fieldValue(this.oxygen, x, y);
    for (const [dx, dy] of eightNeighbors) {
      const nx = clamp(x + dx * 2.2, 0.5, this.width - 1.5);
      const ny = clamp(y + dy * 2.2, 0.5, this.height - 1.5);
      const value = this.fieldValue(this.oxygen, nx, ny);
      if (value < lowest) { lowest = value; best = { x: nx, y: ny }; }
    }
    return best;
  }

  nearestCancer(x,y,maxDistance) {
    let best=null; let bestD=maxDistance*maxDistance;
    for (let n=0;n<this.cancer.length;n+=1) {
      const c=this.cancer[n];
      const dx=c.x-x, dy=c.y-y; const d=dx*dx+dy*dy;
      if (d<bestD) { bestD=d; best=c; }
    }
    return best;
  }

  nearestDebris(x,y,maxDistance,excluded=new Set()) {
    let best=null; let bestD=maxDistance*maxDistance;
    for(const d of this.debris){
      if(excluded.has(d.id))continue;
      const dx=d.x-x,dy=d.y-y,dist=dx*dx+dy*dy;
      if(dist<bestD){bestD=dist;best=d;}
    }
    return best;
  }

  distance(a,b) { return Math.hypot(a.x-b.x,a.y-b.y); }
  directionTo(a,b) { const dx=b.x-a.x, dy=b.y-a.y; const d=Math.hypot(dx,dy)||1; return {x:dx/d,y:dy/d}; }

  macrophageBarrierAt(x,y) {
    let total=0;
    for(const m of this.macrophages){
      if(m.activation<=0)continue;
      const d=Math.hypot(m.x-x,m.y-y);
      if(d<3.1)total+=m.activation*(1-d/3.1)*0.45;
    }
    return clamp(total);
  }

  localCancerDensity(x,y,radius) {
    let count=0;
    const r2=radius*radius;
    for(const c of this.cancer){const dx=c.x-x,dy=c.y-y;if(dx*dx+dy*dy<r2)count+=1;}
    return clamp(count/24);
  }

  averageCAFExclusion() {
    if(!this.fibroblasts.length)return 0;
    return this.fibroblasts.reduce((s,f)=>s+f.activation*f.exclusionActivity,0)/this.fibroblasts.length;
  }

  averageField(field) {
    let sum=0;for(let i=0;i<field.length;i+=1)sum+=field[i];return sum/field.length;
  }

  updateDebris(dt) {
    const next=[];
    for (const d of this.debris) {
      d.age += dt; d.alpha = clamp(1 - d.age / (d.mode==='necrotic'?11:8));
      if (d.mode==='necrotic') {
        this.addFieldAt(this.inflammation,d.x,d.y,dt*0.0028,1.8);
        this.addFieldAt(this.chronicInflammation,d.x,d.y,dt*0.0011,2.3);
      }
      if (d.age < (d.mode==='necrotic'?11:8)) next.push(d);
    }
    this.debris=next;
  }

  detectEvents() {
    const metrics=this.computeMetrics();
    if (metrics.hypoxicFraction > 0.18 && !this.flags.has('hypoxicCore')) {
      this.flags.add('hypoxicCore'); this.recordEvent('warning','缺氧核心形成',`${Math.round(metrics.hypoxicFraction*100)}% 区域处于低氧`);
    }
    if (metrics.suppressiveMacrophageFraction > 0.55 && metrics.macrophageCount > 12 && !this.flags.has('tamShift')) {
      this.flags.add('tamShift'); this.recordEvent('immune','巨噬细胞功能偏移','多数巨噬细胞转向修复/免疫抑制端；这是连续功能轴');
    }
    if (metrics.averageMatrix > 0.58 && metrics.activatedFibroblastFraction > 0.55 && !this.flags.has('cafBarrier')) {
      this.flags.add('cafBarrier'); this.recordEvent('stroma','CAF 基质屏障增强',`平均基质密度升至 ${Math.round(metrics.averageMatrix*100)}%`);
    }
    if (this.therapyStarted) {
      this.minCancerAfterTherapy=Math.min(this.minCancerAfterTherapy,metrics.cancerCount);
      if (metrics.cancerCount < this.maxPreTherapyCancer*0.72 && !this.flags.has('response')) {
        this.flags.add('response'); this.recordEvent('chemo','初始反应明显',`肿瘤负荷较治疗前下降 ${Math.round((1-metrics.cancerCount/this.maxPreTherapyCancer)*100)}%`);
      }
      if (metrics.resistantFraction > 0.35 && !this.flags.has('cloneShift')) {
        this.flags.add('cloneShift'); this.recordEvent('warning','克隆构成反转',`耐药克隆升至 ${Math.round(metrics.resistantFraction*100)}%`);
      }
      if (this.minCancerAfterTherapy < Infinity && metrics.cancerCount > this.minCancerAfterTherapy*1.34 && this.time > 8 && !this.flags.has('rebound')) {
        this.flags.add('rebound'); this.recordEvent('warning','治疗后反弹',`肿瘤由最低点 ${this.minCancerAfterTherapy} 重新增长`);
      }
    } else {
      this.maxPreTherapyCancer=Math.max(this.maxPreTherapyCancer,metrics.cancerCount);
    }
    if (metrics.cancerCount > 1800 && !this.flags.has('capacity')) {
      this.flags.add('capacity'); this.recordEvent('warning','生态缸接近容量上限','拥挤使更多癌细胞进入静息');
    }
  }

  recordEvent(kind,title,detail) {
    this.events.push({ id:this.nextId++, kind, title, detail, time:this.time });
    if (this.events.length>60) this.events.shift();
  }

  computeMetricsLight() {
    let hypoxicArea=0;
    for (let i=0;i<this.size;i+=1) if (this.oxygen[i]<0.24) hypoxicArea+=1;
    return {hypoxicFraction:hypoxicArea/this.size};
  }

  computeMetrics() {
    const cloneCounts=[0,0,0];
    let hypoxicCells=0;
    for (const c of this.cancer) {
      cloneCounts[c.cloneId]+=1;
      if (this.fieldValue(this.oxygen,c.x,c.y)<0.24) hypoxicCells+=1;
    }
    let hypoxicArea=0, oxygenSum=0, drugSum=0, matrixSum=0, suppressionSum=0, inflammationSum=0, chronicInflammationSum=0, angiogenicSum=0;
    let oxygenSqSum=0;
    for (let i=0;i<this.size;i+=1) {
      oxygenSum+=this.oxygen[i]; oxygenSqSum+=this.oxygen[i]*this.oxygen[i]; drugSum+=this.drug[i]; matrixSum+=this.matrix[i];
      suppressionSum+=this.suppression[i]; inflammationSum+=this.inflammation[i]; chronicInflammationSum+=this.chronicInflammation[i]; angiogenicSum+=this.angiogenic[i];
      if (this.oxygen[i]<0.24) hypoxicArea+=1;
    }
    const count=this.cancer.length;
    const activeT=this.tCells.filter((t)=>t.activation>0.55).length;
    const exhaustedT=this.tCells.filter((t)=>t.exhaustion>0.65).length;
    const terminalExhaustionLoad=this.tCells.length?this.tCells.reduce((sum,t)=>sum+(t.terminalExhaustion ?? 0),0)/this.tCells.length:0;
    const stemlikeLoad=this.tCells.length?this.tCells.reduce((sum,t)=>sum+(t.stemlike ?? 0),0)/this.tCells.length:0;
    const suppressiveMac=this.macrophages.filter((m)=>m.activation>0.25).length;
    const inflammatoryMac=this.macrophages.filter((m)=>m.activation<-0.25).length;
    const meanMacActivation=this.macrophages.length?this.macrophages.reduce((s,m)=>s+m.activation,0)/this.macrophages.length:0;
    const activatedFibroblasts=this.fibroblasts.filter((f)=>f.activation>0.5).length;
    const meanCAFExclusion=this.fibroblasts.length?this.fibroblasts.reduce((s,f)=>s+f.activation*f.exclusionActivity,0)/this.fibroblasts.length:0;
    const cloneFractions=cloneCounts.map((n)=>count? n/count:0);
    const shannon=-cloneFractions.reduce((sum,p)=>sum+(p>0?p*Math.log(p):0),0);
    const clonalDiversity=shannon/Math.log(3);
    const meanOxygen=oxygenSum/this.size;
    const oxygenVariance=Math.max(0,oxygenSqSum/this.size-meanOxygen*meanOxygen);
    const necroticDebris=this.debris.filter((d)=>d.mode==='necrotic').length;
    const immuneExclusionIndex=clamp((matrixSum/this.size)*0.42+(suppressionSum/this.size)*0.34+meanCAFExclusion*0.24);
    return {
      time:this.time,
      cancerCount:count,
      cloneCounts,
      cloneFractions,
      clonalDiversity,
      resistantFraction:count?cloneCounts[1]/count:0,
      hypoxicFraction:hypoxicArea/this.size,
      hypoxicCellFraction:count?hypoxicCells/count:0,
      averageOxygen:meanOxygen,
      perfusionHeterogeneity:clamp(Math.sqrt(oxygenVariance)/0.34),
      averageDrug:drugSum/this.size,
      averageMatrix:matrixSum/this.size,
      averageSuppression:suppressionSum/this.size,
      averageInflammation:inflammationSum/this.size,
      averageChronicInflammation:chronicInflammationSum/this.size,
      averageAngiogenicSupport:angiogenicSum/this.size,
      tCellCount:this.tCells.length,
      activeTCellFraction:this.tCells.length?activeT/this.tCells.length:0,
      exhaustedTCellFraction:this.tCells.length?exhaustedT/this.tCells.length:0,
      terminalExhaustedTCellFraction:terminalExhaustionLoad,
      stemlikeTCellFraction:stemlikeLoad,
      immuneExclusionIndex,
      macrophageCount:this.macrophages.length,
      meanMacrophageActivation:meanMacActivation,
      suppressiveMacrophageFraction:this.macrophages.length?suppressiveMac/this.macrophages.length:0,
      inflammatoryMacrophageFraction:this.macrophages.length?inflammatoryMac/this.macrophages.length:0,
      efferocytosedCount:this.efferocytosedCount,
      fibroblastCount:this.fibroblasts.length,
      activatedFibroblastFraction:this.fibroblasts.length?activatedFibroblasts/this.fibroblasts.length:0,
      meanCAFExclusion,
      cumulativeKills:this.cumulativeKills,
      recentKills:this.recentKills,
      debrisCount:this.debris.length,
      necroticDebrisFraction:this.debris.length?necroticDebris/this.debris.length:0,
      toxicity:this.toxicity,
    };
  }

  recordMetrics(force=false) {
    const metrics=this.computeMetrics();
    const last=this.history[this.history.length-1];
    if (force || !last || metrics.time-last.time>=0.22) {
      this.history.push(metrics);
      if (this.history.length>720) this.history.shift();
    }
  }

  snapshot() {
    const metrics=this.computeMetrics();
    return {
      version:3,
      modelVersion:MODEL_VERSION,
      width:this.width,
      height:this.height,
      seed:this.seed,
      scenario:{id:this.scenario.id,name:this.scenario.name,description:this.scenario.description},
      params:{...this.params},
      time:this.time,
      toxicity:this.toxicity,
      activeChemo:this.activeChemo,
      activeImmuneBoost:this.activeImmuneBoost,
      activeMacrophageReprogramming:this.activeMacrophageReprogramming,
      activeStromaNormalization:this.activeStromaNormalization,
      migrationInfo:this.migrationInfo ?? null,
      metrics,
      history:this.history.slice(-240),
      events:this.events.slice(-36),
      clones:CLONES,
      oxygen:new Float32Array(this.oxygen),
      drug:new Float32Array(this.drug),
      matrix:new Float32Array(this.matrix),
      suppression:new Float32Array(this.suppression),
      inflammation:new Float32Array(this.inflammation),
      chronicInflammation:new Float32Array(this.chronicInflammation),
      angiogenic:new Float32Array(this.angiogenic),
      vessels:this.vessels,
      cancer:this.cancer.map((c)=>({...c, oxygen:this.fieldValue(this.oxygen,c.x,c.y), drug:this.fieldValue(this.drug,c.x,c.y)})),
      tCells:this.tCells.map((t)=>({...t, suppression:this.fieldValue(this.suppression,t.x,t.y), matrix:this.fieldValue(this.matrix,t.x,t.y), acuteInflammation:this.fieldValue(this.inflammation,t.x,t.y), chronicInflammation:this.fieldValue(this.chronicInflammation,t.x,t.y)})),
      macrophages:this.macrophages.map((m)=>({...m, oxygen:this.fieldValue(this.oxygen,m.x,m.y), suppression:this.fieldValue(this.suppression,m.x,m.y)})),
      fibroblasts:this.fibroblasts.map((f)=>({...f, matrix:this.fieldValue(this.matrix,f.x,f.y), suppression:this.fieldValue(this.suppression,f.x,f.y)})),
      debris:this.debris.map((d)=>({...d})),
    };
  }

  serialize() {
    return {
      version:3,
      modelVersion:MODEL_VERSION,
      scenarioId:this.scenario.id, seed:this.seed, params:{...this.params},
      time:this.time, tickCount:this.tickCount, nextId:this.nextId,
      toxicity:this.toxicity, activeChemo:this.activeChemo, activeImmuneBoost:this.activeImmuneBoost,
      activeMacrophageReprogramming:this.activeMacrophageReprogramming,
      activeStromaNormalization:this.activeStromaNormalization,
      cumulativeKills:this.cumulativeKills, efferocytosedCount:this.efferocytosedCount,
      minCancerAfterTherapy:this.minCancerAfterTherapy,
      maxPreTherapyCancer:this.maxPreTherapyCancer, therapyStarted:this.therapyStarted,
      flags:[...this.flags], events:this.events, history:this.history,
      oxygen:Array.from(this.oxygen), drug:Array.from(this.drug), matrix:Array.from(this.matrix), suppression:Array.from(this.suppression),
      inflammation:Array.from(this.inflammation), chronicInflammation:Array.from(this.chronicInflammation), angiogenic:Array.from(this.angiogenic),
      vessels:this.vessels, cancer:this.cancer, tCells:this.tCells, macrophages:this.macrophages, fibroblasts:this.fibroblasts, debris:this.debris,
      rngState:this.rng.state,
    };
  }

  static fromState(input) {
    const state = validateAndMigrateState(input);
    const sim = new Simulation({ scenarioId: state.scenarioId, seed: state.seed, params: state.params });
    const legacyMacrophages = state.migratedFromVersion === 1 ? sim.macrophages.map((cell) => ({ ...cell })) : null;
    const legacyFibroblasts = state.migratedFromVersion === 1 ? sim.fibroblasts.map((cell) => ({ ...cell })) : null;

    sim.time=state.time; sim.tickCount=state.tickCount;
    sim.toxicity=state.toxicity; sim.activeChemo=state.activeChemo; sim.activeImmuneBoost=state.activeImmuneBoost;
    sim.activeMacrophageReprogramming=state.activeMacrophageReprogramming;
    sim.activeStromaNormalization=state.activeStromaNormalization;
    sim.cumulativeKills=state.cumulativeKills; sim.efferocytosedCount=state.efferocytosedCount;
    sim.minCancerAfterTherapy=state.minCancerAfterTherapy;
    sim.maxPreTherapyCancer=state.maxPreTherapyCancer; sim.therapyStarted=state.therapyStarted;
    sim.flags=new Set(state.flags); sim.events=state.events; sim.history=state.history;
    sim.oxygen=Float32Array.from(state.oxygen); sim.drug=Float32Array.from(state.drug);
    sim.matrix=Float32Array.from(state.matrix); sim.suppression=Float32Array.from(state.suppression);
    sim.inflammation=Float32Array.from(state.inflammation); sim.chronicInflammation=Float32Array.from(state.chronicInflammation); sim.angiogenic=Float32Array.from(state.angiogenic);
    sim.vessels=state.vessels; sim.cancer=state.cancer; sim.tCells=state.tCells.map((t)=>({
      ...t,
      stemlike:t.stemlike ?? clamp(1-t.exhaustion*1.15),
      terminalExhaustion:t.terminalExhaustion ?? clamp((t.exhaustion-0.45)/0.55),
    })); sim.debris=state.debris;
    sim.macrophages=state.macrophages; sim.fibroblasts=state.fibroblasts;

    if (state.migratedFromVersion === 1) {
      let nextId = Math.max(
        state.nextId,
        ...sim.cancer.map((cell) => cell.id + 1),
        ...sim.tCells.map((cell) => cell.id + 1),
        ...sim.debris.map((item) => item.id + 1),
        ...sim.events.map((event) => event.id + 1),
      );
      sim.macrophages = legacyMacrophages.map((cell) => ({ ...cell, id: nextId++ }));
      sim.fibroblasts = legacyFibroblasts.map((cell) => ({ ...cell, id: nextId++ }));
      sim.nextId = nextId;
      sim.migrationInfo = { fromVersion: 1, message: '已迁移 v1 存档，并补入巨噬细胞、CAF 与 v1.0 免疫状态字段。' };
    } else {
      sim.nextId=state.nextId;
      sim.migrationInfo = state.migratedFromVersion ? { fromVersion: state.migratedFromVersion, message: `已将 v${state.migratedFromVersion} 存档迁移到 v1.0 模型。` } : null;
    }
    sim.rng.state=state.rngState>>>0;
    sim.rebuildOccupancy();
    return sim;
  }
}
