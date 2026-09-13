# TME Aquarium — 项目说明（供 AI 编程代理阅读）

## 项目概览

TME Aquarium 是一个离线优先、可复现的肿瘤微环境（TME）机制教学与实验平台，不是临床工具。

- **所有数值均为无量纲、归一化的模型系数或代理指标**，不映射真实浓度、剂量、时间或 pO₂ 阈值。
- **禁止**声称参数经过临床校准、可用于诊断/处方/患者预测，或把代理指标包装成生物医学事实。
- 任何机制规则必须能在 `src/evidence.js` 中找到证据登记（`MECHANISMS`），包括证据层级、模型翻译与边界（`caveat`）。

## 技术栈与运行架构

- 纯浏览器端 ES Module，**零第三方运行时依赖**；`package.json` 仅用于脚本命令。
- 模拟逻辑运行在 Web Worker（`src/simulation.worker.js`）中，主线程只做渲染与 UI。
- 无需构建步骤，但必须通过 HTTP 服务预览；`file://` 会阻止外部 ES Module 主入口加载，无法初始化交互和模拟。

## 项目结构

### 模块职责

| 文件 | 职责 |
| --- | --- |
| `index.html` | 全部 DOM 结构；控件用 `id`，地图图层按钮用 `data-layer` |
| `styles.css` | 响应式布局、深色模拟画布主题、可访问性（色觉友好、减少动效） |
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
| `sw.js` | Service Worker：离线预缓存清单 `ASSETS` 与 `CACHE` 版本名 |
| `manifest.webmanifest` | PWA 清单 |
| `_headers` | Cloudflare Pages 安全响应头（严格 CSP 等） |
| `assets/` | `icon.svg` 与 `project-mark.svg`（favicon 与 PWA 图标） |
| `tests/` | Node 单元测试，含存档往返与入口边缘坐标回归 |
| `docs/` | 证据登记与参考文献 CSV、`references.bib`、场景校准审计文档 |
| `package.json` | npm 脚本（无运行时依赖） |
| `CHANGELOG_v1.0.md` / `SCIENCE_MODEL_NOTES_v1.0_zh-CN.md` / `UPGRADE_GUIDE_v1.0_zh-CN.md` | 变更记录、科学模型说明与升级指南 |
| `docs/releases/` | 发布清单操作说明与按版本归档的历史清单 |
| `scripts/release-manifest.mjs` | 从干净的最终提交对应的 tracked 文件生成仓库外 SHA-256 清单 |
| `LICENSE` | MIT 许可证 |

### 关键数据流

```text
app.js --postMessage--> simulation.worker.js --> Simulation
app.js <--postMessage(snapshot)-- worker <-- Simulation.snapshot()
```

- Worker 消息类型白名单：`init | run | speed | step | params | intervene | getState | loadState`
- 干预类型白名单：`chemo | immune | oxygen | macrophage | stroma`
- Worker 与 `state.js` 都校验消息/状态，拒绝未知类型与越界值；**新增消息类型时须同时更新白名单与测试**。

## 运行与构建

无需构建步骤。`npm start` 调用 Python HTTP 服务，需要 Node.js 20+ 和 Python 3（`python3` 命令可用）；也可只安装 Python 3 后直接运行 `python -m http.server 4173`，访问 `http://localhost:4173`。

## 测试

```bash
npm run verify
```

等价于依次执行：

1. `npm run evidence` — 导出证据 CSV/BibTeX，确保登记与源码一致；
2. `npm test` — Node 单元测试（`tests/`）；
3. `npm run audit` — 六场景 + 单参数敏感性 + 治疗弧审计，写入 `docs/场景校准与敏感性审计.md`；
4. `npm run check` — 静态完整性审计（DOM id、图层、外链安全、JS 语法、SW 清单、manifest）。

任何改动（尤其是模型、状态、DOM、资源清单）都应以 `npm run verify` 全部通过作为提交前提。

发布检查：

```bash
npm run verify
```

## 代码组织与风格约定

应用发布版本取 `package.json`，同步 `sw.js` 缓存名并由发布清单读取；`src/state.js` 的 `MODEL_VERSION` 与 `SAVE_VERSION` 独立维护，不因应用补丁而修改。

### 模型核心概念

