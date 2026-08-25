# TME Aquarium v1.0.0 — 项目说明（供 AI 编程代理阅读）

本文档为 AI 编码助手与贡献者提供项目的约束、架构、约定和验证流程。修改代码前请先阅读本节。

## 项目定位与红线（必须遵守）

TME Aquarium 是一个**离线优先、可复现的肿瘤微环境（TME）机制教学与实验平台**，不是临床工具。

- **所有数值均为无量纲、归一化的模型系数或代理指标**，不映射真实浓度、剂量、时间或 pO₂ 阈值。
- **禁止**声称参数经过临床校准、可用于诊断/处方/患者预测，或把代理指标包装成生物医学事实。
- 任何机制规则必须能在 `src/evidence.js` 中找到证据登记（`MECHANISMS`），包括证据层级、模型翻译与边界（`caveat`）。
- 修改模型行为或新增机制时，必须同时更新：
  - `src/evidence.js`（机制登记 + 参考文献 `REFERENCES`）
  - `docs/机制证据登记_v1.0.csv`、`docs/参考文献_v1.0.csv`、`docs/references.bib`（用 `npm run evidence` 重新生成）
  - 相关教学文档（`README.md`、`CHANGELOG_v1.0.md`、`SCIENCE_MODEL_NOTES_v1.0_zh-CN.md`）

## 技术栈与运行方式

- 纯浏览器端 ES Module，**零第三方运行时依赖**；`package.json` 仅用于脚本命令。
- 模拟逻辑运行在 Web Worker（`src/simulation.worker.js`）中，主线程只做渲染与 UI。
- 无需构建步骤。本地开发：
  ```bash
  npm start          # 即 python3 -m http.server 4173
  ```
  或 `python3 -m http.server 8080`。直接用 `file://` 打开 `index.html` 时 Worker/PWA 可能受限。

## 架构与数据流

### 模块职责

| 文件 | 职责 |
| --- | --- |
| `index.html` | 全部 DOM 结构；控件用 `id`，地图图层按钮用 `data-layer` |
| `styles.css` | 响应式布局、深色主题、可访问性（色觉友好、减少动效） |
| `src/simulation.js` | `Simulation` 类：空间场、细胞主体、指标计算、干预逻辑 |
| `src/simulation.worker.js` | Worker 消息循环，白名单消息分发 |
| `src/state.js` | 存档校验（v3）、参数边界 `PARAM_LIMITS`、存档迁移 |
| `src/scenarios.js` | `CLONES`（克隆定义）与 `SCENARIOS`（六场景） |
| `src/rng.js` | 确定性 RNG（`RNG` / `hashSeed` / `makeShareCode`） |
| `src/renderer.js` | Canvas 绘制、图层、空间探针、图例 |
| `src/charts.js` | 负荷曲线与指标迷你图（Canvas 自绘，无图表库） |
| `src/evidence.js` | `REFERENCES` + `MECHANISMS` 证据登记 |
| `src/app.js` | UI 控制器、实验工作台、研究任务、导入导出 |
| `scripts/static-audit.mjs` | HTML/JS/Service Worker 完整性审计 |
| `scripts/scenario-audit.mjs` | 场景校准与敏感性审计，写入 `docs/场景校准与敏感性审计.md` |
| `scripts/export-evidence.mjs` | 从 `evidence.js` 导出 CSV 与 BibTeX |

### 关键数据流

```text
app.js --postMessage--> simulation.worker.js --> Simulation
app.js <--postMessage(snapshot)-- worker <-- Simulation.snapshot()
```

- Worker 消息类型白名单：`init | run | speed | step | params | intervene | getState | loadState`
- 干预类型白名单：`chemo | immune | oxygen | macrophage | stroma`
- Worker 与 `state.js` 都校验消息/状态，拒绝未知类型与越界值；**新增消息类型时须同时更新白名单与测试**。

## 模型核心概念

- 网格：`96 × 60`（见 `state.js` 的 `GRID_WIDTH` / `GRID_HEIGHT`）。
- 空间场（`Float32Array`，按行主序）：`oxygen / drug / matrix / suppression / inflammation / chronicInflammation / angiogenic`。
- 细胞主体：`cancer / tCells / macrophages / fibroblasts / debris / vessels`，坐标 `x,y`。
- T 细胞三维状态：`stemlike`（前体样）、`terminalExhaustion`（终末耗竭样）、`exhaustion`（总功能障碍）——均为连续代理变量，**不要**把它们当流式分群比例。
- 克隆（`CLONES`）：敏感型 / 耐药型 / 缺氧型，决定增殖、耐药、缺氧耐受与免疫逃逸差异。
- 指标：`cancerCount`、`hypoxicFraction`、`clonalDiversity`、`immuneExclusionIndex`、`terminalExhaustedTCellFraction`、`averageChronicInflammation`、`macrophageCount`、`fibroblastCount` 等（见 `simulation.js` 的 `computeMetrics`）。

