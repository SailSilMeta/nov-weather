(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const page = $('#typhoonProPage');
  const LEVEL_COLORS = { 6: '#c026d3', 5: '#ef4444', 4: '#f97316', 3: '#eab308', 2: '#22c55e', 1: '#38bdf8' };
  const AGENCY_COLORS = { 中国: '#e23b46', 中国台湾: '#a855f7', 日本: '#2563eb', 美国: '#0f9f88', 中国香港: '#d97706', 韩国: '#64748b' };

  const state = {
    open: false,
    map: null,
    stormId: null,
    gridOn: false,
    trackLayer: null,
    measureLayer: null,
    measuring: false,
    measurePts: [],
    toolsHidden: false,
    panelCollapsed: false,
    coord: null,
    copyTimer: null,
    theme: 'dark',
    showForecast: true,
    showWind: false,
    windFill: true,
    follow: true,
    windLayer: null,
    cardMode: null,
    copy: 0,
    baseLayer: null,
    forecastAgencies: null,
    forecastKnown: new Set(),
    forecastStormId: null,
    windStormId: null,
    base: 'vec',
    satLayer: null,
    // 路径点的点击命中范围：点本身只有 4px，靠地图点击就近吸附
    hitPoints: [],
  };

  function tp() {
    return window.TyphoonPage ? window.TyphoonPage.state : null;
  }

  function strengthColor(point) {
    const speed = point && point.speed;
    if (speed == null) return '#8ca3b4';
    if (speed >= 51) return LEVEL_COLORS[6];
    if (speed >= 41.5) return LEVEL_COLORS[5];
    if (speed >= 32.7) return LEVEL_COLORS[4];
    if (speed >= 24.5) return LEVEL_COLORS[3];
    if (speed >= 17.2) return LEVEL_COLORS[2];
    return LEVEL_COLORS[1];
  }

  function bjTime(ts) {
    if (!Number.isFinite(ts)) return '—';
    const iso = new Date(ts + 8 * 3600e3).toISOString();
    return `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日 ${Number(iso.slice(11, 13))}时`;
  }

  function hourLabel(ts) {
    if (!Number.isFinite(ts)) return '';
    return `${Number(new Date(ts + 8 * 3600e3).toISOString().slice(11, 13))}时`;
  }

  function unitValue(value, unit) {
    if (value == null) return '—';
    return `${value}<small>${unit}</small>`;
  }

  function labelIcon(html, className, anchor, size) {
    return L.divIcon({ className, html, iconSize: size || [1, 1], iconAnchor: anchor || [0, 0] });
  }

  function coord(point) {
    const s = tp();
    if (s && typeof s.project === 'function') {
      const [lon, lat] = s.project(point.lon, point.lat);
      return [lat, lon];
    }
    return [point.lat, point.lon];
  }

  function renderPanel() {
    const s = tp();
    const storm = s && s.storm;
    const points = (s && s.points) || [];
    const point = points[s ? s.selected : 0] || points[points.length - 1];
    const number = storm && storm.number ? String(storm.number) : '';
    const listEntry = storm ? ((tp() && tp().list) || []).find((item) => item.id === storm.id) : null;
    const unnamed = isUnnamedStorm(storm) || isUnnamedStorm(listEntry);
    $('#tppNumber').textContent = unnamed ? '' : ((number.length > 4 ? number.slice(-4) : number) || '—');
    $('#tppNumber').hidden = unnamed;
    $('#tppName').textContent = storm ? stormTitle(storm) : '—';
    const enname = storm && storm.enname && !/^nameless$/i.test(storm.enname) && !isUnnamedStorm(storm) ? `(${storm.enname.toUpperCase()})` : '';
    $('#tppEnname').textContent = enname;
    $('#tppEnname').hidden = !enname;
    $('#tppTime').textContent = point ? `实况日期：${bjTime(point.ts)}（BJT）` : '实况日期：—（BJT）';
    if (point) {
      $('#tppPos').textContent = `${point.lat.toFixed(1)}°N ${point.lon.toFixed(1)}°E`;
      $('#tppStrong').textContent = point.strong || '—';
      $('#tppSpeed').innerHTML = unitValue(point.speed, 'm/s');
      $('#tppPressure').innerHTML = unitValue(point.pressure, 'hPa');
      const rawDirection = point.direction || '';
      $('#tppDirection').textContent = /^no$/i.test(rawDirection) ? '少动' : (rawDirection || '—');
      $('#tppMove').innerHTML = unitValue(point.moveSpeed, 'km/h');
    } else {
      ['tppPos', 'tppStrong', 'tppSpeed', 'tppPressure', 'tppDirection', 'tppMove']
        .forEach((id) => { $('#' + id).textContent = '—'; });
    }
    const source = storm ? (storm.source === 'zj' ? '浙江省水利厅' : '中央气象台') : '中央气象台';
    const snapshot = s && s.detailMeta && s.detailMeta.mode === 'snapshot' ? '（离线快照）' : '';
    $('#tppSource').textContent = `实况信息来源：${source}${snapshot}`;

    const message = $('#tppMessage');
    if (storm && points.length) {
      message.hidden = true;
    } else {
      message.hidden = false;
      const fallback = $('#tpMapMessage');
      message.textContent = (fallback && fallback.textContent.trim()) || '正在读取台风数据…';
    }
  }

  function fitStorm() {
    const s = tp();
    if (!state.map || !s || !s.points.length) return;
    state.map.fitBounds(L.latLngBounds(s.points.map(coord)), { padding: [70, 70], maxZoom: 4, animate: false });
    const zoom = Math.round(state.map.getZoom());
    if (zoom > 2) state.map.setMinZoom(zoom);
  }

  function worldOffsets() {
    const copy = state.map ? Math.round(state.map.getCenter().lng / 360) * 360 : 0;
    return [copy - 360, copy, copy + 360];
  }

  function windVertex(lat, lon, km, bearing) {
    const rad = Math.PI / 180;
    const distance = km / 6371;
    const phi = lat * rad;
    const lambda = lon * rad;
    const angle = bearing * rad;
    const phi2 = Math.asin(Math.sin(phi) * Math.cos(distance) + Math.cos(phi) * Math.sin(distance) * Math.cos(angle));
    const lambda2 = lambda + Math.atan2(Math.sin(angle) * Math.sin(distance) * Math.cos(phi), Math.cos(distance) - Math.sin(phi) * Math.sin(phi2));
    return [phi2 / rad, ((lambda2 / rad + 540) % 360) - 180];
  }

  function windPolygon(point, radii) {
    const s = tp();
    const polygon = [];
    radii.forEach((km, quadrant) => {
      for (let angle = quadrant * 90; angle <= quadrant * 90 + 90; angle += 5) {
        const [lat, lon] = windVertex(point.lat, point.lon, km, angle);
        const [px, py] = s && typeof s.project === 'function' ? s.project(lon, lat) : [lon, lat];
        polygon.push([py, px]);
      }
    });
    return polygon;
  }

  function windPalette() {
    return state.theme === 'light'
      ? [[7, '#f2d21b', '#fbf3a8'], [10, '#e8413b', '#f47b73'], [12, '#b44bd6', '#d191e6']]
      : [[7, '#f0e000', '#6f6a00'], [10, '#ff4d4d', '#8c1c1c'], [12, '#d35cff', '#7a2bb5']];
  }

  function updateWindLegendColors() {
    const items = document.querySelectorAll('#tppWindLegend i');
    const palette = windPalette();
    items.forEach((item, index) => {
      const entry = palette[index];
      if (entry) item.style.setProperty('--c', entry[1]);
    });
  }

  function syncWindControls() {
    const wind = document.querySelector('#tppOptWind');
    if (wind) wind.checked = state.showWind;
    const fill = document.querySelector('#tppOptFill');
    if (fill) {
      fill.disabled = !state.showWind;
      const row = fill.closest('.tpp-check-row');
      if (row) row.classList.toggle('is-disabled', !state.showWind);
    }
  }

  function syncCrossScale() {
    if (!state.map) return;
    let size = 17.4;
    const s = tp();
    const storm = s && s.storm;
    const point = s && s.points[s.points.length - 1];
    const wind = storm && storm.active && point ? point.wind : null;
    const radii = wind ? (wind[12] || wind[10] || wind[7]) : null;
    const spans = radii ? radii.filter((n) => n > 0) : [];
    const km = spans.length ? Math.min(...spans) : 0;
    if (km > 0) {
      const mpp = (40075016.686 / (256 * 2 ** state.map.getMinZoom())) * Math.cos((point.lat * Math.PI) / 180);
      size = Math.max(6, (km * 2000) / mpp);
    }
    page.style.setProperty('--tpp-x-size', `${size.toFixed(1)}px`);
  }

  function bjClock(ts) {
    if (!Number.isFinite(ts)) return '—';
    const iso = new Date(ts + 8 * 3600e3).toISOString();
    return `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日 ${iso.slice(11, 16)}（BJT）`;
  }

  function xCard(point) {
    const wind = point.wind || {};
    const levels = [7, 10, 12].filter((level) => Array.isArray(wind[level]));
    const rows = levels.map((level) => {
      const radii = wind[level];
      const cell = (index) => (radii[index] > 0 ? radii[index] : '—');
      return `<tr><th>${level}级</th><td>${cell(0)}</td><td>${cell(3)}</td><td>${cell(2)}</td><td>${cell(1)}</td></tr>`;
    }).join('');
    const direction = /^no$/i.test(point.direction || '') ? '少动' : (point.direction || '—');
    const withUnit = (value, unit) => (value == null ? '—' : `${value} ${unit}`);
    const row = (key, value) => `<div><dt>${key}</dt><dd>${value}</dd></div>`;
    return `<div class="tpp-x-card">
      <h4>实况</h4>
      <dl>
        ${row('时间', bjClock(point.ts))}
        ${row('位置', `${point.lat.toFixed(1)}°N, ${point.lon.toFixed(1)}°E`)}
        ${row('气压', withUnit(point.pressure, 'hPa'))}
        ${row('风速', withUnit(point.speed, 'm/s'))}
        ${row('移向', esc(direction))}
        ${row('移速', withUnit(point.moveSpeed, 'km/h'))}
      </dl>
      ${rows ? `<h4>风圈信息 <em>(km)</em></h4>
      <table>
        <thead><tr><th>象限</th><th>东北↗</th><th>西北↖</th><th>西南↙</th><th>东南↘</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : ''}
    </div>`;
  }

  function renderWind() {
    if (!state.windLayer) return;
    syncCrossScale();
    state.windLayer.clearLayers();
    const legend = $('#tppWindLegend');
    if (legend) legend.hidden = true;
    const s = tp();
    if (!s || !s.points.length || !state.showWind) return;
    const point = s.points[s.points.length - 1];
    const [lat, lon] = coord(point);
    windPalette().forEach(([level, stroke, fill]) => {
      const radii = point.wind && point.wind[level];
      if (!radii || !radii.length) return;
      const polygon = windPolygon(point, radii);
      worldOffsets().forEach((offset) => {
        const shape = L.polygon(polygon.map(([lat, lon]) => [lat, lon + offset]), {
          pane: 'tppWindPane',
          color: stroke, weight: 2, opacity: 1, className: 'tpp-wind-circle',
          fillColor: fill, fillOpacity: state.windFill ? .62 : .001, interactive: true,
        }).addTo(state.windLayer);
        shape.bindTooltip(`${level}级风圈`, { className: 'tpp-wind-tip', direction: 'top', sticky: true });
        const highlight = (on) => {
          const el = shape.getElement();
          if (el) el.classList.toggle('is-strong', on);
        };
        shape.on('mouseover', () => highlight(true));
        shape.on('mouseout', () => highlight(false));
        shape.on('click', (event) => {
          if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
          highlight(true);
          shape.openTooltip(event.latlng);
        });
        shape.on('tooltipclose', () => highlight(false));
      });
    });
    if (legend) legend.hidden = false;
  }

  function renderTrack() {
    const s = tp();
    if (!state.trackLayer) return;
    state.trackLayer.clearLayers();
    state.hitPoints = [];
    if (!s || !s.storm || !s.points.length) {
      state.stormId = null;
      if (state.windLayer) state.windLayer.clearLayers();
      return;
    }
    const points = s.points;
    const latest = points[points.length - 1];
    const base = points.map(coord);
    const offsets = worldOffsets();
    offsets.forEach((offset) => {
      base.forEach(([lat, lon], index) => state.hitPoints.push({ index, lat, lng: lon + offset }));
    });

    if (state.windStormId !== s.storm.id) {
      state.windStormId = s.storm.id;
      state.showWind = Boolean(s.storm.active);
      syncWindControls();
    }
    if (state.forecastStormId !== s.storm.id) {
      state.forecastStormId = s.storm.id;
      state.forecastAgencies = defaultAgencySet(s.storm);
      state.forecastKnown = new Set((s.forecasts || []).map((forecast) => forecast.name));
      if (state.cardMode === 'options') refreshForecastAgencies();
    }
    const selected = selectedAgencies();
    for (const forecast of s.forecasts || []) {
      if (state.forecastKnown.has(forecast.name)) continue;
      state.forecastKnown.add(forecast.name);
      if (s.storm.active || forecast.name === '中国') selected.add(forecast.name);
    }

    offsets.forEach((offset) => {
      L.polyline(base.map(([lat, lon]) => [lat, lon + offset]), {
        color: 'rgba(126, 180, 214, .55)', weight: 2, interactive: false,
      }).addTo(state.trackLayer);
    });

    if (state.showForecast) {
      (s.forecasts || []).forEach((forecast, forecastIndex) => {
        if (!selected.has(forecast.name)) return;
        const forecastPoints = (forecast.points || []).map(coord);
        if (forecastPoints.length < 2) return;
        const color = AGENCY_COLORS[forecast.name] || '#9fb4c4';
        const last = forecastPoints[forecastPoints.length - 1];
        offsets.forEach((offset) => {
          L.polyline([coord(latest), ...forecastPoints].map(([lat, lon]) => [lat, lon + offset]), {
            color, weight: 1.6, dashArray: '6 6', opacity: .85, interactive: false,
          }).addTo(state.trackLayer);
          forecastPoints.forEach(([lat, lon]) => {
            L.circleMarker([lat, lon + offset], {
              radius: 3, color, weight: 1.2, fillColor: '#fff', fillOpacity: .95, interactive: false,
            }).addTo(state.trackLayer);
          });
          L.marker([last[0], last[1] + offset], {
            icon: labelIcon(`<span style="--c:${color}">${esc(forecast.name)}预报</span>`, 'tpp-forecast-label', [-8, 12 + (forecastIndex % 5) * 15]),
            interactive: false,
            keyboard: false,
          }).addTo(state.trackLayer);
        });
      });
    }

    offsets.forEach((offset) => {
      const latestIndex = points.length - 1;
      points.forEach((point, index) => {
        if (index === latestIndex) return;
        const [lat, lon] = base[index];
        const dot = L.circleMarker([lat, lon + offset], {
          radius: index === s.selected ? 7 : 4,
          color: '#06121f',
          weight: 1.2,
          fillColor: strengthColor(point),
          fillOpacity: 1,
        }).on('click', (event) => {
          // 测距时点击交给地图处理，不抢占选点
          if (state.measuring) return;
          if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
          if (window.TyphoonPage) window.TyphoonPage.selectPoint(index);
        });
        // 悬停任意路径点都给出该时次的实况卡片
        dot.bindTooltip(xCard(point), {
          direction: 'auto', offset: [0, -6], opacity: 1, className: 'tpp-x-tip',
        });
        dot.addTo(state.trackLayer);
      });
      const current = base[latestIndex];
      if (current) {
        const mark = L.marker([current[0], current[1] + offset], {
          icon: labelIcon(`<span class="tpp-current-x"><svg viewBox="0 0 26 26" aria-hidden="true"><path class="tpp-x-outline" d="M3.4 3.4 22.6 22.6M22.6 3.4 3.4 22.6"/><path class="tpp-x-core" d="M3.4 3.4 22.6 22.6M22.6 3.4 3.4 22.6"/></svg><em>${hourLabel(latest.ts)}</em></span>`, 'tpp-current-x-wrap', [13, 13], [26, 26]),
          keyboard: false,
        });
        mark.bindTooltip(xCard(latest), {
          direction: 'right', offset: [16, 0], opacity: 1, className: 'tpp-x-tip',
        });
        // 标记的点击不向地图冒泡，点中十字也选中最新时次
        mark.on('click', () => {
          if (state.measuring) return;
          if (window.TyphoonPage) window.TyphoonPage.selectPoint(points.length - 1);
        });
        mark.addTo(state.trackLayer);
      }
      if (s.selected !== latestIndex && base[s.selected]) {
        const picked = base[s.selected];
        L.circleMarker([picked[0], picked[1] + offset], {
          radius: 10, color: '#ffffff', weight: 1.6, opacity: .9, fill: false, dashArray: '3 3', interactive: false,
        }).addTo(state.trackLayer);
      }
    });

    if (state.stormId !== s.storm.id) {
      state.stormId = s.storm.id;
      if (state.follow) fitStorm();
    }
    renderWind();
  }

  function renderAll() {
    renderPanel();
    renderTrack();
    if (state.cardMode === 'options') {
      refreshStormSelect();
      refreshForecastAgencies();
    }
  }

  function setGrid(on) {
    state.gridOn = on;
    $('#tppGrid').setAttribute('aria-pressed', String(on));
    const cardGrid = document.querySelector('#tppOptGrid');
    if (cardGrid) cardGrid.checked = on;
    if (!on) hideCoord();
  }

  function buildSatellite() {
    if (state.satLayer) return;
    const options = { subdomains: '1234', maxZoom: 18, keepBuffer: 2, attribution: '底图 &copy; 高德地图' };
    const satBase = L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', options);
    const satLabels = L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}', options);
    attachTileRetry(satBase);
    attachTileRetry(satLabels);
    state.satLayer = L.layerGroup([satBase, satLabels]);
  }

  function setBase(base) {
    state.base = base === 'sat' ? 'sat' : 'vec';
    const satellite = state.base === 'sat';
    page.classList.toggle('is-satellite', satellite);
    const button = $('#tppBase');
    if (button) {
      button.classList.toggle('is-active', satellite);
      button.setAttribute('aria-pressed', String(satellite));
      const tip = satellite ? '标准底图' : '卫星底图';
      button.dataset.tip = tip;
      button.setAttribute('aria-label', `切换到${tip}`);
    }
    if (!state.map) return;
    buildSatellite();
    if (satellite) {
      if (state.map.hasLayer(state.baseLayer)) state.map.removeLayer(state.baseLayer);
      state.satLayer.addTo(state.map);
    } else {
      if (state.map.hasLayer(state.satLayer)) state.map.removeLayer(state.satLayer);
      state.baseLayer.addTo(state.map);
    }
  }

  function setPanelCollapsed(collapsed) {
    state.panelCollapsed = collapsed;
    page.classList.toggle('panel-collapsed', collapsed);
    const button = $('#tppPanelToggle');
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? '展开信息栏' : '收起信息栏');
  }

  function setToolsHidden(hidden) {
    state.toolsHidden = hidden;
    page.classList.toggle('tools-hidden', hidden);
    $('#tppToolsTab').hidden = !hidden;
  }


  const SUN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"/></svg>';
  const MOON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z"/></svg>';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function applyTheme(theme) {
    state.theme = theme === 'light' ? 'light' : 'dark';
    page.classList.toggle('is-light', state.theme === 'light');
    const button = $('#tppTheme');
    if (button) button.innerHTML = state.theme === 'light' ? MOON_ICON : SUN_ICON;
    updateWindLegendColors();
    if (state.map) renderWind();
    try { localStorage.setItem('qxksh.typhoonProTheme', state.theme); } catch (error) { /* ignore */ }
  }

  function stormOptionsHtml() {
    const s = tp();
    const storms = (s && s.list) || [];
    const current = s && s.storm ? s.storm.id : '';
    if (!storms.length) return '<option value="">暂无台风记录</option>';
    return storms.map((storm) => {
      const number = String(storm.number || '');
      const short = number.length > 4 ? number.slice(-4) : number;
      const en = storm.enname && !/^nameless$/i.test(storm.enname) && !isUnnamedStorm(storm) ? ` (${storm.enname.toUpperCase()})` : '';
      const label = isUnnamedStorm(storm) ? unnamedName(storm) : `${short ? `${short} ` : ''}${storm.name || '未命名台风'}`;
      return `<option value="${esc(storm.id)}"${storm.id === current ? ' selected' : ''}>${esc(label)}${esc(en)}</option>`;
    }).join('');
  }

  function isUnnamedStorm(storm) {
    if (!storm) return false;
    const name = String(storm.name || '').trim();
    const en = String(storm.enname || '').trim().toLowerCase();
    return !name || /^未命名/.test(name) || en === 'nameless' || en === 'unnamed';
  }

  function unnamedName(storm) {
    const list = (tp() && tp().list) || [];
    const entries = list
      .map((item, index) => ({ item, index }))
      .filter((entry) => isUnnamedStorm(entry.item))
      .sort((a, b) => ((a.item.start || 0) - (b.item.start || 0)) || (a.index - b.index));
    const found = entries.findIndex((entry) => entry.item.id === storm.id);
    return found >= 0 ? `热带低压${found + 1}` : '未命名台风';
  }

  function stormTitle(storm) {
    if (!storm) return '—';
    return isUnnamedStorm(storm) ? unnamedName(storm) : (storm.name || '未命名台风');
  }

  function agencyColor(name) {
    return AGENCY_COLORS[name] || '#9fb4c4';
  }

  function forecastList() {
    const s = tp();
    return (s && s.forecasts) || [];
  }

  function selectedAgencies() {
    if (!state.forecastAgencies) {
      state.forecastAgencies = new Set(forecastList().map((f) => f.name));
      state.forecastKnown = new Set(state.forecastAgencies);
    }
    return state.forecastAgencies;
  }

  function defaultAgencySet(storm) {
    const names = forecastList().map((forecast) => forecast.name);
    if (!storm || storm.active) return new Set(names);
    const china = names.filter((name) => name === '中国');
    return new Set(china.length ? china : names.slice(0, 1));
  }

  function agencyChecksHtml() {
    const list = forecastList();
    if (!list.length) return '<span class="tpp-card-hint">当前台风暂无预报机构</span>';
    const selected = selectedAgencies();
    return list.map((forecast) => {
      const checked = selected.has(forecast.name);
      return `<label class="tpp-agency-row${state.showForecast ? '' : ' is-disabled'}"><input type="checkbox" data-agency="${esc(forecast.name)}"${checked ? ' checked' : ''}${state.showForecast ? '' : ' disabled'}><i style="--c:${agencyColor(forecast.name)}"></i>${esc(forecast.name)}</label>`;
    }).join('');
  }

  function refreshForecastAgencies() {
    const box = document.querySelector('#tppAgencyList');
    if (!box) return;
    box.innerHTML = agencyChecksHtml();
  }

  function yearOptionsHtml() {
    const s = tp();
    const current = s ? s.year : new Date(Date.now() + 8 * 3600e3).getUTCFullYear();
    const latest = new Date(Date.now() + 8 * 3600e3).getUTCFullYear();
    let html = '';
    for (let year = latest; year >= 1949; year--) {
      html += `<option value="${year}"${year === Number(current) ? ' selected' : ''}>${year} 年</option>`;
    }
    return html;
  }

  function optionsHtml() {
    return `<p class="tpp-card-section">›› 全局配置</p>
      <div class="tpp-card-field"><label for="tppYearSelect">年份：</label><select id="tppYearSelect">${yearOptionsHtml()}</select></div>
      <div class="tpp-card-field"><label for="tppStormSelect">当前活跃台风：</label><select id="tppStormSelect">${stormOptionsHtml()}</select></div>
      <label class="tpp-switch-row"><span>实况风圈显示</span><input type="checkbox" id="tppOptWind"${state.showWind ? ' checked' : ''}><i></i></label>
      <label class="tpp-check-row${state.showWind ? '' : ' is-disabled'}"><input type="checkbox" id="tppOptFill"${state.windFill ? ' checked' : ''}${state.showWind ? '' : ' disabled'}>风圈填充</label>
      <label class="tpp-switch-row"><span>预报路径</span><input type="checkbox" id="tppOptForecast"${state.showForecast ? ' checked' : ''}><i></i></label>
      <div class="tpp-agency-list" id="tppAgencyList">${agencyChecksHtml()}</div>
      <p class="tpp-card-hint">勾选要显示的预报机构，虚线为预报路径，非实况。</p>
      <label class="tpp-switch-row"><span>视点跟随</span><input type="checkbox" id="tppOptFollow"${state.follow ? ' checked' : ''}><i></i></label>
      <p class="tpp-card-hint">说明：开启后将会根据内容自动调整显示区域</p>
      <label class="tpp-switch-row"><span>鼠标经纬度</span><input type="checkbox" id="tppOptGrid"${state.gridOn ? ' checked' : ''}><i></i></label>
      <p class="tpp-card-note">更多选项后续补充；当前不包含系集预报与模型预测。</p>`;
  }

  function notesHtml() {
    return `<p class="tpp-card-section">›› 数据说明</p>
      <ul class="tpp-card-list">
        <li><b>实况与预报</b>：中央气象台、浙江省水利厅，可能存在延迟，请以官方发布为准。</li>
        <li><b>底图</b>：高德地图，坐标按 GCJ02 显示；经纬网与复制的坐标基于底图。</li>
        <li><b>测距</b>：按两点大圆距离近似计算，仅供参考。</li>
        <li><b>风圈</b>：以四象限半径的平均值近似绘制，非灾害影响范围。</li>
        <li>预报路径可能调整，请勿作为防灾行动的唯一依据。</li>
      </ul>`;
  }

  function refreshStormSelect() {
    const select = document.querySelector('#tppStormSelect');
    if (!select) return;
    const s = tp();
    const target = s && s.storm ? s.storm.id : select.value;
    select.innerHTML = stormOptionsHtml();
    if (target) select.value = target;
    const yearSelect = document.querySelector('#tppYearSelect');
    if (yearSelect && s) yearSelect.value = String(s.year);
  }

  function bindCard() {
    const body = $('#tppCardBody');
    const select = body.querySelector('#tppStormSelect');
    if (select) {
      select.addEventListener('change', () => {
        if (select.value && window.TyphoonPage) window.TyphoonPage.loadStorm(select.value);
      });
    }
    const year = body.querySelector('#tppYearSelect');
    if (year) {
      year.addEventListener('change', () => {
        const stormSelect = body.querySelector('#tppStormSelect');
        if (stormSelect) stormSelect.innerHTML = '<option>读取中…</option>';
        if (window.TyphoonPage) window.TyphoonPage.setYear(year.value);
      });
    }
    const forecast = body.querySelector('#tppOptForecast');
    if (forecast) {
      forecast.addEventListener('change', () => {
        state.showForecast = forecast.checked;
        refreshForecastAgencies();
        renderTrack();
      });
    }
    const agencies = body.querySelector('#tppAgencyList');
    if (agencies) {
      agencies.addEventListener('change', (event) => {
        const input = event.target.closest('input[data-agency]');
        if (!input) return;
        const set = selectedAgencies();
        if (input.checked) set.add(input.dataset.agency);
        else set.delete(input.dataset.agency);
        renderTrack();
      });
    }
    const wind = body.querySelector('#tppOptWind');
    if (wind) {
      wind.addEventListener('change', () => {
        state.showWind = wind.checked;
        renderWind();
        const fill = body.querySelector('#tppOptFill');
        if (fill) {
          fill.disabled = !state.showWind;
          fill.closest('.tpp-check-row').classList.toggle('is-disabled', !state.showWind);
        }
      });
    }
    const fill = body.querySelector('#tppOptFill');
    if (fill) {
      fill.addEventListener('change', () => {
        state.windFill = fill.checked;
        renderWind();
      });
    }
    const follow = body.querySelector('#tppOptFollow');
    if (follow) {
      follow.addEventListener('change', () => {
        state.follow = follow.checked;
        if (state.follow) fitStorm();
      });
    }
    const grid = body.querySelector('#tppOptGrid');
    if (grid) grid.addEventListener('change', () => setGrid(grid.checked));
  }

  function openCard(mode) {
    state.cardMode = mode;
    $('#tppCardTitle').textContent = mode === 'notes' ? '注意事项' : '台风选项';
    $('#tppCardBody').innerHTML = mode === 'notes' ? notesHtml() : optionsHtml();
    $('#tppCard').hidden = false;
    $('#tppNotes').classList.toggle('is-active', mode === 'notes');
    $('#tppOptions').classList.toggle('is-active', mode === 'options');
    bindCard();
  }

  function closeCard() {
    $('#tppCard').hidden = true;
    state.cardMode = null;
    $('#tppNotes').classList.remove('is-active');
    $('#tppOptions').classList.remove('is-active');
  }

  function unwrapNear(from, to) {
    return L.latLng(to.lat, to.lng + Math.round((from.lng - to.lng) / 360) * 360);
  }

  function segmentKm(from, to) {
    return from.distanceTo(unwrapNear(from, to)) / 1000;
  }

  function totalDistance() {
    let total = 0;
    for (let i = 1; i < state.measurePts.length; i++) {
      total += segmentKm(state.measurePts[i - 1], state.measurePts[i]);
    }
    return total;
  }

  function km(value) {
    return value >= 100 ? `${Math.round(value)} km` : `${value.toFixed(1)} km`;
  }

  function drawMeasure() {
    state.measureLayer.clearLayers();
    const points = state.measurePts;
    points.forEach((point, index) => {
      L.marker(point, {
        icon: labelIcon(String(index + 1), 'tpp-measure-dot', [17, 17], [34, 34]),
        interactive: false,
        keyboard: false,
      }).addTo(state.measureLayer);
    });
    if (points.length > 1) {
      L.polyline(points, { color: '#4da3e2', weight: 2.5, dashArray: '9 9', opacity: .95 }).addTo(state.measureLayer);
      for (let i = 1; i < points.length; i++) {
        const next = unwrapNear(points[i - 1], points[i]);
        const mid = L.latLng((points[i - 1].lat + next.lat) / 2, (points[i - 1].lng + next.lng) / 2);
        L.marker(mid, {
          icon: labelIcon(`<span class="tpp-measure-label-text">${km(segmentKm(points[i - 1], points[i]))}</span>`, 'tpp-measure-label', [0, 0]),
          interactive: false,
          keyboard: false,
        }).addTo(state.measureLayer);
      }
    }
    const info = $('#tppMeasureInfo');
    if (!points.length) {
      info.hidden = true;
      return;
    }
    info.hidden = false;
    info.textContent = `总距离 ${km(totalDistance())} · ${points.length} 个点 · 右键结束`;
  }

  function setMeasuring(on) {
    state.measuring = on;
    page.classList.toggle('is-measuring', on);
    $('#tppMeasure').setAttribute('aria-pressed', String(on));
    state.measurePts = [];
    if (state.measureLayer) state.measureLayer.clearLayers();
    $('#tppMeasureInfo').hidden = true;
  }

  function finishMeasure() {
    if (!state.measuring) return;
    const hadPoints = state.measurePts.length > 0;
    const summary = hadPoints ? `测距结束 · 总距离 ${km(totalDistance())} · 再次点击“测距”重新测量` : '';
    state.measuring = false;
    page.classList.remove('is-measuring');
    $('#tppMeasure').setAttribute('aria-pressed', 'false');
    const info = $('#tppMeasureInfo');
    if (hadPoints) {
      info.hidden = false;
      info.textContent = summary;
    } else {
      info.hidden = true;
    }
  }

  function onMapClick(event) {
    if (!state.measuring) return;
    state.measurePts.push(event.latlng);
    drawMeasure();
  }

  // 路径点只有 4px，点偏一点就选不中；按屏幕距离吸附到最近的时间点
  function pickNearestPoint(event) {
    if (!state.map || !state.hitPoints.length) return false;
    const radius = window.matchMedia('(pointer: coarse)').matches ? 24 : 18;
    const origin = event.containerPoint;
    let best = null;
    let bestDist = Infinity;
    for (const item of state.hitPoints) {
      const pt = state.map.latLngToContainerPoint([item.lat, item.lng]);
      const dist = Math.hypot(pt.x - origin.x, pt.y - origin.y);
      if (dist <= radius && dist < bestDist) {
        bestDist = dist;
        best = item;
      }
    }
    if (!best) return false;
    if (window.TyphoonPage) window.TyphoonPage.selectPoint(best.index);
    return true;
  }

  function onMapContext(event) {
    if (!state.measuring) return;
    event.originalEvent.preventDefault();
    finishMeasure();
  }

  function hideCoord() {
    const box = $('#tppCoord');
    if (box) box.hidden = true;
  }

  function onCoordMove(event) {
    if (!state.open || !state.gridOn) return;
    const box = $('#tppCoord');
    const text = $('#tppCoordText');
    if (!box || !text) return;
    const latlng = event.latlng.wrap();
    state.coord = latlng;
    text.textContent = `经度：${latlng.lng.toFixed(4)}，纬度：${latlng.lat.toFixed(4)}`;
    const hint = $('#tppCoordHint');
    if (hint.dataset.copied !== '1') hint.textContent = '按 C 复制当前经纬度到剪贴板';
    box.hidden = false;
    const width = box.offsetWidth;
    const height = box.offsetHeight;
    const pointer = event.originalEvent;
    let x = (pointer.clientX || 0) + 16;
    let y = (pointer.clientY || 0) + 18;
    if (x + width > window.innerWidth - 12) x = pointer.clientX - width - 16;
    if (y + height > window.innerHeight - 12) y = pointer.clientY - height - 12;
    box.style.left = `${Math.max(12, x)}px`;
    box.style.top = `${Math.max(12, y)}px`;
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => legacyCopy(text, done));
      return;
    }
    legacyCopy(text, done);
  }

  function legacyCopy(text, done) {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      done();
    } catch (error) {
      /* Clipboard unavailable. */
    }
    area.remove();
  }

  function copyCoord() {
    if (!state.coord) return;
    const text = `经度：${state.coord.lng.toFixed(4)}，纬度：${state.coord.lat.toFixed(4)}`;
    copyText(text, () => {
      const hint = $('#tppCoordHint');
      hint.textContent = '已复制到剪贴板';
      hint.dataset.copied = '1';
      clearTimeout(state.copyTimer);
      state.copyTimer = setTimeout(() => {
        hint.textContent = '按 C 复制当前经纬度到剪贴板';
        delete hint.dataset.copied;
      }, 1500);
    });
  }

  const BLANK_TILE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  function attachTileRetry(layer, maxTries = 2) {
    layer.options.errorTileUrl = BLANK_TILE;
    layer.on('tileerror', (event) => {
      const tile = event.tile;
      if (!tile) return;
      const tries = Number(tile.dataset.retry || 0);
      if (tries >= maxTries) return;
      tile.dataset.retry = String(tries + 1);
      setTimeout(() => {
        const base = tile.src.replace(/wprd0[1-4]/, () => `wprd0${1 + Math.floor(Math.random() * 4)}`);
        tile.src = `${base}${base.includes('?') ? '&' : '?'}retry=${Date.now()}`;
      }, 700 * (tries + 1));
    });
  }

  function initMap() {
    if (state.map) return;
    const map = L.map('typhoonProMap', {
      zoomControl: false,
      minZoom: 3,
      maxZoom: 18,
      worldCopyJump: false,
    });
    map.attributionControl.setPrefix(false);
    state.baseLayer = L.tileLayer('https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=7', {
      subdomains: '1234',
      minZoom: 2,
      maxZoom: 18,
      keepBuffer: 2,
      attribution: '底图 &copy; 高德地图',
    }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    map.setView([20, 135], 3);
    state.map = map;
    // 风圈放进独立图层：半透明填充不再盖住上方的路径点与预报线
    map.createPane('tppWindPane');
    map.getPane('tppWindPane').style.zIndex = '350';
    state.windLayer = L.layerGroup().addTo(map);
    state.trackLayer = L.layerGroup().addTo(map);
    state.measureLayer = L.layerGroup().addTo(map);
    map.on('click', (event) => {
      state.windLayer.eachLayer((layer) => { if (layer.closeTooltip) layer.closeTooltip(); });
      if (!state.measuring && pickNearestPoint(event)) return;
      onMapClick(event);
    });
    map.on('contextmenu', onMapContext);
    map.on('mousemove', onCoordMove);
    map.on('mouseout', hideCoord);
    map.on('moveend zoomend', () => {
      const copy = Math.round(map.getCenter().lng / 360) * 360;
      if (copy !== state.copy) {
        state.copy = copy;
        renderTrack();
      }
    });
  }

  function open() {
    if (state.open) return;
    state.open = true;
    initMap();
    setBase('vec');
    setGrid(false);
    const current = tp();
    if (current && current.storm) {
      state.windStormId = current.storm.id;
      state.showWind = Boolean(current.storm.active);
      syncWindControls();
    }
    if (current && current.forecasts && current.forecasts.length) {
      state.forecastAgencies = defaultAgencySet(current.storm);
      state.forecastKnown = new Set(current.forecasts.map((forecast) => forecast.name));
      state.forecastStormId = current.storm ? current.storm.id : null;
    }
    document.addEventListener('typhoon:update', renderAll);
    if (window.innerWidth <= 860) setPanelCollapsed(true);
    renderAll();
    requestAnimationFrame(() => { if (state.map) state.map.invalidateSize(); });
    setTimeout(() => {
      if (!state.open || !state.map) return;
      state.map.invalidateSize();
      renderTrack();
    }, 220);
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    document.removeEventListener('typhoon:update', renderAll);
    setMeasuring(false);
    closeCard();
    $('#tppToolsTab').hidden = true;
    page.classList.remove('tools-hidden');
  }

  $('#tppPanelToggle').addEventListener('click', () => setPanelCollapsed(!state.panelCollapsed));
  $('#tppToolsHide').addEventListener('click', () => setToolsHidden(true));
  $('#tppToolsTab').addEventListener('click', () => setToolsHidden(false));
  $('#tppGrid').addEventListener('click', () => setGrid(!state.gridOn));
  $('#tppMeasure').addEventListener('click', () => {
    if (state.measuring) finishMeasure();
    else setMeasuring(true);
  });
  document.addEventListener('keydown', (event) => {
    if (!state.open) return;
    if (event.key === 'Escape' && state.cardMode) {
      closeCard();
      return;
    }
    if (event.key === 'Escape' && state.measuring) {
      setMeasuring(false);
      $('#tppMeasureInfo').hidden = true;
      return;
    }
    if ((event.key === 'c' || event.key === 'C') && state.gridOn) {
      const tag = (event.target && event.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      copyCoord();
    }
  });
  window.addEventListener('resize', () => {
    if (state.open && state.map) state.map.invalidateSize();
  });

  $('#tppBase').addEventListener('click', () => setBase(state.base === 'sat' ? 'vec' : 'sat'));
  $('#tppTheme').addEventListener('click', () => applyTheme(state.theme === 'light' ? 'dark' : 'light'));
  $('#tppNotes').addEventListener('click', () => {
    if (state.cardMode === 'notes') closeCard();
    else openCard('notes');
  });
  $('#tppOptions').addEventListener('click', () => {
    if (state.cardMode === 'options') closeCard();
    else openCard('options');
  });
  $('#tppCardClose').addEventListener('click', closeCard);

  let savedTheme = 'dark';
  try { savedTheme = localStorage.getItem('qxksh.typhoonProTheme') || 'dark'; } catch (error) { /* ignore */ }
  applyTheme(savedTheme);

  window.TyphoonProPage = { open, close, state, map: () => state.map };
})();