- 网格：`96 × 60`（见 `state.js` 的 `GRID_WIDTH` / `GRID_HEIGHT`）。
- 空间场（`Float32Array`，按行主序）：`oxygen / drug / matrix / suppression / inflammation / chronicInflammation / angiogenic`。
- 细胞主体：`cancer / tCells / macrophages / fibroblasts / debris / vessels`，坐标 `x,y`。
- T 细胞三维状态：`stemlike`（前体样）、`terminalExhaustion`（终末耗竭样）、`exhaustion`（总功能障碍）——均为连续代理变量，**不要**把它们当流式分群比例。
- 克隆（`CLONES`）：敏感型 / 耐药型 / 缺氧型，决定增殖、耐药、缺氧耐受与免疫逃逸差异。
- 指标解释以 `computeMetrics` 为准：免疫排斥为基质、抑制及 CAF 加权代理，灌注异质性字段使用氧场标准差，坏死碎片比例以全部碎片为分母。巨噬细胞炎症信号调节状态，不提供直接移动方向；证据面板区分凋亡与坏死清除。`state.history` 最多保留 720 个记录点，CSV 只导出当前窗口，长实验需分段保存。
- 指标：`cancerCount`、`hypoxicFraction`、`clonalDiversity`、`immuneExclusionIndex`、`terminalExhaustedTCellFraction`、`averageChronicInflammation`、`macrophageCount`、`fibroblastCount` 等（见 `simulation.js` 的 `computeMetrics`）。

### 存档与兼容性

- 当前存档格式：`SAVE_VERSION = 3`（`MODEL_VERSION = '1.0.0'`）——均为内部存档格式与科学模型标识，与对外 Release 版本号无关。
- 存档大小上限：`MAX_SAVE_BYTES = 8 MiB`。
- `validateAndMigrateState` 负责从 v1/v2 迁移到 v3；**修改状态结构时，必须同时提供迁移逻辑并更新 `tests/`**。
- 状态中的实体数组、坐标、id、事件与历史长度均有上限（`ENTITY_LIMITS`），防止恶意存档导致内存问题。

### 编码约定

- ES Module；命名风格：类 `PascalCase`，函数/变量 `camelCase`，常量 `UPPER_SNAKE`。
- 参数与边界校验放在入口（Worker 消息、`validateParams`、存档解析），内部计算不做重复防御。
- 模型注释用中文；错误消息使用中文。
- 指标一律归一化到 `[0, 1]`（比例类）或明确注明代理单位。
- 涉及模型行为修改时，优先在 `simulation.js` 内部收敛，避免在 `app.js` 分散硬编码阈值。

### 修改模型行为或新增机制时的必做项

- `src/evidence.js`（机制登记 + 参考文献 `REFERENCES`）
- `docs/机制证据登记_v1.0.csv`、`docs/参考文献_v1.0.csv`、`docs/references.bib`（用 `npm run evidence` 重新生成）
- 相关教学文档（`README.md`、`CHANGELOG_v1.0.md`、`SCIENCE_MODEL_NOTES_v1.0_zh-CN.md`）

### 品牌与排版

本项目为普通项目类。页眉桌面 72px、手机（≤640px）64px；方章 48×48px / 40×40px，标题衬线 18px/400/1.3、手机 16px，副标题无衬线 12px/400/1.4；标志与标题间距 12px，标题与副标题间距 2px。

页眉背景和底部分隔线横跨页面可用宽度，内容区最大宽度 1280px（含两侧各 16px 内边距），整体居中；品牌和标题靠左，操作区靠右，窄屏换行后仍保持该对齐。品牌页眉在文档顶部正常排布，随页面滚走，不固定或吸顶；表格内部表头、侧边工具和手机底部导航可按功能保留。

正文采用统一系统无衬线字体，默认 16px / 1.6；标题采用 Georgia、Times New Roman、Songti SC、STSong 衬线族。数字与代码可使用 SFMono-Regular、Consolas、Liberation Mono、Microsoft YaHei 等宽族。按钮和输入通常 15px，辅助文字 12–14px，密集科学数据允许有理由的局部调整。页面底色 #f3eee5、正文 #24221f、赤陶强调 #a94f31，柔和底色上的强调文字 #823a25；科学分类色、热图、作品主题与状态色保留必要区分度。

主样式保留一个顶层 `:root`，条件规则和深色画布局部令牌独立维护，避免叠加重复主题或末尾覆盖层。修改视觉后核对实际渲染字体、字号、间距、对比度和操作可达性；至少检查 1440、820、390px，涉及断点时补查两侧宽度，涉及画布或存储时补查交互。构建、单测、本地浏览器和线上部署分别记录；发布后禁用缓存/硬刷新，并核对实际资源版本；还必须保留旧 Service Worker 与站点缓存，验证普通刷新或应用更新提示的实际升级流程，不能用清空缓存代替。

