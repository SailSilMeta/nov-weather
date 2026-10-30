const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'C:/Users/ningk/.qoder/tmp/D--idea---qxksh';

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--hide-scrollbars', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) console.log('PAGE ERROR:', m.text());
  });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5, isMobile: false });
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.url().includes('nmc.cn') ? r.abort() : r.continue()));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));

  for (const m of ['wind', 'dtemp', 'rain1h', 'rain24h']) {
    await page.click(`.tab[data-metric="${m}"]`);
    await new Promise((r) => setTimeout(r, 900));
    await page.screenshot({ path: `${OUT}/tab-${m}.png` });
    const info = await page.evaluate(() => ({
      title: document.querySelector('#mapMetric').textContent,
      legend: Array.from(document.querySelectorAll('.legend-label, .legend-h-ticks span')).map((e) => e.textContent),
    }));
    console.log(m, JSON.stringify(info));
  }

  await page.click('.tab[data-metric="temp"]');
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => window.__app.openSheet(440100));
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `${OUT}/station-desktop.png` });

  const sheetDiag = await page.evaluate(() => {
    const p = document.querySelector('.sheet-panel').getBoundingClientRect();
    const b = document.querySelector('.sheet-body');
    return { panel: { x: Math.round(p.x), w: Math.round(p.width), h: Math.round(p.height) }, scrollH: b.scrollHeight, clientH: b.clientHeight };
  });
  console.log('sheet', JSON.stringify(sheetDiag));

  await page.click('.tab[data-metric="rain24h"]');
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${OUT}/station-rain.png` });

  // mobile
  const mp = await browser.newPage();
  mp.on('pageerror', (e) => console.log('MOBILE EXCEPTION:', e.message));
  await mp.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mp.setRequestInterception(true);
  mp.on('request', (r) => (r.url().includes('nmc.cn') ? r.abort() : r.continue()));
  await mp.goto('http://localhost:5173/', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  await mp.screenshot({ path: `${OUT}/m-final.png` });

  await mp.evaluate(() => window.__app.chart.setOption({ geo: { zoom: 2.3 } }));
  await new Promise((r) => setTimeout(r, 900));
  await mp.screenshot({ path: `${OUT}/m-zoom.png` });

  await mp.evaluate(() => window.__app.openSheet(360800));
  await new Promise((r) => setTimeout(r, 700));
  await mp.screenshot({ path: `${OUT}/m-station-alert.png` });
  await mp.evaluate(() => window.__app.closeSheet());

  await mp.evaluate(() => window.__app.openSheet(440100));
  await new Promise((r) => setTimeout(r, 800));
  await mp.screenshot({ path: `${OUT}/m-station.png` });
  const mDiag = await mp.evaluate(() => {
    const p = document.querySelector('.sheet-panel').getBoundingClientRect();
    const b = document.querySelector('.sheet-body');
    return { panel: { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) }, scrollH: b.scrollHeight, clientH: b.clientHeight };
  });
  console.log('mobile sheet', JSON.stringify(mDiag));
  await mp.evaluate(() => (document.querySelector('.sheet-body').scrollTop = 420));
  await new Promise((r) => setTimeout(r, 400));
  await mp.screenshot({ path: `${OUT}/m-station-scroll.png` });

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
