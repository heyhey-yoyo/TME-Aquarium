import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const inside = (parent, target) => {
  const path = relative(parent, target);
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`);
};

try {
  if (process.argv.length !== 3) throw new Error('用法：npm run release:manifest -- <仓库外的清单.json>');
  const output = resolve(process.argv[2]);
  const outputParent = realpathSync(dirname(output));
  if (inside(root, outputParent)) throw new Error('清单必须写到仓库外，不能把清单自身或本地产物纳入源码。');
  if (git('status', '--porcelain=v1')) throw new Error('请先提交最终修改，并确认工作区干净，再生成发布清单。');
  const commit = git('rev-parse', 'HEAD');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const invasion = pkg.name === 'invasion-wind-tunnel';
  let inputRoot = root;
  let paths;
  if (invasion) {
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    const versions = readFileSync(join(root, 'simulation/versions.js'), 'utf8');
    const appVersion = versions.match(/APP_VERSION\s*=\s*['"]([^'"]+)/)?.[1];
    if (pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version || pkg.version !== appVersion) {
      throw new Error('package、lock 根项目与 APP_VERSION 必须一致。');
    }
    // 从同一最终源码重新构建，不沿用可能过期的 dist。
    execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { stdio: 'inherit' });
    inputRoot = join(root, 'dist');
    const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('发布产物中不允许目录链接。');
      return entry.isDirectory() ? walk(file) : [relative(inputRoot, file).replaceAll('\\', '/')];
    });
    paths = walk(inputRoot);
  } else {
    // TME 无构建：只列 Git 跟踪的源码，排除忽略的缓存、依赖、备份和本地产物。
    paths = git('ls-files', '-z').split('\0').filter(Boolean);
  }
  paths.sort();
  const files = paths.map((path) => {
    const resolved = realpathSync(join(inputRoot, path));
    if (!inside(inputRoot, resolved)) throw new Error(`文件超出发布目录：${path}`);
    const bytes = readFileSync(resolved);
    return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  if (commit !== git('rev-parse', 'HEAD') || git('status', '--porcelain=v1')) {
    throw new Error('生成期间源码发生变化，请固定最终提交后重试。');
  }
  const manifest = {
    name: pkg.name,
    version: pkg.version,
    sourceCommit: commit,
    scope: invasion ? 'dist' : 'git-tracked working-tree files',
    fileCount: files.length,
    checksumAlgorithm: 'SHA-256',
    contentBasis: 'Actual local file bytes; package files from this same directory. Test results are recorded separately.',
    files,
  };
  // 不覆盖已有清单；不把未执行的测试宣称为通过，也不产生自身校验条目。
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  console.log(`已生成 ${files.length} 个文件的发布清单：${output}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
