(function () {
  'use strict';

  const el = document.getElementById('feedColdAirMap');
  if (!el || !window.echarts) return;

  const MAP_KEY = 'home-gd-cities';
  const CITY_COLOR = '#3f8fd6';
  const PENDING_COLOR = '#9b9b9b';
  const GATE_DEFS = [
    { ad: '440200', name: '韶关' },
    { ad: '441800', name: '清远' },
    { ad: '441600', name: '河源' },
    { ad: '441400', name: '梅州' },
  ];
  // 港澳不参与统计与滚动条，只跟着相邻城市点亮：深圳→香港，珠海→澳门
  const HK_MO_FOLLOW = [
    { name: '香港', ad: '440300' },
    { name: '澳门', ad: '440400' },
  ];
  const HK_MO_NAMES = new Set(HK_MO_FOLLOW.map((region) => region.name));

  // 城市实况卡的分区与排序：粤北四大关口排最前、云浮垫底（用户指定）
  const CITY_REGIONS = [
    { key: 'north', name: '粤北', ads: ['440200', '441800', '441600', '441400', '445300'] },
    { key: 'prd', name: '珠三角', ads: ['440100', '440300', '440600', '441900', '442000', '440400', '440700', '441200', '441300'] },
    { key: 'west', name: '粤西', ads: ['440800', '440900', '441700'] },
    { key: 'east', name: '粤东', ads: ['440500', '445100', '445200', '441500'] },
  ];
  const WIND_NAMES = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风'];
  const BEAUFORT = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];

  const GD_CITIES = ((window.MAP_DATA && window.MAP_DATA.cities && window.MAP_DATA.cities.features) || [])
    .filter((feature) => feature.properties.provinceAdcode === 440000);
  if (!GD_CITIES.length) return;

  const HKMO = (window.HKMO_GEO && window.HKMO_GEO.features) || [];
  const FEATURES = [
    ...GD_CITIES.map((feature) => ({
      ...feature,
      properties: { ...feature.properties, name: feature.properties.short || feature.properties.name },
    })),
    ...HKMO.map((feature) => ({
      ...feature,
      properties: { ...feature.properties, name: feature.properties.short || feature.properties.name },
    })),
  ];
  echarts.registerMap(MAP_KEY, { type: 'FeatureCollection', features: FEATURES });

  // 地图按经纬度等比绘制（aspectScale 1），据此把地图撑到容器能容纳的最大尺寸
  const MAP_ASPECT = (() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const walk = (coords) => {
      if (typeof coords[0] === 'number') {
        const [x, y] = coords;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        return;
      }
      for (const c of coords) walk(c);
    };
    for (const feature of FEATURES) {
      if (feature.geometry) walk(feature.geometry.coordinates);
    }
    return maxX > minX ? (maxX - minX) / (maxY - minY) : 0;
  })();

  // 地图尽量撑满容器；左上图例、右上时间所在的上方区域要留白，避免压住粤北
  function layoutFor(w, h, empty, legendH) {
    if (!w || !h || !MAP_ASPECT) return { size: '100%', center: ['50%', '50%'] };
    const side = Math.min(w, h * MAP_ASPECT);
    const landH = side / MAP_ASPECT;
    const free = h - landH;
    // 空状态只留右上时间，不需要给图例让位，地图居中
    const clearance = empty ? 0 : legendH + 18;
    // 保底留 10px 下边距，避免地图贴住卡片底部
    const top = Math.min(Math.max(free / 2, Math.min(clearance, free)), Math.max(free / 2, free - 10));
    return {
      size: `${Math.min(160, Math.max(60, (side / Math.min(w, h)) * 100)).toFixed(1)}%`,
      center: ['50%', `${(((top + landH / 2) / h) * 100).toFixed(2)}%`],
    };
  }

  function mapLayout() {
    return layoutFor(el.clientWidth, el.clientHeight, isEmpty(), legendEl ? legendEl.offsetHeight : 0);
  }

  const byShort = new Map();
  const byAd = new Map();
  for (const feature of GD_CITIES) {
    const adcode = String(feature.properties.adcode);
    const name = feature.properties.short;
    byShort.set(name, { adcode, name, center: feature.properties.center });
    byAd.set(adcode, { adcode, name, center: feature.properties.center });
  }
  const GATES = GATE_DEFS.map((g) => ({ ...g, ...byShort.get(g.name) }));
  const GATE_NAMES = new Set(GATE_DEFS.map((g) => g.name));

  // 过程未开启时，滚动条改为循环播放冷空气知识，每条停留 45 秒
  const TIPS = [
    '冷空气南下常经由南岭的山间通道进入广东。',
    '南岭是阻挡北方冷空气南下的重要地理屏障。',
    '冷空气翻山后会逐渐减弱，降温幅度有所衰减。',
    '影响广东的冷空气分为弱冷空气、强冷空气与寒潮。',
    '东路冷空气多经梅州进入粤东，西路冷空气偏向粤西。',
    '冷空气过境时，风向多转为偏北风，气温逐步下降。',
    '山脉阻挡作用，让粤北往往比粤南更早感受到降温。',
    '冷空气抵达时，有时会伴随阴雨，加剧体感寒冷。',
    '干冷空气降温明显、少雨水；湿冷空气阴冷潮湿。',
    '同一股冷空气，沿海和内陆降温节奏会存在差异。',
  ];
  const TIP_MS = 45000;

  const chipEl = document.getElementById('coldChip');
  const metaEl = document.getElementById('coldMeta');
  const stripEl = document.getElementById('coldStrip');
  const stripTagEl = document.getElementById('coldStripTag');
  const stripViewEl = document.getElementById('coldStripView');
  const legendEl = document.getElementById('coldLegend');
  const clockEl = document.getElementById('coldClock');
  const emptyEl = document.getElementById('coldEmpty');
  const downloadEl = document.getElementById('coldDownload');
  const cityTabsEl = document.getElementById('coldCityTabs');
  const cityListEl = document.getElementById('coldCityList');
  const cityMetaEl = document.getElementById('coldCityMeta');
  const cityChipEl = document.getElementById('coldCitiesChip');
  let cityRegion = 'north';

  const chart = echarts.init(el);
  const isNarrow = () => el.clientWidth < 520;
  let state = window.COLD_AIR || null;

  const pad = (n) => String(n).padStart(2, '0');
  function fmtTime(at) {
    if (!at) return '--';
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(at);
    if (!m) return at;
    return `${Number(m[2])}月${Number(m[3])}日 ${pad(m[4])}时`;
  }
  function clockText() {
    const d = new Date();
    return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 ${pad(d.getHours())}时${pad(d.getMinutes())}分`;
  }
  function renderClock() {
    if (!clockEl) return;
    const text = clockText();
    if (clockEl.textContent !== text) clockEl.textContent = text;
  }
  function hoursBetween(a, b) {
    if (!a || !b) return 0;
    return Math.max(0, Math.round((Date.parse(`${b}:00+08:00`) - Date.parse(`${a}:00+08:00`)) / 36e5));
  }

  function current() {
    const event = (state && state.event) || { status: 'watching', gate: {} };
    return {
      data: state,
      event,
      gate: (state && state.gate) || event.gate || {},
      cities: (state && state.cities) || {},
      active: event.status === 'active',
    };
  }

  // 四站全未达标且过程未开启：地图进入空状态
  function isEmpty() {
    const cur = current();
    if (cur.active) return false;
    return !GATE_DEFS.some((g) => cur.gate[g.ad] && cur.gate[g.ad].passed);
  }

  function cityOf(name) {
    const meta = byShort.get(name);
    if (!meta) return null;
    const cur = current();
    return { ...meta, data: cur.cities[meta.adcode] || null, gate: cur.gate[meta.adcode] || null };
  }

  function dot(className) {
    return `<i class="${className}"></i>`;
  }

  function tooltipHTML(name) {
    const city = cityOf(name);
    if (!city) return '';
    const d = withLive(city.data, city.adcode, state);
    const gateLine = city.gate && city.gate.passed ? `<li>南岭关口已破</li>` : '';
    if (d && d.status === 'arrived') {
      return `<div class="cold-tip">
        <div class="cold-tip-head"><b>${name}</b><span class="cold-tip-tag is-arrived">已抵达</span></div>
        <p>冷空气抵达 ${fmtTime(d.at)}</p>
        <ul>
          <li>累计降温 <b>${d.drop.toFixed(1)}℃</b></li>
          <li>${d.kind}</li>
          <li>当前气温 ${d.t == null ? '--' : `${d.t.toFixed(1)}℃`}</li>
          ${gateLine}
        </ul>
      </div>`;
    }
    if (!d) {
      return `<div class="cold-tip"><div class="cold-tip-head"><b>${name}</b><span class="cold-tip-tag">待抵达</span></div><p>冷空气尚未影响本站</p></div>`;
    }
    const move = d.drop3h >= 0 ? '降温' : '升温';
    const wind = windOf(d);
    return `<div class="cold-tip">
      <div class="cold-tip-head"><b>${name}</b><span class="cold-tip-tag">待抵达</span></div>
      <p>冷空气主体尚未抵达，注意关注降温</p>
      <ul>
        <li>当前气温 <b>${d.t == null ? '--' : `${d.t.toFixed(1)}℃`}</b></li>
        <li>${wind === '--' ? '风向不定' : wind}</li>
        <li>近 3 小时${move} ${Math.abs(d.drop3h).toFixed(1)}℃</li>
      </ul>
    </div>`;
  }

  function renderMap() {
    const empty = isEmpty();
    el.classList.toggle('is-empty', empty);
    chart.setOption(buildMapOption(mapLayout(), empty, isNarrow()), true);
    drawGates();
  }

  // ---------- 城市实况卡：分区筛选 + 可上下滚动的城市列表 ----------
  // 地图顶部“实况 HH:MM”与城市卡同源：state.live 是站点的分钟级观测
  function withLive(d, ad, data) {
    if (!d) return d;
    const live = data && data.live && data.live[ad];
    if (!live || !live.pub) return d;
    const out = { ...d };
    if (live.temp != null) {
      // 近 3h 降温跟着实况气温一起换算，行内数字才自洽
      if (out.drop3h != null && out.t != null) {
        out.drop3h = Math.round((out.drop3h + (out.t - live.temp)) * 10) / 10;
      }
      out.t = live.temp;
    }
    if (live.dir != null) out.dir = live.dir;
    if (live.spd != null) out.spd = live.spd;
    if (live.dirText) out.wind = live.dirText;
    if (live.power) {
      out.power = live.power;
      out.level = null;
    }
    if (live.rain != null) out.rain = live.rain;
    return out;
  }

  function windLevelOf(spd) {
    if (typeof spd !== 'number') return null;
    let level = 0;
    while (level < BEAUFORT.length && spd >= BEAUFORT[level]) level += 1;
    return level;
  }

  function windOf(d) {
    if (!d) return '--';
    const dir = typeof d.dir === 'number' ? ((d.dir % 360) + 360) % 360 : null;
    const name = d.wind || (dir == null ? '' : WIND_NAMES[Math.round(dir / 45) % 8]);
    // 实况接口的风力有时是「微风」这类文字，统一按风速换算成风级数字
    let level = windLevelOf(d.spd);
    if (level == null && typeof d.level === 'number') level = d.level;
    if (level == null && d.power) {
      const m = String(d.power).match(/\d+/);
      if (m) level = Number(m[0]);
    }
    if (!name) return '--';
    return level == null ? name : `${name} ${level}级`;
  }

  function cityRowHTML(ad, cur) {
    const meta = byAd.get(ad);
    if (!meta) return '';
    const d = withLive(cur.cities[ad], ad, cur.data) || null;
    const arrived = !!(d && d.status === 'arrived');
    // 已抵达看过程累计降温，未抵达看近 3h 变化
    let dropLabel = '近3h降温';
    let dropText = '--';
    if (arrived) {
      dropLabel = '累计降温';
      if (d.drop != null) dropText = `${d.drop.toFixed(1)}℃`;
    } else if (d && d.drop3h != null) {
      dropLabel = d.drop3h < 0 ? '近3h升温' : '近3h降温';
      dropText = `${Math.abs(d.drop3h).toFixed(1)}℃`;
    }
    let tag = { text: '--', cls: 'is-none' };
    if (arrived) {
      tag = /锋面/.test(d.kind || '') ? { text: '锋面冷', cls: 'is-wet' } : { text: '干冷', cls: 'is-dry' };
    }
    const facts = [
      ['气温', d && d.t != null ? `${d.t.toFixed(1)}℃` : '--'],
      [dropLabel, dropText],
      ['风向风力', windOf(d)],
      ['降水', d && d.rain != null ? `${d.rain.toFixed(1)}mm` : '--'],
    ];
    return `<div class="cold-city${arrived ? ' is-arrived' : ''}">
      <div class="cold-city-head">
        <b>${meta.name}</b>
        ${GATE_NAMES.has(meta.name) ? '<i class="cold-city-gate">关口</i>' : ''}
        <span class="cold-city-tag ${tag.cls}">${tag.text}</span>
      </div>
      <div class="cold-city-facts">
        ${facts.map(([k, v]) => `<span><em>${k}</em><b>${v}</b></span>`).join('')}
      </div>
    </div>`;
  }

  function renderCityCard() {
    if (!cityTabsEl || !cityListEl) return;
    const cur = current();
    const countArrived = (region) => region.ads.filter((ad) => {
      const city = cur.cities[ad];
      return !!(city && city.status === 'arrived');
    }).length;
    const totalArrived = CITY_REGIONS.reduce((sum, region) => sum + countArrived(region), 0);
    if (cityChipEl) {
      cityChipEl.textContent = cur.active ? `已抵达 ${totalArrived}/${GD_CITIES.length}` : '监测中';
      cityChipEl.classList.toggle('is-active', cur.active);
    }
    cityTabsEl.innerHTML = CITY_REGIONS.map((region) => {
      const on = region.key === cityRegion;
      return `<button type="button" role="tab" data-region="${region.key}" aria-selected="${on}" class="${on ? 'is-on' : ''}">${region.name}<i>${countArrived(region)}/${region.ads.length}</i></button>`;
    }).join('');
    const region = CITY_REGIONS.find((r) => r.key === cityRegion) || CITY_REGIONS[0];
    const arrived = countArrived(region);
    if (cityMetaEl) {
      // 优先用分钟级实况时间，和地图顶部“实况 HH:MM”对齐；缺失时退回整点序列
      const at = ((cur.data && cur.data.liveAt) || '').replace(' ', 'T') || (cur.data && cur.data.updatedAt) || '';
      const now = new Date();
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const stamp = at ? (at.slice(0, 10) === today ? `实况 ${at.slice(11, 16)}` : `实况 ${at.slice(5, 10).replace('-', '/')} ${at.slice(11, 16)}`) : '';
      cityMetaEl.textContent = `${region.name} ${region.ads.length} 市 · 已抵达 ${arrived} · 待抵达 ${region.ads.length - arrived}${stamp ? ` · ${stamp}` : ''}`;
    }
    cityListEl.innerHTML = region.ads.map((ad) => cityRowHTML(ad, cur)).join('');
  }

  function buildMapOption(layout, empty, narrow) {
    const cur = current();
    const data = GD_CITIES.map((feature) => {
      const short = feature.properties.short;
      const city = cur.cities[String(feature.properties.adcode)];
      const arrived = !!(city && city.status === 'arrived');
      return {
        name: short,
        value: arrived ? 1 : 0,
        itemStyle: { areaColor: empty ? 'rgba(63, 143, 214, .1)' : arrived ? CITY_COLOR : PENDING_COLOR },
      };
    });
    // 港澳只点亮色块、不显示名称，也不出 tooltip
    for (const region of HK_MO_FOLLOW) {
      const adjacent = cur.cities[region.ad];
      const lit = !!(adjacent && adjacent.status === 'arrived');
      data.push({
        name: region.name,
        value: lit ? 1 : 0,
        itemStyle: { areaColor: empty ? 'rgba(63, 143, 214, .1)' : lit ? CITY_COLOR : PENDING_COLOR },
        tooltip: { show: false },
      });
    }

    return {
      animationDuration: 0,
      tooltip: {
        show: !empty,
        trigger: 'item',
        confine: true,
        backgroundColor: 'rgba(255,255,255,.98)',
        borderWidth: 0,
        padding: 0,
        extraCssText: 'box-shadow:0 8px 24px rgba(15,50,70,.18);border-radius:12px;',
        formatter: (p) => (HK_MO_NAMES.has(p.name) ? '' : tooltipHTML(p.name)),
      },
      series: [{
        type: 'map',
        map: MAP_KEY,
        roam: false,
        selectedMode: false,
        aspectScale: 1,
        layoutCenter: layout.center,
        layoutSize: layout.size,
        itemStyle: {
          // 港澳无数据，空状态下也按水印色绘制，避免出现灰色色块
          areaColor: empty ? 'rgba(63, 143, 214, .1)' : PENDING_COLOR,
          borderColor: empty ? 'rgba(63, 143, 214, .16)' : 'rgba(255, 255, 255, .85)',
          borderWidth: 1,
        },
        label: {
          show: !empty,
          // 港澳只保留灰色轮廓；关口站名称随三角关口标记绘制
          formatter: (params) =>
            GATE_NAMES.has(params.name) || HK_MO_NAMES.has(params.name) ? '' : params.name,
          color: '#ffffff',
          fontSize: narrow ? 8.5 : 11,
          fontWeight: 700,
          textBorderColor: 'rgba(0, 0, 0, .45)',
          textBorderWidth: 2,
        },
        labelLayout: { hideOverlap: true },
        emphasis: { disabled: true },
        data,
      }],
    };
  }

  function gateGraphic(inst, narrow) {
    // 空状态下不显示任何关口标记
    if (isEmpty()) return [];
    const scale = narrow ? 0.68 : 1;
    const cur = current();
    const gateNow = cur.gate;
    const graphic = [];
    for (const gate of GATES) {
      if (!gate.center) continue;
      const px = inst.convertToPixel({ seriesIndex: 0 }, gate.center);
      if (!px || !Number.isFinite(px[0]) || !Number.isFinite(px[1])) continue;
      const passed = !!(gateNow[gate.ad] && gateNow[gate.ad].passed);
      // 四站全部达标（过程已开启）时改为橙底白边三角，过程结束再回到未达标样式
      graphic.push({
        type: 'polygon',
        silent: true,
        z: 30,
        shape: {
          points: [[0, -6.5 * scale], [5.6 * scale, 3.8 * scale], [-5.6 * scale, 3.8 * scale]],
        },
        style: cur.active
          ? { fill: '#ffab2e', stroke: '#ffffff', lineWidth: 1.4 }
          : {
              fill: passed ? '#2f6da8' : '#ffffff',
              stroke: passed ? '#ffffff' : '#e08a00',
              lineWidth: 1.2,
            },
        position: px,
      });
      graphic.push({
        type: 'text',
        silent: true,
        z: 31,
        style: {
          text: gate.name,
          fill: '#ffffff',
          stroke: 'rgba(0, 0, 0, .45)',
          lineWidth: 2,
          fontSize: narrow ? 8.5 : 11,
          fontFamily: 'Microsoft YaHei',
          fontWeight: 700,
          textAlign: 'center',
          textVerticalAlign: 'bottom',
        },
        position: [px[0], px[1] - (narrow ? 6 : 8)],
      });
    }
    return graphic;
  }

  function drawGates() {
    chart.setOption({ graphic: gateGraphic(chart, isNarrow()) });
  }

  // ---------- 下载实况图：按桌面端显示尺寸 1:1 出图，各设备输出一致 ----------
  const EXPORT_W = 1050;
  const EXPORT_H = 668; // 1920×840 桌面窗口下地图区的实际显示尺寸（宽高比 1.57）
  const EXPORT_PAD_X = 16; // 蓝色卡片四周留白，圆角轮廓才完整露出来
  const EXPORT_RADIUS = 14;
  const EXPORT_LEGEND_H = 112;
  const EXPORT_OUT_W = EXPORT_W + EXPORT_PAD_X * 2;
  const EXPORT_OUT_H = (EXPORT_OUT_W * EXPORT_H) / EXPORT_W; // 整体仍保持 1.57，只把卡片往外让出一点
  const EXPORT_SCALE = 3840 / EXPORT_OUT_W; // 输出 3840×2442
  let exporting = false;

  function legendStats() {
    const cur = current();
    let arrived = 0;
    for (const feature of GD_CITIES) {
      const city = cur.cities[String(feature.properties.adcode)];
      if (city && city.status === 'arrived') arrived += 1;
    }
    const total = GD_CITIES.length;
    const arrivedPct = total ? Math.round((arrived / total) * 100) : 0;
    return {
      arrived,
      pending: total - arrived,
      gates: GATE_DEFS.filter((g) => cur.gate[g.ad] && cur.gate[g.ad].passed).length,
      arrivedPct,
      pendingPct: total ? 100 - arrivedPct : 0,
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function chartFinished(inst, ms = 1200) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        inst.off('finished', finish);
        resolve();
      };
      inst.on('finished', finish);
      setTimeout(finish, ms);
    });
  }

  function drawExportLegend(ctx, u, stats) {
    const left = 12, top = 12, padX = 9, padY = 6;
    const contentW = 104, rowH = 17, gap = 3;
    const x0 = left + padX;
    const y0 = top + padY;
    ctx.save();
    ctx.shadowColor = 'rgba(20, 60, 80, .1)';
    ctx.shadowBlur = u(8);
    ctx.shadowOffsetY = u(2);
    ctx.fillStyle = 'rgba(255, 255, 255, .88)';
    roundRect(ctx, u(left), u(top), u(contentW + padX * 2), u(EXPORT_LEGEND_H), u(9));
    ctx.fill();
    ctx.restore();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `700 ${u(13)}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    const rows = [
      ['#3f8fd6', 'dot', `已抵达 ${stats.arrived}`],
      ['#9b9b9b', 'dot', `待抵达 ${stats.pending}`],
      ['#ffab2e', 'tri', `南岭关口 ${stats.gates}/4`],
    ];
    rows.forEach(([color, kind, text], i) => {
      const y = y0 + i * (rowH + gap);
      ctx.fillStyle = color;
      if (kind === 'tri') {
        ctx.beginPath();
        ctx.moveTo(u(x0 + 4.5), u(y + 5));
        ctx.lineTo(u(x0), u(y + 12));
        ctx.lineTo(u(x0 + 9), u(y + 12));
        ctx.closePath();
        ctx.fill();
      } else {
        roundRect(ctx, u(x0), u(y + 4.5), u(8), u(8), u(3));
        ctx.fill();
      }
      ctx.fillStyle = '#55707f';
      ctx.fillText(text, u(x0 + (kind === 'tri' ? 13 : 12)), u(y + rowH / 2));
    });

    // 进度条与图例同宽：蓝=已抵达、灰=未抵达，占比 ≥50% 的一段标白字百分比
    const barTop = y0 + 3 * (rowH + gap) + 2;
    const barH = 15;
    ctx.save();
    roundRect(ctx, u(x0), u(barTop), u(contentW), u(barH), u(barH / 2));
    ctx.clip();
    ctx.fillStyle = '#9b9b9b';
    ctx.fillRect(u(x0), u(barTop), u(contentW), u(barH));
    ctx.fillStyle = '#3f8fd6';
    ctx.fillRect(u(x0), u(barTop), u((contentW * stats.arrivedPct) / 100), u(barH));
    ctx.restore();
    ctx.font = `800 ${u(10)}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    if (stats.arrivedPct >= 50) {
      ctx.fillText(`${stats.arrivedPct}%`, u(x0 + (contentW * stats.arrivedPct) / 200), u(barTop + barH / 2));
    }
    if (stats.pendingPct >= 50) {
      ctx.fillText(`${stats.pendingPct}%`, u(x0 + contentW - (contentW * stats.pendingPct) / 200), u(barTop + barH / 2));
    }
    ctx.font = `700 ${u(13)}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    ctx.fillStyle = '#55707f';
    ctx.fillText('冷空气南下进度条', u(x0 + contentW / 2), u(barTop + barH + 3 + 17 / 2));
  }

  function drawExportClock(ctx, u, width) {
    const text = clockText();
    ctx.save();
    ctx.font = `800 ${u(14)}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    const boxW = ctx.measureText(text).width + u(18);
    const boxH = u(28);
    const x = u(width - 14) - boxW;
    const y = u(14);
    ctx.shadowColor = 'rgba(20, 60, 80, .14)';
    ctx.shadowBlur = u(8);
    ctx.shadowOffsetY = u(2);
    ctx.fillStyle = '#fff';
    roundRect(ctx, x, y, boxW, boxH, u(8));
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#16313f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + boxW / 2, y + boxH / 2 + u(0.5));
    ctx.restore();
  }

  function drawExportEmpty(ctx, u, width, height) {
    const size = Math.min(60, Math.max(18, (6.4 * width) / 100));
    ctx.save();
    ctx.font = `800 ${u(size)}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(255, 255, 255, .9)';
    ctx.shadowOffsetY = u(1);
    ctx.fillStyle = '#2263a8';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${u(size * 0.02)}px`;
    ctx.fillText('当前暂无冷空气过程', u(width / 2), u(height / 2));
    ctx.restore();
  }

  async function downloadColdAirMap() {
    if (exporting) return;
    exporting = true;
    if (downloadEl) downloadEl.disabled = true;
    const empty = isEmpty();
    const container = document.createElement('div');
    container.style.cssText = `position:fixed;left:-10000px;top:0;width:${EXPORT_W}px;height:${EXPORT_H}px;`;
    document.body.appendChild(container);
    const inst = echarts.init(container);
    try {
      inst.setOption(buildMapOption(layoutFor(EXPORT_W, EXPORT_H, empty, EXPORT_LEGEND_H), empty, false), true);
      await chartFinished(inst);
      const gates = gateGraphic(inst, false);
      if (gates.length) {
        inst.setOption({ graphic: gates });
        await chartFinished(inst, 400);
      }
      const chartUrl = inst.getDataURL({ type: 'png', pixelRatio: EXPORT_SCALE });
      if (!chartUrl) return;
      const img = await loadImage(chartUrl);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(EXPORT_OUT_W * EXPORT_SCALE);
      canvas.height = Math.round(canvas.width * (EXPORT_OUT_H / EXPORT_OUT_W));
      const ctx = canvas.getContext('2d');
      const u = (v) => v * (img.naturalWidth / EXPORT_W);
      const cardW = u(EXPORT_W);
      const cardH = u(EXPORT_H);
      const ox = (canvas.width - cardW) / 2;
      const oy = (canvas.height - cardH) / 2;
      const radius = u(EXPORT_RADIUS);
      // 先铺白底，蓝色卡片往里收一圈，圆角和描边都完整落在画布内
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      roundRect(ctx, ox, oy, cardW, cardH, radius);
      ctx.clip();
      ctx.translate(ox, oy);
      if (empty) {
        const grad = ctx.createLinearGradient(0, 0, cardW * 0.21, cardH);
        grad.addColorStop(0, '#f7fbff');
        grad.addColorStop(0.56, '#e9f4fd');
        grad.addColorStop(1, '#ddeefb');
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = '#a9cbe8';
      }
      ctx.fillRect(0, 0, cardW, cardH);
      ctx.drawImage(img, 0, 0, cardW, cardH);
      if (empty) drawExportEmpty(ctx, u, EXPORT_W, EXPORT_H);
      else drawExportLegend(ctx, u, legendStats());
      drawExportClock(ctx, u, EXPORT_W);
      ctx.restore();
      ctx.save();
      const line = Math.max(1, u(1));
      roundRect(ctx, ox + line / 2, oy + line / 2, cardW - line, cardH - line, radius);
      ctx.lineWidth = line;
      ctx.strokeStyle = 'rgba(20, 60, 80, .22)';
      ctx.stroke();
      ctx.restore();

      const d = new Date();
      const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `冷空气南下实况-${stamp}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      inst.dispose();
      container.remove();
      exporting = false;
      if (downloadEl) downloadEl.disabled = false;
    }
  }

  function mountStrip(content, speed) {
    stripViewEl.innerHTML = '';
    const track = document.createElement('div');
    track.className = 'cold-strip-track';
    const half = document.createElement('div');
    half.className = 'cold-strip-half';
    half.innerHTML = content;
    track.appendChild(half);
    stripViewEl.appendChild(track);
    requestAnimationFrame(() => {
      if (!half.scrollWidth || half.scrollWidth <= stripViewEl.clientWidth + 4) return;
      const clone = half.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
      track.style.setProperty('--cold-dur', `${Math.max(18, Math.round(half.scrollWidth / speed))}s`);
      track.classList.add('is-scroll');
    });
  }

  let tipIndex = 0;
  let tipTimer = 0;
  let tipMode = false;
  let tipShown = -1;
  let tipWidth = 0;

  function renderTipStrip() {
    const width = stripViewEl ? stripViewEl.clientWidth : 0;
    if (tipShown === tipIndex && tipWidth === width) return;
    tipShown = tipIndex;
    tipWidth = width;
    if (stripTagEl) {
      stripTagEl.textContent = '冷知识';
      stripTagEl.classList.remove('is-arrived');
    }
    mountStrip(`<span class="cold-strip-item is-tip">${TIPS[tipIndex]}</span>`, 16);
  }

  function startTipCycle() {
    if (!tipMode) {
      tipMode = true;
      tipShown = -1;
      tipTimer = setInterval(() => {
        tipIndex = (tipIndex + 1) % TIPS.length;
        renderTipStrip();
      }, TIP_MS);
    }
    renderTipStrip();
  }

  function stopTipCycle() {
    if (!tipMode) return;
    tipMode = false;
    clearInterval(tipTimer);
    tipTimer = 0;
  }

  function renderStatus() {
    const cur = current();
    const isActive = cur.active;
    const event = cur.event;
    const cities = cur.cities;
    const gatePassed = GATE_DEFS.filter((g) => cur.gate[g.ad] && cur.gate[g.ad].passed).length;

    const emptyState = isEmpty();
    if (emptyEl) {
      emptyEl.classList.toggle('is-on', emptyState);
      emptyEl.setAttribute('aria-hidden', emptyState ? 'false' : 'true');
    }
    if (legendEl) {
      legendEl.classList.toggle('is-hidden', emptyState);
      legendEl.setAttribute('aria-hidden', emptyState ? 'true' : 'false');
    }

    if (chipEl) {
      chipEl.className = `feed-chip${isActive ? ' is-active' : ''}`;
      if (!state) chipEl.textContent = '接入中';
      else if (isActive) chipEl.textContent = `进行中 ${hoursBetween(state.updatedAt, event.closesAt)}h`;
      else chipEl.textContent = '监测中';
    }
    if (metaEl) {
      if (!state) {
        metaEl.textContent = '等待首次实况快照 · 每 10 分钟自动更新';
      } else if (isActive) {
        metaEl.textContent = `过程开启 ${fmtTime(event.openedAt)} · 预计 ${fmtTime(event.closesAt)} 关闭`;
      } else {
        const closed = state.closedAt ? `上次过程已于 ${fmtTime(state.closedAt)} 结束 · ` : '';
        metaEl.textContent = `${closed}南岭四站 ${gatePassed}/4 达标 · 等待冷空气主体南下`;
      }
    }

    const arrivedCities = [];
    const pendingCities = [];
    for (const feature of GD_CITIES) {
      const short = feature.properties.short;
      const city = cities[String(feature.properties.adcode)];
      (city && city.status === 'arrived' ? arrivedCities : pendingCities).push(short);
    }

    if (!isActive) {
      // 过程未开启：滚动条不再提示待抵达城市，改为冷空气知识逐条轮播
      startTipCycle();
    } else {
      stopTipCycle();
      if (stripTagEl) {
        stripTagEl.textContent = pendingCities.length ? `待抵达 ${pendingCities.length}` : '全部抵达';
        stripTagEl.classList.toggle('is-arrived', pendingCities.length === 0);
      }
      if (stripViewEl) {
        const list = pendingCities.length ? pendingCities : arrivedCities;
        const html = list
          .map((name) => {
            const city = cityOf(name);
            const arrived = city && city.data && city.data.status === 'arrived';
            return `<span class="cold-strip-item${arrived ? ' is-arrived' : ''}">${dot('')}${name}</span>`;
          })
          .join('');
        mountStrip(list.length ? html : '<span class="cold-strip-item">暂无城市</span>', 26);
      }
    }

    if (legendEl) {
      const total = arrivedCities.length + pendingCities.length;
      const arrivedPct = total ? Math.round((arrivedCities.length / total) * 100) : 0;
      const pendingPct = total ? 100 - arrivedPct : 0;
      // 只有占比 ≥50% 的一段放得下数字，小于一半的不标
      const pctText = (pct) => (pct >= 50 ? `${pct}%` : '');
      legendEl.innerHTML = [
        `<span class="cold-key">${dot('dot is-blue')}已抵达 ${arrivedCities.length}</span>`,
        `<span class="cold-key">${dot('dot is-grey')}待抵达 ${pendingCities.length}</span>`,
        `<span class="cold-key"><i class="tri"></i>南岭关口 ${gatePassed}/4</span>`,
        `<span class="cold-ratio" role="img" aria-label="冷空气南下进度：已抵达 ${arrivedPct}%，待抵达 ${pendingPct}%">`,
        `<i class="cold-ratio-seg is-arrived" style="width:${arrivedPct}%">${pctText(arrivedPct)}</i>`,
        `<i class="cold-ratio-seg is-pending" style="width:${pendingPct}%">${pctText(pendingPct)}</i>`,
        `</span>`,
        `<span class="cold-ratio-label">冷空气南下进度条</span>`,
      ].join('');
    }
  }

  function renderAll() {
    // 先渲染图例（mapLayout 需要图例高度来给上方留白）
    renderStatus();
    renderMap();
    renderCityCard();
  }

  // 测试台通过它切换演示状态，正式页面不调用
  window.COLD_AIR_VIEW = {
    setState(next) {
      state = next || null;
      renderAll();
    },
    getState() {
      return state;
    },
    render: renderAll,
  };

  if (downloadEl) downloadEl.addEventListener('click', downloadColdAirMap);
  if (cityTabsEl) {
    cityTabsEl.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-region]');
      if (!btn || btn.dataset.region === cityRegion) return;
      cityRegion = btn.dataset.region;
      renderCityCard();
      cityListEl.scrollTop = 0;
    });
  }

  renderAll();
  renderClock();
  setInterval(renderClock, 10000);

  // ---------- 城市实况：直连中央气象台，每 10 分钟刷新一次（失败保留上一份数据） ----------
  const LIVE_MS = 10 * 60 * 1000;
  let liveBusy = false;
  let liveAt = 0;
  let enginePromise = null;

  const liveEnabled = () => new URLSearchParams(location.search).get('coldLive') !== '0';

  function loadEngine() {
    if (window.COLD_AIR_ENGINE) return Promise.resolve(window.COLD_AIR_ENGINE);
    if (!enginePromise) {
      enginePromise = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'cold-air-engine.js';
        s.onload = () => resolve(window.COLD_AIR_ENGINE || null);
        s.onerror = () => resolve(null);
        document.body.appendChild(s);
      });
    }
    return enginePromise;
  }

  const numOrNull = (v) => (typeof v === 'number' && v > -999 && v !== 9999 ? v : null);

  async function fetchLiveSeries(code) {
    const res = await fetch(`https://www.nmc.cn/rest/weather?stationid=${encodeURIComponent(code)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    const passed = ((json.data && json.data.passedchart) || []).filter((p) => p && p.time).slice(0, 24);
    const series = passed.map((p) => ({
      t: `${String(p.time).trim().slice(0, 13).replace(' ', 'T')}:00`,
      temp: numOrNull(p.temperature),
      dir: typeof p.windDirection === 'number' && p.windDirection >= 0 && p.windDirection <= 360 ? p.windDirection : null,
      spd: typeof p.windSpeed === 'number' && p.windSpeed >= 0 && p.windSpeed !== 9999 ? p.windSpeed : null,
      rain: typeof p.rain1h === 'number' && p.rain1h >= 0 ? p.rain1h : 0,
    }));
    // real 就是地图顶部显示的那份分钟级观测
    const real = (json.data && json.data.real) || {};
    const weather = real.weather || {};
    const wind = real.wind || {};
    const deg = numOrNull(wind.degree);
    const live = {
      pub: real.publish_time ? String(real.publish_time).trim() : '',
      temp: numOrNull(weather.temperature),
      rain: numOrNull(weather.rain),
      dir: deg != null && deg >= 0 && deg <= 360 ? deg : null,
      dirText: wind.direct && wind.direct !== '9999' ? wind.direct : '',
      power: wind.power && wind.power !== '9999' ? wind.power : '',
      spd: numOrNull(wind.speed),
    };
    return { series, live: live.pub ? live : null };
  }

  async function refreshLive() {
    const base = window.COLD_AIR;
    if (!liveEnabled() || liveBusy || document.hidden || !base || !base.stations || !base.series) return;
    if (Date.now() - liveAt < 60e3) return;
    // 测试台注入演示数据时不要被实况覆盖
    if (window.COLD_AIR_VIEW.getState() !== base) return;
    liveAt = Date.now();
    liveBusy = true;
    try {
      const engine = await loadEngine();
      if (!engine) return;
      const entries = Object.entries(base.stations);
      const fetched = {};
      const live = {};
      let next = 0;
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (next < entries.length) {
          const [ad, code] = entries[next];
          next += 1;
          try {
            const got = await fetchLiveSeries(code);
            if (!got) continue;
            if (got.series.length) fetched[ad] = got.series;
            if (got.live) live[ad] = got.live;
          } catch (e) {
            /* 单站失败沿用旧序列 */
          }
        }
      }));
      if (!Object.keys(fetched).length && !Object.keys(live).length) return;
      if (window.COLD_AIR_VIEW.getState() !== base) return;
      const series = {};
      for (const [ad, old] of Object.entries(base.series)) {
        const map = new Map(old.map((x) => [x.t, x]));
        for (const x of fetched[ad] || []) map.set(x.t, x);
        series[ad] = engine.prune([...map.values()].sort((a, b) => (a.t < b.t ? -1 : 1)));
      }
      const fresh = engine.buildState(series, base);
      // buildState 只回传过程/城市，站点号和分钟实况由这里续上
      fresh.stations = base.stations || {};
      const nextLive = { ...(base.live || {}), ...live };
      let liveAt = '';
      for (const r of Object.values(nextLive)) {
        if (r && r.pub && r.pub > liveAt) liveAt = r.pub;
      }
      fresh.live = nextLive;
      fresh.liveAt = liveAt;
      if (fresh.updatedAt === base.updatedAt && liveAt === (base.liveAt || '')) return;
      window.COLD_AIR = fresh;
      window.COLD_AIR_VIEW.setState(fresh);
    } finally {
      liveBusy = false;
    }
  }

  if (liveEnabled()) {
    setTimeout(refreshLive, 3000);
    setInterval(refreshLive, LIVE_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshLive();
    });
  }

  let raf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      chart.resize();
      renderAll();
    });
  }).observe(el);
})();
