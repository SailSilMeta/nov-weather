const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const AdmZip = require('adm-zip');

const root = path.resolve(__dirname, '..');

const BUILDS = [
  {
    entry: path.join(root, 'cloud', 'src', 'main.js'),
    outDir: path.join(root, 'dist', 'cloud'),
    zipPath: path.join(root, 'dist', 'nov-weather-api.zip'),
    label: '完整接口（雷达 / 新闻 / 火点 / 预警 / 公告）',
  },
  {
    entry: path.join(root, 'cloud', 'src', 'announcements-main.js'),
    outDir: path.join(root, 'dist', 'cloud-announce'),
    zipPath: path.join(root, 'dist', 'nov-weather-announce.zip'),
    label: '仅公告（CloudBase PostgreSQL）',
  },
];

async function build({ entry, outDir, zipPath, label }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const outfile = path.join(outDir, 'index.js');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile,
    minify: true,
    legalComments: 'none',
    external: ['pg-native'],
  });

  const zip = new AdmZip();
  zip.addLocalFile(outfile);
  zip.writeZip(zipPath);

  const kb = (fs.statSync(zipPath).size / 1024).toFixed(1);
  console.log(`[cloud] ${label}`);
  console.log(`[cloud] ${path.relative(root, zipPath)}  ${kb} KB`);
}

async function main() {
  for (const item of BUILDS) await build(item);
  console.log('[cloud] 函数入口: index.main（CloudBase/腾讯云 SCF）或 index.handler（阿里云 FC HTTP 触发器）');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});