## 存档与兼容性

- 当前存档格式：`SAVE_VERSION = 3`（`MODEL_VERSION = '1.0.0'`）。
- 存档大小上限：`MAX_SAVE_BYTES = 8 MiB`。
- `validateAndMigrateState` 负责从 v1/v2 迁移到 v3；**修改状态结构时，必须同时提供迁移逻辑并更新 `tests/`**。
- 状态中的实体数组、坐标、id、事件与历史长度均有上限（`ENTITY_LIMITS`），防止恶意存档导致内存问题。

## 可访问性与安全约定

- `_headers` 定义了严格 CSP（`default-src 'self'`、禁止 `eval`/远程脚本）、`X-Frame-Options: DENY`、`nosniff`、`Permissions-Policy`。**不要放宽 CSP**。
- 用户文本一律通过 `textContent` 渲染，禁止拼接 `innerHTML` 插入用户输入。
- 所有表单控件必须有 `label`/`aria-label`（由 `static-audit.mjs` 强制）。
- 外部 `target="_blank"` 链接必须带 `rel="noopener"`。
- 保持配色符合色觉友好需求；新增图层时添加 `data-layer` 按钮并补充图例。

## Service Worker 与静态资源

- `sw.js` 中 `ASSETS` 是离线缓存清单，采用缓存优先策略。
- **新增/重命名静态资源（`src/`、`styles.css`、`assets/` 等）后必须更新 `ASSETS` 与 `CACHE` 版本名**，否则用户拿不到新版；`static-audit.mjs` 会校验清单内文件存在性，但不会校验遗漏。
- 部署到 Cloudflare Pages：无需构建，输出目录为仓库根目录；`_headers` 会被自动读取。

## 验证流程（提交前必跑）

```bash
npm run verify
```

等价于依次执行：
1. `npm run evidence` — 导出证据 CSV/BibTeX，确保登记与源码一致；
2. `npm test` — Node 单元测试（`tests/`）；
3. `npm run audit` — 六场景 + 单参数敏感性 + 治疗弧审计，写入 `docs/场景校准与敏感性审计.md`；
4. `npm run check` — 静态完整性审计（DOM id、图层、外链安全、JS 语法、SW 清单、manifest）。

任何改动（尤其是模型、状态、DOM、资源清单）都应以 `npm run verify` 全部通过作为提交前提。

## 编码约定

- ES Module；命名风格：类 `PascalCase`，函数/变量 `camelCase`，常量 `UPPER_SNAKE`。
- 参数与边界校验放在入口（Worker 消息、`validateParams`、存档解析），内部计算不做重复防御。
- 模型注释用中文；错误消息使用中文。
- 指标一律归一化到 `[0, 1]`（比例类）或明确注明代理单位。
- 涉及模型行为修改时，优先在 `simulation.js` 内部收敛，避免在 `app.js` 分散硬编码阈值。

---

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理（包括未来的你自己）都必须遵守：**
>
> - 修改模型行为或新增机制时，必须同步更新 `src/evidence.js` 证据登记与相关教学文档
> - 新增/重命名静态资源后必须更新 `sw.js` 的 `ASSETS` 清单与 `CACHE` 版本名
> - 任何改动提交前必须通过 `npm run verify`
> - 不得放宽 `_headers` 中的 CSP

## 界面维护约定

工作台使用 `ydchen-portfolio` 的米白 / 赤陶色视觉系统；视觉调整不得改变空间模拟、画布语义、存档迁移、证据登记、Service Worker 清单或 CSP。

视觉验收需保持正文 15px、操作标签不小于 12px，深色画布使用独立高对比度令牌，并在 1440px 桌面与 390px 手机视口检查全局横向溢出。

修改已缓存的 CSS/JavaScript 时也必须递增 `sw.js` 的 `CACHE` 名，避免旧界面继续命中缓存。


## 标志维护约定

项目标志采用统一的深灰方章、米白线条与赤陶色识别点，页面标志与 favicon 共用同一 `project-mark.svg`。后续替换必须保持原标志容器宽高，不得借机改变页眉、网格或页面布局。