页眉外层保持 width:100%、max-width:none，水平内边距为 max(16px,calc((100% - 1280px)/2 + 16px))；按包含块宽度计算，避免 100vw 将滚动条计入而产生溢出。手机以 16px 留白，保持标题及操作可达。

### 交互与数据约束

宽度大于 1120px 时左右面板使用 sticky 与独立 overflow-y:auto，最大高度为 100dvh − 32px，overscroll-behavior-y:contain 阻止列尾滚动传递给整页；中间工作台 sticky top:16px，高度随视口适配。侧栏可获得键盘焦点；窄屏使用自然单列布局。页眉仅显示品牌；模拟控制位于独立工具栏，select、option、optgroup 使用浅色令牌。

时间轴行使用 auto，事件卡标题可换行，不能固定为 100px 高。重开与载入重置 clearedBeforeEventId；键盘和鼠标复用 inspectCanvasAt，准星仅为渲染状态，重置、失焦或清除时移除。存档允许巨噬细胞入口生成的 y≥-0.4 抖动，保留原坐标和后续轨迹，不放宽其他无效数据。样式 URL、SW 预缓存和缓存名同步。

### 界面维护约定

工作台使用 `ydchen-portfolio` 的米白 / 赤陶色视觉系统（页面底色 `#f3eee5`、正文 `#24221f`、赤陶强调 `#a94f31`，不再保留额外 QA 覆盖层）；模拟画布保持深色独立令牌。视觉调整不得改变空间模拟、画布语义、存档迁移、证据登记、Service Worker 清单或 CSP。

视觉验收需保持正文 16px、操作标签不小于 12px，深色画布使用独立高对比度令牌，并在 1440px 桌面与 390px 手机视口检查全局横向溢出。

修改已缓存的 CSS/JavaScript 时也必须递增 `sw.js` 的 `CACHE` 名，避免旧界面继续命中缓存。

## 部署

发布缓存修订必须贯穿 HTML 脚本、深层模块引用、Worker/importScripts 与 SW 预缓存。_headers 请求使用 no-cache；托管平台可能覆盖响应缓存期限，发布仍须同步整条依赖链的资源地址并核对线上字节。SW 安装以 Request.cache=reload 获取资源。资源缓存修订独立于应用/模型/schema，不改科学算法；缓存回归检查整条依赖链，不能只检查入口查询参数。

发布前运行项目验证命令，提交并固定最终源码，再执行 `npm run release:manifest -- <仓库外的清单.json>`。输出父目录须已存在，清单对应本地实际文件字节；生成器拒绝脏工作区、仓库内输出和覆盖已有文件，不宣称执行了测试。操作与历史记录见 [发布清单说明](./docs/releases/README.md)。

部署到 Cloudflare Pages：无需构建，输出目录为仓库根目录；`_headers` 会被自动读取。

## 安全与数据注意事项

- `_headers` 定义了严格 CSP（`default-src 'self'`、禁止 `eval`/远程脚本）、`X-Frame-Options: DENY`、`nosniff`、`Permissions-Policy`。**不要放宽 CSP**。
- 用户文本一律通过 `textContent` 渲染，禁止拼接 `innerHTML` 插入用户输入。
- 所有表单控件必须有 `label`/`aria-label`（由 `static-audit.mjs` 强制）。
- 外部 `target="_blank"` 链接必须带 `rel="noopener"`。
- 保持配色符合色觉友好需求；新增图层时添加 `data-layer` 按钮并补充图例。

### Service Worker 与静态资源

- `sw.js` 中 `ASSETS` 是离线缓存清单，采用缓存优先策略。
- **新增/重命名静态资源（`src/`、`styles.css`、`assets/` 等）后必须更新 `ASSETS` 与 `CACHE` 版本名**，否则用户拿不到新版；`static-audit.mjs` 会校验清单内文件存在性，但不会校验遗漏。

## 标志维护约定

项目标志采用统一的深灰方章、米白线条与赤陶色识别点；favicon 与 PWA 图标使用 `assets/project-mark.svg`，页眉标志为其 CSS 复刻（`.brand-mark`），视觉保持一致。后续替换必须保持原标志容器宽高，不得借机改变页眉、网格或页面布局。

---

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理（包括未来的你自己）都必须遵守：**
>
> - 修改模型行为或新增机制时，必须同步更新 `src/evidence.js` 证据登记与相关教学文档
> - 新增/重命名静态资源后必须更新 `sw.js` 的 `ASSETS` 清单与 `CACHE` 版本名
> - 任何改动提交前必须通过 `npm run verify`
> - 不得放宽 `_headers` 中的 CSP
