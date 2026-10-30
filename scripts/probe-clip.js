const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'C:/Users/ningk/.qoder/tmp/D--idea---qxksh';

(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  const p = await b.newPage();
  await p.setCacheEnabled(false);
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 3 });
  await p.goto('http://127.0.0.1:5173/#/warning?v=' + Date.now(), { waitUntil: 'networkidle2', timeout: 45000 });
  await p.waitForFunction(() => window.WarningPage?.state.groups.length && !window.WarningPage.state.loading, { timeout: 30000 });
  await sleep(400);
  const r = await p.evaluate(() => {
    const e = document.querySelector('.wcard.is-live').getBoundingClientRect();
    return { x: e.x, y: e.y, width: e.width, height: e.height };
  });
  const crops = {
    full: r,
    top: { x: r.x + r.width * 0.5, y: r.y + r.height * 0.2, width: r.width * 0.45, height: r.height * 0.28 },
    bottom: { x: r.x + r.width * 0.03, y: r.y + r.height * 0.66, width: r.width * 0.45, height: r.height * 0.3 },
  };
  for (const [i, delay] of [[0, 0], [1, 900], [2, 800], [3, 700]]) {
    await sleep(delay);
    for (const [name, clip] of Object.entries(crops)) {
      await p.screenshot({ path: `${OUT}/clip-${i}-${name}.png`, clip });
    }
  }
  await b.close();
})();
