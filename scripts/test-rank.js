const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'C:/Users/ningk/.qoder/tmp/D--idea---qxksh';

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--hide-scrollbars'] });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('EXC:', e.message));
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 4500));

  for (const m of ['tmax', 'dtemp']) {
    await p.click(`.tab[data-metric="${m}"]`);
    await new Promise((r) => setTimeout(r, 4000));
    const info = await p.evaluate(() => ({
      meta: document.querySelector('#rankMeta').textContent,
      first: document.querySelector('#rankList .rank-row')
        ? document.querySelector('#rankList .rank-row').innerText.replace(/\n/g, ' | ')
        : null,
      source: window.__app.state.rank.source,
    }));
    console.log(m, info);
  }

  const row = await p.$('#rankList .rank-row');
  if (row) {
    await row.click();
    await new Promise((r) => setTimeout(r, 900));
    console.log(
      'station from rank:',
      await p.evaluate(() => ({
        open: document.querySelector('#sheet').classList.contains('open'),
        title: document.querySelector('#sheetBody h3') && document.querySelector('#sheetBody h3').textContent,
      }))
    );
  }
  await p.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));
  console.log(
    'after esc:',
    await p.evaluate(() => ({
      station: document.querySelector('#sheet').classList.contains('open'),
      rank: document.querySelector('#rankSheet').classList.contains('open'),
      body: document.body.className,
    }))
  );
  await p.screenshot({ path: `${OUT}/rank-dtemp.png` });
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
