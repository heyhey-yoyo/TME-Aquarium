import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const game = fs.existsSync(path.join(root, 'js/content-loader.js'));
const invasion = fs.existsSync(path.join(root, 'simulation/versions.js'));
const swPath = invasion ? 'service-worker.js' : 'sw.js';
const html = read('index.html');
const revision = html.match(/\.js\?v=([^"']+)/)?.[1];
const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(dir + '/' + e.name) : [dir + '/' + e.name]);

test('HTML、深层模块与 Worker 共用新版URL，旧固定URL缓存不能覆盖新版依赖', () => {
  assert.ok(revision);
  const entries = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
  assert.ok(entries.length);
  for (const entry of entries) assert.equal(new URL(entry, 'https://test.invalid/').searchParams.get('v'), revision);
  const files = walk(game ? 'js' : invasion ? 'simulation' : 'src').filter(f => f.endsWith('.js'));
  if (invasion) files.push('app.js');
  let edges = 0;
  for (const file of files) for (const match of read(file).matchAll(/(['"])((?:\.\.?\/)?[\w./-]+\.js(?:\?[^'"]+)?)\1/g)) {
    const url = match[2];
    if (url.endsWith('sw.js') || url.endsWith('service-worker.js')) continue;
    const resolved = new URL(url, 'https://test.invalid/' + file);
    assert.equal(resolved.searchParams.get('v'), revision, file + ' -> ' + url);
    assert.notEqual(resolved.href, resolved.origin + resolved.pathname, '不能复用旧固定URL键');
    edges += 1;
  }
  assert.ok(edges > 0);
});

test('新离线预缓存覆盖全部脚本并绕过HTTP旧缓存', async () => {
  const handlers = {}, requests = [];
  const context = {
    self: { addEventListener(type, handler) { handlers[type] = handler; }, skipWaiting() {} },
    caches: { async open() { return { async addAll(items) { requests.push(...items); } }; } },
    Request: class { constructor(url, options) { this.url = url; this.cache = options.cache; } }
  };
  vm.runInNewContext(read(swPath), context);
  let installed;
  handlers.install({ waitUntil(promise) { installed = promise; } });
  await installed;
  assert.ok(requests.length > 10);
  for (const request of requests) {
    assert.equal(request.cache, 'reload');
    const url = new URL(request.url, 'https://test.invalid/');
    assert.ok(fs.existsSync(path.join(root, decodeURIComponent(url.pathname).slice(1) || 'index.html')));
    if (url.pathname.endsWith('.js') || (game && url.pathname.endsWith('.json')))
      assert.equal(url.searchParams.get('v'), revision, request.url);
  }
  const jsFiles = walk(game ? 'js' : invasion ? 'simulation' : 'src').filter(f => f.endsWith('.js'));
  if (invasion) jsFiles.push('app.js');
  const cachedPaths = new Set(requests.map(r => new URL(r.url, 'https://test.invalid/').pathname.slice(1)));
  for (const file of jsFiles) assert.ok(cachedPaths.has(file), file + ' 必须离线可用');
});
