const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const AdmZip = require('adm-zip');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist', 'cloud');
const zipPath = path.join(root, 'dist', 'nov-weather-api.zip');

async function main() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(root, 'cloud', 'src', 'main.js')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: path.join(outDir, 'index.js'),
    minify: true,
    legalComments: 'none',
  });

  const zip = new AdmZip();
  zip.addLocalFile(path.join(outDir, 'index.js'));
  zip.writeZip(zipPath);

  const kb = (fs.statSync(zipPath).size / 1024).toFixed(1);
  console.log(`[cloud] ${path.relative(root, zipPath)}  ${kb} KB`);
  console.log('[cloud] 阿里云函数计算 FC（HTTP 触发器），处理程序: index.handler');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
