const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const web = path.join(root, 'dist', 'site');
const fn = path.join(root, 'dist', 'function');

const WEB_FILES = [
  'index.html',
  'styles.css',
  'api-config.js',
  'app.js',
  'radar-data.js',
  'warnings.js',
  'warnings-classic.js',
  'typhoons.js',
  'typhoon-pro.js',
  'home-feed.js',
  'cold-air-engine.js',
  'cold-air-test.js',
  'announcements.js',
  'announcements-admin.html',
  'announcements-admin.js',
];
const WEB_DIRS = ['assets', 'data', 'vendor'];
const FN_FILES = ['app.js', 'auth.js', 'radar.js', 'news.js', 'fire.js', 'hkmo.js', 'announcements.js'];

function reset(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

reset(web);
reset(fn);

for (const name of WEB_FILES) fs.copyFileSync(path.join(root, name), path.join(web, name));
for (const name of WEB_DIRS) fs.cpSync(path.join(root, name), path.join(web, name), { recursive: true });

for (const name of FN_FILES) fs.copyFileSync(path.join(root, 'cloud', 'src', name), path.join(fn, name));
fs.copyFileSync(path.join(root, 'cloud', 'edge', 'index.ts'), path.join(fn, 'index.ts'));

function size(dir) {
  let total = 0;
  let files = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = size(full);
      total += sub.total;
      files += sub.files;
    } else {
      total += fs.statSync(full).size;
      files += 1;
    }
  }
  return { total, files };
}

for (const [label, dir] of [[ 'web', web ], [ 'function', fn ]]) {
  const { total, files } = size(dir);
  console.log(`[site] ${label}: ${files} files, ${(total / 1024 / 1024).toFixed(2)} MiB -> ${dir}`);
}
