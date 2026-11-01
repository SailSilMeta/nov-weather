(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.COLD_AIR_ENGINE = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 南岭山口关键站：四站全部达标 = 冷空气主体越过南岭
  const GATE_STATIONS = { 440200: '韶关', 441800: '清远', 441600: '河源', 441400: '梅州' };

  const CFG = {
    windHours: 3,        // 连续 3 小时稳定偏北风
    tempHours: 4,        // 连续 4 小时气温不回升
    gateDrop: 4,         // 南岭站累计降温门槛 ℃
    cityDrop: 3,         // 单站累计降温门槛 ℃
    minWindSpeed: 1.6,   // 2 级风下限 m/s
    maxSpread: 45,       // 风向稳定区间 ±45°
    closeHours: 24,      // 最后一个站点转蓝后 24h 关闭过程
    keepHours: 36,       // 保留的小时序列长度
  };

  const HOUR_MS = 3600e3;
  const round1 = (v) => Math.round(v * 10) / 10;
  const toKey = (s) => `${String(s || '').trim().slice(0, 13).replace(' ', 'T')}:00`;
  const toMs = (key) => Date.parse(`${key}:00+08:00`);
  // 北京时（+08:00）时钟口径的小时加减
  const addHours = (key, hours) => new Date(toMs(key) + (hours + 8) * HOUR_MS).toISOString().slice(0, 16);

  function angleDiff(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }
  // 偏北风：北 / 东北 / 西北
  function isNorth(dir) {
    return typeof dir === 'number' && (dir <= 67.5 || dir >= 292.5);
  }
  function spread(dirs) {
    let max = 0;
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) max = Math.max(max, angleDiff(dirs[i], dirs[j]));
    }
    return max;
  }
  function windText(dir) {
    if (typeof dir !== 'number') return '';
    const names = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风'];
    return names[Math.round(((dir % 360) / 45)) % 8];
  }
  function windLevel(spd) {
    const BEAUFORT = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
    let level = 0;
    while (level < BEAUFORT.length && spd >= BEAUFORT[level]) level++;
    return level;
  }

  // 以 m 为终点、满足「连续偏北风且风向不摆」的起始下标
  function runStart(series, m) {
    const cur = series[m];
    if (!cur || !isNorth(cur.dir) || !(cur.spd >= CFG.minWindSpeed)) return -1;
    let s = m;
    while (s > 0) {
      const prev = series[s - 1];
      if (!prev || !isNorth(prev.dir) || !(prev.spd >= CFG.minWindSpeed)) break;
      if (toMs(series[s].t) - toMs(prev.t) !== HOUR_MS) break;
      if (spread(series.slice(s - 1, m + 1).map((x) => x.dir)) > CFG.maxSpread) break;
      s--;
    }
    return s;
  }

  // 从 fromIdx 起寻找首次达标时刻：稳定偏北风 + 连续不回升 + 累计降温
  function qualifyAt(series, fromIdx, needDrop) {
    for (let m = Math.max(0, fromIdx); m < series.length; m++) {
      const s = runStart(series, m);
      if (s < 0 || m - s + 1 < CFG.tempHours) continue;
      const base = series[s - 1];
      if (!base || base.temp == null) continue;
      if (toMs(series[s].t) - toMs(base.t) > 2 * HOUR_MS) continue;
      let ok = true;
      for (let k = s; k <= m; k++) {
        const cur = series[k];
        if (cur.temp == null) { ok = false; break; }
        if (k === s) continue;
        const prev = series[k - 1];
        if (toMs(cur.t) - toMs(prev.t) !== HOUR_MS) { ok = false; break; }
        if (cur.temp > prev.temp + 0.05) { ok = false; break; }
      }
      if (!ok) continue;
      const drop = round1(base.temp - series[m].temp);
      if (drop < needDrop) continue;
      const rain = round1(series.slice(s, m + 1).reduce((sum, x) => sum + (x.rain || 0), 0));
      return {
        at: series[m].t,
        idx: m,
        sAt: series[s].t,
        drop,
        baseT: base.temp,
        t: series[m].temp,
        rain,
        kind: rain >= 0.1 ? '锋面型南下' : '干冷南下',
      };
    }
    return null;
  }

  // 首个晚于 minAt 的达标时刻（同一段北风里可持续达标，需要越过已处理的那次）
  function findQualify(series, minAt, needDrop) {
    let from = 0;
    for (;;) {
      const hit = qualifyAt(series, from, needDrop);
      if (!hit) return null;
      if (!minAt || hit.at > minAt) return hit;
      from = hit.idx + 1;
    }
  }

  function prune(series) {
    if (!series.length) return series;
    const latest = toMs(series[series.length - 1].t);
    return series.filter((x) => latest - toMs(x.t) <= CFG.keepHours * HOUR_MS);
  }

  function latest(seriesList) {
    let max = '';
    for (const s of seriesList) {
      const t = s.length ? s[s.length - 1].t : '';
      if (t > max) max = t;
    }
    return max;
  }

  // seriesByAdcode: { adcode: [{t,temp,dir,spd,rain}] } 升序
  function buildState(seriesByAdcode, prev) {
    const latestKey = latest(Object.values(seriesByAdcode));
    let closedAt = prev.closedAt || '';

    // 1) 南岭四站达标时刻
    const gates = {};
    for (const [ad, name] of Object.entries(GATE_STATIONS)) {
      const series = seriesByAdcode[ad] || [];
      let hit = series.length ? findQualify(series, closedAt, CFG.gateDrop) : null;
      if (!hit && prev.event && prev.event.gate && prev.event.gate[ad] && prev.event.status === 'active') {
        hit = prev.event.gate[ad];
      }
      if (hit) gates[ad] = { ...hit, name };
    }
    const gateList = Object.entries(GATE_STATIONS).map(([ad]) => gates[ad]).filter(Boolean);
    const gateTimes = gateList.map((g) => g.at).sort();
    const gateSpanOk = gateTimes.length ? (toMs(gateTimes[gateTimes.length - 1]) - toMs(gateTimes[0])) / HOUR_MS <= CFG.keepHours : false;

    const openedAt = prev.event && prev.event.status === 'active' ? prev.event.openedAt : '';
    const windowStart = prev.event && prev.event.status === 'active' ? prev.event.windowStart : '';

    // 2) 城市达标（≥3℃），仅在事件窗口内生效
    const citySeries = Object.entries(seriesByAdcode);
    const cityHitAfter = (series, minAt) => (series.length ? findQualify(series, minAt, CFG.cityDrop) : null);

    let status = 'watching';
    let event = null;

    if (openedAt) {
      // 事件进行中：沿用旧蓝色，并吸收新达标城市
      const blues = { ...(prev.event.blues || {}) };
      for (const [ad, series] of citySeries) {
        const hit = cityHitAfter(series, windowStart);
        if (hit && (!blues[ad] || hit.at < blues[ad].at)) blues[ad] = hit;
      }
      const times = Object.values(blues).map((b) => b.at).sort();
      const lastArrivalAt = times.length ? times[times.length - 1] : prev.event.lastArrivalAt;
      const closesAt = lastArrivalAt ? addHours(lastArrivalAt, CFG.closeHours) : '';
      const closed = closesAt && latestKey >= closesAt;
      if (closed) {
        closedAt = closesAt;
        status = 'watching';
        event = null;
        // 过程结束当帧即复位关口，四个关口回到未达标状态
        for (const ad of Object.keys(gates)) delete gates[ad];
      } else {
        status = 'active';
        event = {
          status: 'active',
          openedAt,
          windowStart,
          lastArrivalAt,
          closesAt,
          gate: prev.event.gate,
          blues,
        };
      }
    }

    if (status !== 'active' && gateList.length === 4 && gateSpanOk) {
      const fresh = gateList.every((g) => !closedAt || g.at > closedAt);
      if (fresh) {
        const openAt = gateTimes[gateTimes.length - 1];
        // 过程起点 = 最早达标关口转北风的时刻，允许开过程前的同过程达标一并转蓝
        const startAt = gateList.map((g) => g.sAt || g.at).sort()[0];
        const blues = {};
        for (const [ad, series] of citySeries) {
          const hit = cityHitAfter(series, startAt);
          if (hit) blues[ad] = hit;
        }
        const times = Object.values(blues).map((b) => b.at).sort();
        const lastArrivalAt = times.length ? times[times.length - 1] : openAt;
        const closesAt = addHours(lastArrivalAt, CFG.closeHours);
        if (latestKey < closesAt) {
          status = 'active';
          event = {
            status: 'active',
            openedAt: openAt,
            windowStart: startAt,
            lastArrivalAt,
            closesAt,
            gate: gates,
            blues,
          };
        }
      }
    }

    // 3) 输出每站状态
    const cities = {};
    for (const [ad, series] of citySeries) {
      const hit = event && event.blues[ad];
      const cur = series[series.length - 1] || {};
      const back3 = series.filter((x) => toMs(cur.t) - toMs(x.t) <= 3 * HOUR_MS)[0];
      const tempNow = cur.temp != null ? cur.temp : null;
      const drop3h = back3 && back3.temp != null && tempNow != null ? round1(back3.temp - tempNow) : 0;
      cities[ad] = hit
        ? { status: 'arrived', at: hit.at, drop: hit.drop, rain: hit.rain, kind: hit.kind, t: tempNow, dir: cur.dir, spd: cur.spd }
        : {
            status: 'pending',
            t: tempNow,
            dir: cur.dir,
            spd: cur.spd,
            wind: windText(cur.dir),
            level: typeof cur.spd === 'number' ? windLevel(cur.spd) : null,
            drop3h,
            rain: typeof cur.rain === 'number' ? cur.rain : 0,
          };
    }

    const gateOut = {};
    for (const [ad, name] of Object.entries(GATE_STATIONS)) {
      const g = (event && event.gate && event.gate[ad]) || gates[ad];
      gateOut[ad] = g ? { name, passed: true, at: g.at, drop: g.drop, t: g.t } : { name, passed: false };
    }

    const arrived = Object.values(cities).filter((c) => c.status === 'arrived').length;
    const gatePassed = Object.values(gateOut).filter((g) => g.passed).length;

    return {
      source: 'nmc',
      updatedAt: latestKey,
      event: event || {
        status: 'watching',
        openedAt: '',
        windowStart: '',
        lastArrivalAt: '',
        closesAt: '',
        gate: gateOut,
        blues: {},
      },
      gate: gateOut,
      stats: { arrived, pending: Object.keys(cities).length - arrived, gatePassed },
      closedAt,
      cities,
      series: seriesByAdcode,
    };
  }

  return {
    CFG,
    GATE_STATIONS,
    buildState,
    qualifyAt,
    findQualify,
    runStart,
    isNorth,
    windText,
    windLevel,
    prune,
    toKey,
    toMs,
    addHours,
    round1,
  };
});
