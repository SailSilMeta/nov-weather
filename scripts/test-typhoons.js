const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const YEAR = new Date(Date.now() + 8 * 3600e3).getUTCFullYear();

async function waitForStorm(page, name) {
  await page.waitForFunction((expected) => {
    const title = document.querySelector('#tpStormOverview h2');
    return title && (!expected || title.textContent === expected) && !document.querySelector('#tpTimeline').disabled;
  }, { timeout: 45000 }, name || null);
}

async function assertNoOverflow(page) {
  assert.equal(await page.evaluate(() => {
    const page = document.querySelector('#typhoonPage');
    const workspace = document.querySelector('.tp-workspace');
    return page.scrollWidth > innerWidth + 1 || workspace.scrollWidth > workspace.clientWidth + 1;
  }), false, 'no horizontal overflow');
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/#/center`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-id="typhoon"]');
    assert.ok(await page.$('[data-id="typhoon"] .fc-status.live'));
    await page.click('[data-id="typhoon"]');
    await waitForStorm(page);
    assert.ok(page.url().endsWith('#/typhoon'));
    await assertNoOverflow(page);
    assert.match(await page.$eval('#tpUpdated', (el) => el.textContent), /中央气象台/);
    assert.doesNotMatch(await page.$eval('#tpUpdated', (el) => el.textContent), /离线快照/);
    assert.match(await page.$eval('.tp-obs-source', (el) => el.textContent), /中央气象台/);
    await page.waitForFunction(() => document.querySelectorAll('[data-tp-agency]').length > 1, { timeout: 30000 });
    assert.match(await page.$eval('#tpForecastNote', (el) => el.textContent), /中央气象台（BABJ）/);
    assert.match(await page.$eval('#tpForecastNote', (el) => el.textContent), /浙江省水利厅/);
    assert.ok(await page.$('#typhoonMap .tp-eye-marker'));
    const points = await page.$eval('#tpTimeline', (el) => Number(el.max) + 1);
    assert.ok(points > 1, 'real track points');
    const hoverTarget = await page.evaluate(() => {
      const { map, points, project } = window.TyphoonPage.state;
      const point = points[Math.floor(points.length / 2)];
      const [lon, lat] = project(point.lon, point.lat);
      const center = map.latLngToContainerPoint([lat, lon]);
      const rect = document.querySelector('#typhoonMap').getBoundingClientRect();
      return { x: rect.left + center.x, y: rect.top + center.y };
    });
    await page.mouse.move(hoverTarget.x, hoverTarget.y);
    await page.waitForSelector('.tp-hover-popup .tp-popup', { timeout: 5000 });
    const hoverText = await page.$eval('.tp-hover-popup .tp-popup', (el) => el.textContent);
    assert.match(hoverText, /实况路径点/);
    assert.match(hoverText, /风速 \d+ m\/s · 气压 \d+ hPa/);
    assert.match(hoverText, /\d+\.\d°N · \d+\.\d°E/);
    await page.mouse.move(720, 20);
    await page.waitForFunction(() => !document.querySelector('.tp-hover-popup'), { timeout: 5000 });
    await page.click('#typhoonMap .tp-eye-marker');
    await page.waitForSelector('.tp-popup');
    assert.match(await page.$eval('.tp-popup', (el) => el.textContent), /最新实况点/);
    await page.click('.leaflet-popup-close-button');
    await page.$eval('#tpTimeline', (el) => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await page.$eval('#tpPointHeading', (el) => el.textContent), '历史实况');
    await page.click('#tpPlay');
    await page.waitForFunction(() => Number(document.querySelector('#tpTimeline').value) > 0);
    await page.click('#tpPlay');
    await page.click('#tpLatest');
    assert.equal(await page.$eval('#tpTimeline', (el) => Number(el.value)), points - 1);
    const agencies = await page.$$('[data-tp-agency]');
    const connected = await page.evaluate(() => {
      const { forecastLayer, points, project } = window.TyphoonPage.state;
      const latest = points.at(-1);
      const [lon, lat] = project(latest.lon, latest.lat);
      return forecastLayer.getLayers().filter((layer) => Array.isArray(layer.getLatLngs?.())).every((layer) => {
        const latlngs = layer.getLatLngs();
        const first = Array.isArray(latlngs[0]) ? latlngs[0][0] : latlngs[0];
        return Math.abs(first.lat - lat) < 1e-6 && Math.abs(first.lng - lon) < 1e-6;
      });
    });
    assert.equal(connected, true, 'forecast lines connect to the latest center');
    if (agencies.length > 1) {
      await agencies[1].click();
      assert.equal(await agencies[1].evaluate((el) => el.checked), true);
    }
    await page.click('#tpWindToggle');
    assert.equal(await page.$eval('#tpWindToggle', (el) => el.checked), false);
    await page.click('#tpWindToggle');
    await page.click('[data-tp-base="sat"]');
    assert.equal(await page.$eval('[data-tp-base="sat"]', (el) => el.getAttribute('aria-pressed')), 'true');
    await page.click('[data-tp-base="vec"]');
    await page.click('#tpFit');
    const alternateId = await page.$eval('#tpStorm', (el) => Array.from(el.options).find((o) => o.value !== el.value)?.value);
    if (alternateId) {
      await page.select('#tpStorm', alternateId);
      await waitForStorm(page);
      assert.match(await page.$eval('.tp-storm-kicker', (el) => el.textContent), new RegExp(alternateId));
    }
    await page.click('#typhoonBack');
    await page.waitForFunction(() => document.body.classList.contains('center-open'));
    assert.equal(await page.$eval('#typhoonPage', (el) => el.getAttribute('aria-hidden')), 'true');
    await page.click('[data-id="warning"]');
    await page.waitForSelector('.wcard');
    assert.ok(await page.$eval('#typhoonPage', (el) => getComputedStyle(el).display === 'none'));
    console.log('PASS desktop routing, real track, timeline, playback, forecast, wind rings, base maps, switching and warning regression');
    await page.close();

    for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
      const mobile = await browser.newPage();
      mobile.on('pageerror', (error) => errors.push(error.message));
      await mobile.setViewport({ width, height, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await mobile.goto(`${BASE}/#/typhoon`, { waitUntil: 'networkidle2' });
      await waitForStorm(mobile);
      await assertNoOverflow(mobile);
      await mobile.$eval('#tpLatest', (el) => el.scrollIntoView({ block: 'center' }));
      await mobile.tap('#tpLatest');
      assert.equal(await mobile.$eval('#tpPointHeading', (el) => el.textContent), '最新实况');
      await mobile.$eval('#tpWindToggle', (el) => el.scrollIntoView({ block: 'center' }));
      await mobile.tap('#tpWindToggle');
      assert.equal(await mobile.$eval('#tpWindToggle', (el) => el.checked), false);
      console.log(`PASS mobile ${width}x${height}: no overflow, touch controls`);
      await mobile.close();
    }

    for (const scenario of ['empty', 'offline', 'fallback', 'failure', 'malformed']) {
      const test = await browser.newPage();
      test.on('pageerror', (error) => errors.push(error.message));
      await test.setRequestInterception(true);
      test.on('request', (request) => {
        const url = request.url();
        const isNmc = url.includes('/api/typhoon/nmc/');
        const isZj = url.includes('/api/typhoon/') && !isNmc;
        if (isNmc || isZj) {
          if (scenario === 'empty' && isNmc) {
            return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: '中央气象台', data: { typhoonList: [] }, fetchedAt: new Date().toISOString(), stale: false }) });
          }
          if (scenario === 'fallback' && isNmc) return request.respond({ status: 503, contentType: 'application/json', body: '{}' });
          if (scenario === 'fallback' && isZj) return request.continue();
          if (scenario === 'malformed') return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { error: 'invalid' }, fetchedAt: new Date().toISOString(), stale: false }) });
          if (scenario === 'offline') return request.respond({ status: 503, contentType: 'application/json', body: '{}' });
          return request.respond({ status: 503, contentType: 'application/json', body: '{}' });
        }
        if (url.includes('/data/typhoons-nmc.json') && ['failure', 'malformed', 'fallback'].includes(scenario)) return request.respond({ status: 503, body: '' });
        if (url.includes('/data/typhoons.json') && ['failure', 'malformed'].includes(scenario)) return request.respond({ status: 503, body: '' });
        request.continue();
      });
      await test.goto(`${BASE}/#/typhoon`, { waitUntil: 'networkidle2' });
      if (scenario === 'offline') {
        await waitForStorm(test);
        assert.match(await test.$eval('#tpUpdated', (el) => el.textContent), /中央气象台 · 离线快照/);
      } else if (scenario === 'fallback') {
        await waitForStorm(test);
        assert.match(await test.$eval('#tpUpdated', (el) => el.textContent), /浙江省水利厅/);
      } else if (scenario === 'empty') {
        await test.waitForFunction(() => document.querySelector('#tpMapMessage').textContent.includes('暂无台风记录'));
        assert.equal(await test.$eval('#tpTimeline', (el) => el.disabled), true);
      } else {
        await test.waitForFunction(() => document.querySelector('#tpMapMessage').textContent.includes('读取失败'));
        assert.equal(await test.$eval('#typhoonRefresh', (el) => el.disabled), false);
      }
      console.log(`PASS ${scenario}`);
      await test.close();
    }
    assert.deepEqual(errors, []);
    const response = await fetch(`${BASE}/api/typhoon/list/${YEAR}`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.ok(Array.isArray(data.data));
    assert.equal(data.source, '浙江省水利厅');
    const nmcResponse = await fetch(`${BASE}/api/typhoon/nmc/list/${YEAR}`);
    assert.equal(nmcResponse.status, 200);
    const nmcData = await nmcResponse.json();
    assert.equal(nmcData.source, '中央气象台');
    assert.ok(Array.isArray(nmcData.data.typhoonList));
    const activeRow = nmcData.data.typhoonList.find((row) => row[7] === 'start') || nmcData.data.typhoonList[0];
    const nmcDetail = await (await fetch(`${BASE}/api/typhoon/nmc/detail/${activeRow[0]}`)).json();
    assert.equal(nmcDetail.source, '中央气象台');
    assert.ok(Array.isArray(nmcDetail.data.typhoon[8]));
    console.log('PASS API contracts and no JavaScript exceptions');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
