const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const [width, height, out] = [Number(process.argv[2] || 1440), Number(process.argv[3] || 900), process.argv[4] || 'shot.png'];
  const url = process.argv[5] || 'http://localhost:5173/';
  const isMobile = width < 760;

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--hide-scrollbars', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile, hasTouch: isMobile });
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) console.log('PAGE ERROR:', m.text()); });
  page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('nmc.cn')) req.abort();
    else req.continue();
  });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 2200));

  const diag = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const wide = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > window.innerWidth + 1 && r.x + r.width > window.innerWidth + 1) {
        wide.push(`${el.tagName.toLowerCase()}.${el.className && el.className.baseVal === undefined ? el.className : ''} w=${Math.round(r.width)} x=${Math.round(r.x)}`);
      }
    });
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      stage: rect('.stage'),
      wrap: rect('.map-wrap'),
      map: rect('#map'),
      canvas: rect('#map canvas'),
      legend: rect('.legend'),
      tabs: rect('.metric-tabs'),
      overflow: wide.slice(0, 12),
    };
  });

  await page.screenshot({ path: out });
  console.log(JSON.stringify(diag, null, 1));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
