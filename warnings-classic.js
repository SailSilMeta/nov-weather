(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const pageEl = $('#warningClassicPage');
  const listEl = $('#warningClassicList');
  const pagerEl = $('#warningClassicPager');
  const LEVEL_COLORS = { white: '#e6f0f5', blue: '#3b82f6', yellow: '#eab308', orange: '#f97316', red: '#dc2626' };
  const LEVEL_NAMES = { white: '白色', blue: 'Ⅳ级', yellow: 'Ⅲ级', orange: 'Ⅱ级', red: 'Ⅰ级' };
  const state = { open: false, province: '广东省', type: 'all', level: 'all', time: 'all', city: 'all', page: 0 };
  const warningUtils = (window.WarningPage && window.WarningPage.utils) || {
    listPageSize: () => 10,
    clampPage: (page, pages) => Math.max(0, Math.min(Math.max(1, pages) - 1, page)),
    pagerHtml: () => '',
  };
  let chart = null;
  const charts = new Map();
  let provinceTouched = false;
  const registeredMaps = new Set();
  const constants = (window.WarningPage && window.WarningPage.constants) || { PROVINCES: [], PROVINCE_SHORT: {} };
  const MAP_DATA = window.MAP_DATA || { cities: { features: [] }, provinces: [] };
  const PROVINCES = constants.PROVINCES.map((full) => {
    const meta = MAP_DATA.provinces.find((item) => item.full === full) || {};
    return { full, short: meta.name || constants.PROVINCE_SHORT[full] || full, adcode: meta.adcode || null };
  });

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtTime(ts) {
    if (!Number.isFinite(ts)) return '—';
    const iso = new Date(ts + 8 * 3600e3).toISOString();
    return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
  }

  function fmtDateTime(ts) {
    if (!Number.isFinite(ts)) return '—';
    return new Date(ts + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  }

  function warningState() {
    return (window.WarningPage && window.WarningPage.state) || { alerts: [], groups: [], source: '中央气象台', updatedAt: 0, loading: false };
  }

  function provinceInfo(value = state.province) {
    return PROVINCES.find((item) => item.full === value) || null;
  }

  function mapInfo() {
    const info = provinceInfo();
    if (!info) {
      const key = 'wcm-all';
      if (!registeredMaps.has(key) && window.echarts) {
        echarts.registerMap(key, { type: 'FeatureCollection', features: MAP_DATA.cities.features });
        registeredMaps.add(key);
      }
      return { key, features: MAP_DATA.cities.features, info: null };
    }
    const key = `wcm-${info.adcode}`;
    const features = MAP_DATA.cities.features.filter((feature) => feature.properties.provinceAdcode === info.adcode);
    if (!registeredMaps.has(key) && window.echarts) {
      echarts.registerMap(key, { type: 'FeatureCollection', features });
      registeredMaps.add(key);
    }
    return { key, features, info };
  }

  function cityKey(alert, features) {
    const place = String(alert.place || '');
    const hit = features.find((feature) => {
      const props = feature.properties;
      return place.includes(props.name) || place.includes(props.short);
    });
    return hit ? hit.properties.short : place.split(' · ')[0].trim();
  }

  function timeAlerts(alerts) {
    const hours = { '1h': 1, '6h': 6, '24h': 24, '72h': 72 }[state.time];
    if (!hours) return alerts;
    const cutoff = Date.now() - hours * 3600e3;
    return alerts.filter((alert) => alert.ts >= cutoff);
  }

  function baseAlerts(alerts) {
    return timeAlerts(alerts)
      .filter((alert) => state.province === 'all' || alert.province === state.province)
      .filter((alert) => state.type === 'all' || alert.typeKey === state.type)
      .filter((alert) => state.level === 'all' || alert.levelKey === state.level);
  }

  function rowHtml(alert, features) {
    const color = LEVEL_COLORS[alert.levelKey] || LEVEL_COLORS.blue;
    const icon = window.WarningPage && window.WarningPage.iconSvg ? window.WarningPage.iconSvg(alert.icon) : '';
    return `<button class="wcv-row" type="button" data-warning-id="${esc(alert.id)}" style="--lv:${color};--tone:${esc(alert.tone)}" aria-label="${esc(alert.place)}，${esc(alert.levelLabel)}预警，查看详情">
      <span class="wcv-icon">${icon}</span>
      <span class="wcv-main"><b>${esc(alert.place)}</b><small>${esc(alert.typeName)} · ${esc(alert.levelLabel)}预警 · ${esc(alert.levelGrade)}</small></span>
      <span class="wcv-time">${esc(fmtTime(alert.ts))}<small>${esc(cityKey(alert, features))}</small></span>
      <span class="wcv-arrow" aria-hidden="true">›</span>
    </button>`;
  }

  function ensureChart() {
    if (chart || !window.echarts) return chart;
    const el = $('#warningClassicMap');
    if (!el) return null;
    chart = echarts.init(el);
    chart.on('click', (params) => {
      const key = params.data && params.data.cityKey;
      if (!key || !params.data.value) return;
      state.city = state.city === key ? 'all' : key;
      render();
    });
    return chart;
  }

  function renderMap(alerts, features) {
    ensureChart();
    if (!chart) return;
    const base = baseAlerts(alerts);
    const byCity = new Map();
    for (const alert of base) {
      const city = cityKey(alert, features);
      if (!byCity.has(city)) byCity.set(city, []);
      byCity.get(city).push(alert);
    }
    const showAllLabels = Boolean(provinceInfo());
    const data = features.map((feature) => {
      const props = feature.properties;
      const rows = (byCity.get(props.short) || []).slice().sort((a, b) => b.levelRank - a.levelRank);
      const top = rows[0];
      const color = top ? LEVEL_COLORS[top.levelKey] : null;
      const selected = state.city === props.short;
      const showLabel = showAllLabels || Boolean(top);
      return {
        name: props.name,
        value: rows.length,
        cityKey: props.short,
        level: top ? top.levelKey : '',
        levelName: top ? top.levelLabel : '',
        itemStyle: {
          areaColor: color || '#edf5f8',
          borderColor: selected ? '#14303f' : color ? 'rgba(255,255,255,.82)' : '#b9cfdb',
          borderWidth: selected ? 2 : color ? 1 : 0.7,
        },
        label: {
          show: showLabel,
          formatter: props.short,
          color: color ? (top.levelKey === 'yellow' || top.levelKey === 'white' ? '#3b2b00' : '#ffffff') : '#607b89',
          fontWeight: top ? 700 : 500,
          textBorderColor: color ? 'rgba(0,0,0,.3)' : '#ffffff',
          textBorderWidth: 2,
        },
      };
    });
    $('#warningClassicMapEmpty').hidden = data.some((item) => item.value > 0);
    chart.setOption({
      animationDuration: 0,
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(21,45,61,.94)',
        borderWidth: 0,
        padding: [8, 10],
        textStyle: { color: '#f4fbff', fontSize: 12 },
        formatter: (params) => {
          const item = params.data;
          if (!item) return esc(params.name);
          return `<b>${esc(item.name)}</b><br>${item.value} 条预警${item.value ? ` · 最高 ${esc(item.levelName)}预警` : ' · 暂无生效预警'}`;
        },
      },
      series: [{
        type: 'map',
        map: mapInfo().key,
        roam: false,
        selectedMode: false,
        layoutCenter: ['50%', '50%'],
        layoutSize: '96%',
        itemStyle: { areaColor: '#edf5f8', borderColor: '#b9cfdb', borderWidth: 0.7 },
        label: { show: true, fontSize: window.innerWidth <= 860 ? 9.5 : 11, fontFamily: 'inherit' },
        labelLayout: { hideOverlap: true },
        emphasis: { itemStyle: { areaColor: '#dcecf5' }, label: { show: true, fontWeight: 800 } },
        data,
      }],
    }, true);
    setTimeout(() => chart && chart.resize(), 30);
  }

  function renderLegend(alerts) {
    const counts = { red: 0, orange: 0, yellow: 0, blue: 0 };
    const base = baseAlerts(alerts);
    for (const alert of base) if (counts[alert.levelKey] != null) counts[alert.levelKey]++;
    const total = base.length;
    $('#warningClassicLegend').innerHTML = ['red', 'orange', 'yellow', 'blue'].map((level) => `<span class="wcm-legend-item"><i style="--c:${LEVEL_COLORS[level]}"></i>${LEVEL_NAMES[level]}<b>${counts[level]}</b></span>`).join('') + `<span class="wcm-legend-total">共 <b>${total}</b> 条</span>`;
  }

  function chartFor(id) {
    if (!window.echarts) return null;
    const el = document.getElementById(id);
    if (!el) return null;
    let instance = charts.get(id);
    if (!instance) {
      instance = echarts.init(el);
      charts.set(id, instance);
    }
    return instance;
  }

  function barLimit(instance) {
    const height = (instance && instance.getHeight()) || (instance && instance.getDom().clientHeight) || 300;
    return height >= 300 ? 10 : height >= 180 ? 8 : 6;
  }

  function barOption(entries, colors, label, limit) {
    const top = entries.slice(0, limit).reverse();
    const max = top.length ? Math.ceil(top[top.length - 1][1] * 1.16) : 1;
    return {
      animationDuration: 320,
      grid: { left: 4, right: 30, top: 6, bottom: 2, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => `${params[0].name}：${params[0].value} ${label}` },
      xAxis: { type: 'value', show: false, max },
      yAxis: {
        type: 'category', data: top.map((item) => item[0]),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#5d7482', fontSize: 10, width: 76, overflow: 'truncate' },
      },
      series: [{
        type: 'bar', barWidth: 9,
        data: top.map(([name, value]) => ({
          value,
          itemStyle: { color: colors(name), borderRadius: [0, 5, 5, 0] },
        })),
        label: { show: true, position: 'right', fontSize: 10, color: '#376479' },
      }],
    };
  }

  function renderLevelChart(rows) {
    document.getElementById('warningClassicLevelTotal').textContent = `${rows.length} 条`;
    const instance = chartFor('warningClassicLevelChart');
    if (!instance) return;
    const order = ['red', 'orange', 'yellow', 'blue', 'white'];
    const data = order
      .map((key) => ({ key, level: LEVEL_NAMES[key], value: rows.filter((alert) => alert.levelKey === key).length }))
      .filter((item) => item.value)
      .map((item) => ({ value: item.value, name: item.level, itemStyle: { color: LEVEL_COLORS[item.key] } }));
    instance.setOption({
      animationDuration: 320,
      title: {
        text: String(rows.length), subtext: '条预警', left: 'center', top: '40%',
        textStyle: { color: '#14303f', fontSize: 20, fontWeight: 800 },
        subtextStyle: { color: '#7d919d', fontSize: 9 },
      },
      tooltip: { trigger: 'item', formatter: '{b}：{c} 条（{d}%）' },
      series: [{
        type: 'pie', radius: ['50%', '68%'], center: ['50%', '54%'],
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { show: true, fontSize: 10, color: '#5d7482', formatter: '{b} {c}' },
        labelLine: { length: 5, length2: 5, lineStyle: { color: '#c9dbe6' } },
        data,
      }],
    }, true);
  }

  function renderTypeChart(rows) {
    const counts = new Map();
    const tones = new Map();
    for (const alert of rows) {
      counts.set(alert.typeName, (counts.get(alert.typeName) || 0) + 1);
      if (!tones.has(alert.typeName)) tones.set(alert.typeName, alert.tone || '#2f6fa8');
    }
    document.getElementById('warningClassicTypeTotal').textContent = counts.size ? `${counts.size} 类` : '—';
    const instance = chartFor('warningClassicTypeChart');
    if (!instance) return;
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    instance.setOption(barOption(entries, (name) => tones.get(name) || '#2f6fa8', '条', barLimit(instance)), true);
  }

  function renderCityChart(rows, features) {
    const counts = new Map();
    for (const alert of rows) {
      const city = cityKey(alert, features);
      counts.set(city, (counts.get(city) || 0) + 1);
    }
    document.getElementById('warningClassicCityTotal').textContent = counts.size ? `${counts.size} 个` : '—';
    const instance = chartFor('warningClassicCityChart');
    if (!instance) return;
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    instance.setOption(barOption(entries, () => '#2f7fb6', '条', barLimit(instance)), true);
  }

  function trendBuckets(rows) {
    const now = Date.now();
    const shift = 8 * 3600e3;
    const recent = rows.some((alert) => alert.ts >= now - 36 * 3600e3);
    const step = recent ? 3600e3 : 86400e3;
    const count = recent ? 24 : 10;
    const edge = Math.floor((now + shift) / step) * step - shift;
    const labels = [];
    const values = [];
    for (let i = count - 1; i >= 0; i--) {
      const start = edge - i * step;
      labels.push(recent ? new Date(start + shift).toISOString().slice(11, 16) : new Date(start + shift).toISOString().slice(5, 10));
      values.push(0);
    }
    for (const alert of rows) {
      const index = count - 1 - Math.floor((edge - alert.ts) / step);
      if (index >= 0 && index < count) values[index] += 1;
    }
    return { labels, values, recent, title: recent ? '近 24 小时发布趋势' : '近 10 天发布趋势' };
  }

  function renderTrendChart(rows) {
    const instance = chartFor('warningClassicTrendChart');
    const trend = trendBuckets(rows);
    document.getElementById('warningClassicTrendTitle').textContent = trend.title;
    document.getElementById('warningClassicTrendTotal').textContent = `${rows.length} 条`;
    if (!instance) return;
    instance.setOption({
      animationDuration: 320,
      grid: { left: 4, right: 10, top: 12, bottom: 2, containLabel: true },
      tooltip: { trigger: 'axis', formatter: (params) => `${params[0].name}：${params[0].value} 条` },
      xAxis: {
        type: 'category', boundaryGap: false, data: trend.labels,
        axisLine: { lineStyle: { color: '#dbe9f0' } }, axisTick: { show: false },
        axisLabel: { color: '#7d919d', fontSize: 9, interval: trend.recent ? 3 : 0 },
      },
      yAxis: {
        type: 'value', minInterval: 1,
        splitLine: { lineStyle: { color: '#eef5f9' } },
        axisLabel: { color: '#7d919d', fontSize: 9 },
      },
      series: [{
        type: 'line', smooth: true, symbol: 'none', data: trend.values,
        lineStyle: { width: 2, color: '#2f7fb6' },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: 'rgba(47, 127, 182, .28)' }, { offset: 1, color: 'rgba(47, 127, 182, .02)' }],
          },
        },
      }],
    }, true);
  }

  function renderAnalytics(rows, features) {
    renderLevelChart(rows);
    renderTypeChart(rows);
    renderCityChart(rows, features);
    renderTrendChart(rows);
  }

  function render() {
    if (!state.open) return;
    const snap = warningState();
    const alerts = Array.isArray(snap.alerts) ? snap.alerts : [];
    const groups = Array.isArray(snap.groups) ? snap.groups : [];
    if (!provinceTouched && alerts.length && !alerts.some((alert) => alert.province === state.province)) state.province = 'all';
    const features = mapInfo().features;
    const activeGroups = groups.filter((group) => group.alerts.length);
    if (state.type !== 'all' && !activeGroups.some((group) => group.key === state.type)) state.type = 'all';

    const typeSelect = $('#warningClassicType');
    typeSelect.innerHTML = `<option value="all">全部类型</option>${activeGroups.map((group) => `<option value="${esc(group.key)}">${esc(group.name)}（${group.alerts.length}）</option>`).join('')}`;
    typeSelect.value = state.type;
    const provinceOptions = '<option value="all">全部五省</option>' + PROVINCES.map((item) => `<option value="${esc(item.full)}">${esc(item.short)}</option>`).join('');
    $('#warningClassicProvince').innerHTML = provinceOptions;
    $('#warningClassicProvince').value = state.province;
    $('#warningClassicProvinceRight').innerHTML = provinceOptions;
    $('#warningClassicProvinceRight').value = state.province;
    $('#warningClassicTime').value = state.time;
    document.querySelectorAll('#warningClassicColors [data-level]').forEach((button) => {
      const active = button.dataset.level === state.level;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    const cityInfo = provinceInfo();
    const availableCities = cityInfo
      ? features.map((feature) => feature.properties.short)
      : PROVINCES.flatMap((province) => features.filter((feature) => feature.properties.provinceAdcode === province.adcode).map((feature) => feature.properties.short));
    if (state.city !== 'all' && !availableCities.includes(state.city)) state.city = 'all';
    let cityOptions = '<option value="all">全部地级市</option>';
    if (cityInfo) {
      cityOptions += availableCities.slice().sort((a, b) => a.localeCompare(b, 'zh')).map((city) => `<option value="${esc(city)}">${esc(city)}</option>`).join('');
    } else {
      cityOptions += PROVINCES.map((province) => {
        const list = features.filter((feature) => feature.properties.provinceAdcode === province.adcode).map((feature) => feature.properties.short).sort((a, b) => a.localeCompare(b, 'zh'));
        return list.length ? `<optgroup label="${esc(province.short)}">${list.map((city) => `<option value="${esc(city)}">${esc(city)}</option>`).join('')}</optgroup>` : '';
      }).join('');
    }
    $('#warningClassicCity').innerHTML = cityOptions;
    $('#warningClassicCity').value = state.city;

    const base = baseAlerts(alerts);
    const rows = base
      .filter((alert) => state.city === 'all' || cityKey(alert, features) === state.city)
      .sort((a, b) => (b.ts - a.ts) || (b.levelRank - a.levelRank));
    $('#warningClassicCount').textContent = `${rows.length} 条`;
    $('#warningClassicUpdated').textContent = snap.updatedAt ? `更新 ${fmtDateTime(snap.updatedAt)}` : '连接中…';
    $('#warningClassicSource').textContent = `${snap.source || '中央气象台'} · 按城市最高等级着色`;
    const refresh = $('#warningClassicRefresh');
    refresh.disabled = Boolean(snap.loading);
    refresh.textContent = snap.loading ? '刷新中…' : '刷新';

    const size = window.innerWidth > 860 ? 8 : warningUtils.listPageSize();
    const pages = Math.max(1, Math.ceil(rows.length / size));
    state.page = warningUtils.clampPage(state.page, pages);
    const shown = rows.slice(state.page * size, state.page * size + size);
    if (snap.loading && !alerts.length) {
      listEl.innerHTML = '<div class="wcv-loading">正在读取全国预警…</div>';
    } else if (!rows.length) {
      listEl.innerHTML = '<div class="wcv-empty">当前筛选条件下暂无生效预警。<br>可调整省份、类型、时间或颜色，或点击右上角刷新。</div>';
    } else {
      listEl.innerHTML = shown.map((alert) => rowHtml(alert, features)).join('');
    }
    pagerEl.innerHTML = rows.length
      ? warningUtils.pagerHtml({
        pages,
        page: state.page,
        kind: 'classic',
        label: '预警明细分页',
        light: true,
        info: `${state.page * size + 1}–${state.page * size + shown.length} / ${rows.length}`,
      })
      : '';
    renderMap(alerts, features);
    renderLegend(alerts);
    renderAnalytics(rows, features);
  }

  function open() {
    if (state.open) return;
    state.open = true;
    try { localStorage.setItem('qxksh.warningView', 'classic'); } catch (e) { /* ignore */ }
    pageEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('warning-classic-open');
    render();
    if (window.WarningPage) window.WarningPage.ensureData(false);
    setTimeout(resizeCharts, 80);
    setTimeout(resizeCharts, 260);
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    pageEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('warning-classic-open');
    if (window.WarningPage && window.WarningPage.closeSheet) window.WarningPage.closeSheet();
  }

  $('#warningClassicBack').addEventListener('click', () => { location.hash = '#/center'; });
  $('#warningClassicRefresh').addEventListener('click', () => {
    if (window.WarningPage) window.WarningPage.ensureData(true);
    render();
  });
  function setProvince(value) {
    provinceTouched = true;
    state.province = value;
    state.city = 'all';
    state.page = 0;
    render();
  }
  $('#warningClassicProvince').addEventListener('change', (event) => setProvince(event.target.value));
  $('#warningClassicProvinceRight').addEventListener('change', (event) => setProvince(event.target.value));
  $('#warningClassicType').addEventListener('change', (event) => {
    state.type = event.target.value;
    state.page = 0;
    render();
  });
  $('#warningClassicTime').addEventListener('change', (event) => {
    state.time = event.target.value;
    state.page = 0;
    render();
  });
  $('#warningClassicCity').addEventListener('change', (event) => {
    state.city = event.target.value;
    state.page = 0;
    render();
  });
  $('#warningClassicColors').addEventListener('click', (event) => {
    const button = event.target.closest('[data-level]');
    if (!button) return;
    state.level = button.dataset.level;
    state.page = 0;
    render();
  });
  pagerEl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-page]');
    if (!button || button.disabled) return;
    const pages = Number(pagerEl.querySelector('.wx-pager') && pagerEl.querySelector('.wx-pager').dataset.pages) || 1;
    const raw = button.dataset.page;
    const target = raw === 'prev' ? state.page - 1 : raw === 'next' ? state.page + 1 : Number(raw);
    const page = warningUtils.clampPage(target, pages);
    if (page === state.page) return;
    state.page = page;
    render();
    const active = pagerEl.querySelector('button[aria-current="page"]');
    if (active) active.focus({ preventScroll: true });
  });
  listEl.addEventListener('click', (event) => {
    const row = event.target.closest('.wcv-row[data-warning-id]');
    if (!row || !window.WarningPage) return;
    const alert = warningState().alerts.find((item) => item.id === row.dataset.warningId);
    if (alert) window.WarningPage.openSheet(alert);
  });
  function resizeCharts() {
    if (chart) chart.resize();
    charts.forEach((instance) => instance.resize());
  }
  let layoutTimer = null;
  document.addEventListener('warnings:update', render);
  window.addEventListener('resize', () => {
    if (!state.open) return;
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      resizeCharts();
      render();
    }, 180);
  });

  window.WarningClassicPage = { open, close, render, state };
})();
