import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
};
const pass = (message) => console.log(`✓ ${message}`);

const index = read('index.html');
const ids = [...index.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = [...new Set(ids.filter((id, index_) => ids.indexOf(id) !== index_))];
if (duplicates.length) fail(`HTML 存在重复 id：${duplicates.join(', ')}`);
else pass(`HTML id 唯一（${ids.length} 个）`);

const app = read('src/app.js');
const refs = [...app.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);
const missingRefs = [...new Set(refs.filter((id) => !ids.includes(id)))];
if (missingRefs.length) fail(`app.js 引用了不存在的元素：${missingRefs.join(', ')}`);
else pass(`app.js 的 ${new Set(refs).size} 个 DOM id 引用均存在`);

const labelTargets = [...index.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((match) => match[1]);
const wrappingLabels = [...index.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)]
  .flatMap((match) => [...match[1].matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].map((inner) => inner[1]));
const missingLabelTargets = [...new Set(labelTargets.filter((id) => !ids.includes(id)))];
if (missingLabelTargets.length) fail(`label 指向不存在的控件：${missingLabelTargets.join(', ')}`);
const controls = [...index.matchAll(/<(input|select|textarea)\b([^>]*\bid="([^"]+)"[^>]*)>/g)]
  .map((match) => ({ tag: match[1], attrs: match[2], id: match[3] }))
  .filter((control) => !/\btype="hidden"/.test(control.attrs) && !/\bhidden(?:\s|>|$)/.test(control.attrs));
const unlabeledControls = controls.filter((control) => !labelTargets.includes(control.id) && !wrappingLabels.includes(control.id) && !/\baria-label="[^"]+"/.test(control.attrs));
if (unlabeledControls.length) fail(`缺少可访问名称的表单控件：${unlabeledControls.map((control) => control.id).join(', ')}`);
else pass(`可见表单控件均有标签或 aria-label（${controls.length} 个）`);

const layerNames = [...index.matchAll(/\bdata-layer="([^"]+)"/g)].map((match) => match[1]);
const requiredLayers = ['cells', 'oxygen', 'drug', 'matrix', 'suppression', 'inflammation', 'chronicInflammation'];
const missingLayers = requiredLayers.filter((layer) => !layerNames.includes(layer));
if (missingLayers.length) fail(`缺少地图图层按钮：${missingLayers.join(', ')}`);
else pass(`核心地图图层齐全（${requiredLayers.length} 层）`);

const externalBlankLinks = [...index.matchAll(/<a\b([^>]*\btarget="_blank"[^>]*)>/g)].map((match) => match[1]);
const unsafeLinks = externalBlankLinks.filter((attrs) => !/\brel="[^"]*noopener/.test(attrs));
if (unsafeLinks.length) fail('存在 target="_blank" 但没有 rel="noopener" 的链接');
else pass('外部新窗口链接具备 rel="noopener"');

const scripts = [];
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(absolute);
    else if (/\.(?:js|mjs)$/.test(entry.name)) scripts.push(absolute);
  }
}
collect(path.join(root, 'src'));
collect(path.join(root, 'scripts'));
collect(path.join(root, 'tests'));
for (const file of scripts) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
pass(`JavaScript / MJS 语法检查通过（${scripts.length} 个文件）`);

const sw = read('sw.js');
const assetBlock = sw.match(/const\s+ASSETS\s*=\s*\[([\s\S]*?)\];/);
if (assetBlock) {
  const assets = [...assetBlock[1].matchAll(/['"](\.\/[^'"]+)['"]/g)].map((match) => match[1]);
  const missingAssets = assets.map((asset) => asset.replace(/^\.\//, '')).filter((asset) => !fs.existsSync(path.join(root, asset)));
  if (missingAssets.length) fail(`Service Worker 缓存清单缺失文件：${missingAssets.join(', ')}`);
  else pass(`Service Worker 缓存清单有效（${assets.length} 个资源）`);
} else fail('无法解析 Service Worker 资源清单');

const manifest = JSON.parse(read('manifest.webmanifest'));
if (manifest.start_url !== './') fail('manifest start_url 不是 ./');
else pass('Web App Manifest 可解析且 start_url 有效');

if (process.exitCode) process.exit(process.exitCode);
console.log('静态完整性审计完成。');
