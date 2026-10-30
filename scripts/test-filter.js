const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'C:/Users/ningk/.qoder/tmp/D--idea---qxksh';

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--hide-scrollbars'] });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('EXC:', e.message));
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle2' });
  await p.waitForFunction(() => window.__app && window.__app.state.rank.loading === false && document.querySelectorAll('#rankList .rank-row').length > 0, { timeout: 30000 });

  await p.click('#rankChips .rank-chip[data-prov="广东"]');
  await new Promise((r) => setTimeout(r, 400));
  console.log(
    'card:',
    await p.evaluate(() => ({
      meta: document.querySelector('#rankMeta').textContent,
      btn: document.querySelector('#rankOpen').textContent,
      first: document.querySelector('#rankList .rank-row').innerText.replace(/\n/g, ' | '),
    }))
  );

  await p.click('#rankOpen');
  await new Promise((r) => setTimeout(r, 600));
  console.log(
    'sheet city:',
    await p.evaluate(() => ({
      title: document.querySelector('#rankSheetTitle').textContent,
      scope: Array.from(document.querySelectorAll('#rankScope button')).map(
        (b) => b.textContent + (b.className === 'active' ? '*' : '')
      ),
      rows: document.querySelectorAll('#rankFull .rank-row').length,
      meta: document.querySelector('#rankSheetMeta').textContent,
    }))
  );
  await p.screenshot({ path: `${OUT}/rank-filter-gd.png` });

  await p.click('#rankScope button[data-scope="station"]');
  await new Promise((r) => setTimeout(r, 600));
  console.log(
    'sheet station:',
    await p.evaluate(() => ({
      title: document.querySelector('#rankSheetTitle').textContent,
      scope: Array.from(document.querySelectorAll('#rankScope button')).map(
        (b) => b.textContent + (b.className === 'active' ? '*' : '')
      ),
      rows: document.querySelectorAll('#rankFull .rank-row').length,
      meta: document.querySelector('#rankSheetMeta').textContent,
    }))
  );
  await p.screenshot({ path: `${OUT}/rank-filter-gd-station.png` });

  await p.click('#rankChipsSheet .rank-chip[data-prov="all"]');
  await new Promise((r) => setTimeout(r, 500));
  console.log(
    'reset all:',
    await p.evaluate(() => ({
      title: document.querySelector('#rankSheetTitle').textContent,
      scope: Array.from(document.querySelectorAll('#rankScope button')).map((b) => b.textContent),
      rows: document.querySelectorAll('#rankFull .rank-row').length,
    }))
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
