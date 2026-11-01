(function () {
  'use strict';

  const host = location.hostname;
  const LOCAL = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const params = new URLSearchParams(location.search);
  // 默认隐藏，需要调试时在本地/内网地址后加 ?coldTest=1（或 ?coldLab=1）临时调出
  const labOn = params.get('coldTest') === '1' || params.get('coldLab') === '1';
  if (!LOCAL || !labOn || window.COLD_AIR_LAB) return;

  const $ = (id) => document.getElementById(id);
  const launchEl = $('coldLabLaunch');
  const panelEl = $('coldLabPanel');
  if (!launchEl || !panelEl) return;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(src));
      document.body.appendChild(s);
    });
  }

  async function boot() {
    try {
      if (!window.COLD_AIR_ENGINE) await loadScript('cold-air-engine.js');
      if (!window.COLD_AIR_DEMO) await loadScript('data/cold-air-demo.js');
    } catch (e) {
      return;
    }
    if (!window.COLD_AIR_ENGINE || !window.COLD_AIR_DEMO || !window.COLD_AIR_VIEW) return;
    window.COLD_AIR_LAB = mount();
  }

  function mount() {
    const engine = window.COLD_AIR_ENGINE;
    const demo = window.COLD_AIR_DEMO;
    const view = window.COLD_AIR_VIEW;
    const { CFG, GATE_STATIONS, buildState, runStart, round1, windText, windLevel } = engine;
    if (!demo || !demo.series || !demo.hours) return null;

    const clone = (obj) => JSON.parse(JSON.stringify(obj));
    const baseSeries = clone(demo.series);
    let series = clone(demo.series);
    let states = [];
    let frame = 0;
    let span = demo.hours;
    let speed = 1;
    let mode = 'demo';
    let timer = null;
    let panelScroll = 0;

    const features = ((window.MAP_DATA && window.MAP_DATA.cities && window.MAP_DATA.cities.features) || [])
      .filter((f) => String(f.properties.provinceAdcode) === '440000');
    const cityMeta = new Map();
    for (const f of features) {
      cityMeta.set(String(f.properties.adcode), { short: f.properties.short || f.properties.name });
    }
    const adcodes = Object.keys(series).sort((a, b) => {
      const na = (cityMeta.get(a) || {}).short || a;
      const nb = (cityMeta.get(b) || {}).short || b;
      return na.localeCompare(nb, 'zh-Hans-CN');
    });
    const total = adcodes.length;
    const lastFrame = demo.hours - 1;

    const pad = (n) => String(n).padStart(2, '0');
    function fmtTime(at) {
      if (!at) return '—';
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(at);
      return m ? `${Number(m[2])}月${Number(m[3])}日 ${pad(m[4])}时` : at;
    }
    const timeAt = (f) => (series[adcodes[0]] && series[adcodes[0]][f] ? series[adcodes[0]][f].t : '');
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    function buildThrough(f) {
      if (!span || f < 0) return;
      states = states.slice(0, Math.min(states.length, f + 1));
      let prev = states.length ? states[states.length - 1] : {};
      for (let h = states.length; h <= f; h++) {
        const sliced = {};
        for (const ad of adcodes) {
          const arr = series[ad];
          const end = h + 1;
          sliced[ad] = arr.slice(Math.max(0, end - span), end);
        }
        const st = buildState(sliced, prev);
        states.push(st);
        prev = st;
      }
    }

    function currentState() {
      if (mode === 'live') return window.COLD_AIR || null;
      buildThrough(frame);
      return states[frame] || null;
    }

    function widgetState() {
      const st = currentState();
      return {
        st,
        event: (st && st.event) || { status: 'watching' },
        gate: (st && (st.gate || (st.event && st.event.gate))) || {},
        cities: (st && st.cities) || {},
        active: !!(st && st.event && st.event.status === 'active'),
      };
    }

    function invalidate(from) {
      states = states.slice(0, Math.max(0, from));
    }

    function selectedAd() {
      const sel = $('coldLabCity');
      return sel && series[sel.value] ? sel.value : adcodes[0];
    }

    function stopPlay() {
      if (timer) clearInterval(timer);
      timer = null;
      const btn = $('coldLabPlay');
      if (btn) {
        btn.textContent = '播放';
        btn.classList.remove('is-playing');
      }
    }

    function startPlay() {
      if (mode !== 'demo') return;
      stopPlay();
      if (frame >= lastFrame) setFrame(0);
      const btn = $('coldLabPlay');
      if (btn) {
        btn.textContent = '暂停';
        btn.classList.add('is-playing');
      }
      timer = setInterval(() => {
        if (frame >= lastFrame) {
          stopPlay();
          return;
        }
        setFrame(frame + 1);
      }, 1000 / speed);
    }

    function setFrame(f) {
      frame = clamp(Math.round(f), 0, lastFrame);
      renderFrame();
    }

    function renderFrame() {
      if (mode === 'demo') buildThrough(frame);
      const range = $('coldLabRange');
      if (range) range.value = String(frame);
      const clock = $('coldLabClock');
      if (clock) clock.textContent = mode === 'live' ? fmtTime((window.COLD_AIR || {}).updatedAt) : fmtTime(timeAt(frame));
      const ws = widgetState();
      const badge = $('coldLabBadge');
      if (badge) {
        badge.textContent = mode === 'live' ? '实况' : (ws.active ? '过程进行中' : '监测中');
        badge.classList.toggle('is-arrived', ws.active);
      }
      const stEl = $('coldLabState');
      if (stEl) {
        stEl.textContent = mode === 'live' ? '实况' : (ws.active ? '进行中' : '监测中');
        stEl.classList.toggle('is-live', mode === 'live' || ws.active);
      }
      const foot = $('coldLabFoot');
      if (foot) foot.textContent = mode === 'live' ? '实况快照 · 只读' : '演示数据 · 不影响线上';
      const frameEl = $('coldLabFrame');
      if (frameEl) frameEl.textContent = mode === 'live' ? '实况' : `帧 ${frame + 1}/${demo.hours}`;

      view.setState(mode === 'live' ? (window.COLD_AIR || null) : currentState());
      renderMarks();
      renderVerdict();
      renderFields();
      renderControls();
    }

    function renderMarks() {
      const box = $('coldLabMarks');
      if (!box) return;
      box.innerHTML = (demo.marks || []).map((m, i) => {
        const cls = mode === 'live' ? 'is-past' : (frame > m.frame ? 'is-past' : frame === m.frame ? 'is-on' : '');
        return `<button class="ct-mark ${cls}" type="button" data-mark="${i}"><i>${m.frame}h</i>${m.label}</button>`;
      }).join('');
    }

    function renderVerdict() {
      const list = $('coldLabVerdict');
      const checks = $('coldLabChecks');
      const note = $('coldLabNote');
      if (!list || !checks) return;
      const ws = widgetState();
      const st = ws.st;
      const gatePassed = Object.keys(GATE_STATIONS).filter((ad) => ws.gate[ad] && ws.gate[ad].passed).length;
      const arrived = Object.values(ws.cities).filter((c) => c.status === 'arrived').length;
      const rows = st ? [
        ['事件状态', ws.active ? '进行中' : '监测中'],
        ['过程开启', fmtTime(ws.event.openedAt)],
        ['南岭关口', `${gatePassed}/4`],
        ['已转蓝', `${arrived}/${total}`],
        ['预计关闭', fmtTime(ws.event.closesAt)],
      ] : [['数据', mode === 'live' ? '实况快照未就绪' : '演示数据未就绪']];
      list.innerHTML = rows.map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');

      if (mode === 'live') {
        checks.innerHTML = '<span class="ct-check">实况只读</span>';
      } else {
        const ad = selectedAd();
        const city = ws.cities[ad];
        const name = (cityMeta.get(ad) || {}).short || ad;
        const arr = series[ad] || [];
        const idx = Math.min(frame, arr.length - 1);
        const s = arr.length ? runStart(arr, idx) : -1;
        const northH = s >= 0 ? idx - s + 1 : 0;
        let steady = s >= 0;
        if (steady) {
          for (let k = s + 1; k <= idx; k++) {
            if (arr[k].temp == null || arr[k - 1].temp == null || arr[k].temp > arr[k - 1].temp + 0.05) {
              steady = false;
              break;
            }
          }
        }
        const steadyH = steady ? idx - s + 1 : 0;
        const base = s > 0 ? arr[s - 1] : null;
        const hasBase = !!(base && base.temp != null && arr[idx] && arr[idx].temp != null);
        const drop = hasBase ? round1(base.temp - arr[idx].temp) : 0;
        // 无连续北风时规则不建立基准，改显示「相对演示原始值」或近 3h 的观测变化，避免误报为 0
        const orig = (baseSeries[ad] || [])[idx];
        const manual = orig && orig.temp != null && arr[idx] && arr[idx].temp != null ? round1(orig.temp - arr[idx].temp) : 0;
        const natural = idx >= 3 && arr[idx - 3] && arr[idx - 3].temp != null && arr[idx].temp != null
          ? round1(arr[idx - 3].temp - arr[idx].temp) : 0;
        const observed = Math.abs(manual) >= 0.1 ? manual : natural;
        const need = GATE_STATIONS[ad] ? CFG.gateDrop : CFG.cityDrop;
        const kind = arr.slice(Math.max(0, s), idx + 1).reduce((sum, x) => sum + (x.rain || 0), 0) >= 0.1 ? '锋面型' : '干冷';
        const dropLabel = hasBase
          ? `降温 ${drop}℃ / ≥${need}℃`
          : observed >= 0 ? `降温 ${observed}℃ · 待北风` : `升温 ${Math.abs(observed)}℃ · 待北风`;
        checks.innerHTML = [
          [`${name} 北风 ${northH}h / 3h`, northH >= CFG.windHours],
          [`不回升 ${steadyH}h / 4h`, steadyH >= CFG.tempHours],
          [dropLabel, hasBase && drop >= need],
          [`${kind}${city && city.status === 'arrived' ? ' · 已转蓝' : ''}`, !!(city && city.status === 'arrived')],
        ].map(([label, ok]) => `<span class="ct-check${ok ? ' is-ok' : ''}">${label}</span>`).join('');
      }

      if (note) {
        note.textContent = mode === 'live'
          ? '实况数据只读；切回演示可继续回放与微调'
          : `由 cold-air-engine.js 逐帧重算${span === demo.hours ? ' · 与线上判定一致' : ` · 输入窗口 ${span}h`}`;
      }
    }

    function renderFields() {
      const ad = selectedAd();
      const arr = series[ad] || [];
      const idx = Math.min(frame, arr.length - 1);
      const cur = mode === 'live' ? null : arr[idx];
      const fields = [
        ['coldLabTemp', 'coldLabTempVal', cur && cur.temp != null ? cur.temp : 20,
          cur && cur.temp != null ? `${cur.temp.toFixed(1)}℃` : '—'],
        ['coldLabDir', 'coldLabDirVal', cur && cur.dir != null ? cur.dir : 180,
          cur && cur.dir != null ? `${Math.round(cur.dir)}° ${windText(cur.dir)}` : '—'],
        ['coldLabSpd', 'coldLabSpdVal', cur && cur.spd != null ? cur.spd : 3,
          cur && cur.spd != null ? `${cur.spd.toFixed(1)} m/s · ${windLevel(cur.spd)}级` : '—'],
        ['coldLabRain', 'coldLabRainVal', cur && cur.rain != null ? cur.rain : 0,
          cur && cur.rain != null ? `${cur.rain.toFixed(1)} mm` : '—'],
      ];
      for (const [inputId, valId, value, text] of fields) {
        const input = $(inputId);
        const val = $(valId);
        if (input) input.value = String(value);
        if (val) val.textContent = text;
      }
    }

    function renderControls() {
      const live = mode === 'live';
      const range = $('coldLabRange');
      if (range) {
        range.disabled = live;
        range.value = String(frame);
      }
      for (const id of ['coldLabPrev', 'coldLabNext', 'coldLabSpeed']) {
        const el = $(id);
        if (el) el.disabled = live;
      }
      for (const id of ['coldLabTemp', 'coldLabDir', 'coldLabSpd', 'coldLabRain', 'coldLabCity', 'coldLabReset', 'coldLabClear']) {
        const el = $(id);
        if (el) el.disabled = live;
      }
      const liveBtn = $('coldLabLive');
      if (liveBtn) liveBtn.textContent = live ? '返回演示' : '回到实况';
      if (live) stopPlay();
      const play = $('coldLabPlay');
      if (play) play.disabled = live;
      for (const btn of document.querySelectorAll('#coldLabSpan button')) {
        btn.classList.toggle('is-on', Number(btn.dataset.span) === span);
        btn.disabled = live;
      }
    }

    function applyChange(key, raw) {
      if (mode !== 'demo') return;
      const ad = selectedAd();
      const arr = series[ad];
      if (!arr || !arr[frame]) return;
      if (key === 'temp') {
        const delta = round1(raw - arr[frame].temp);
        for (let i = frame; i < arr.length; i++) {
          arr[i].temp = arr[i].temp == null ? raw : clamp(round1(arr[i].temp + delta), -20, 45);
        }
      } else if (key === 'dir') {
        const dir = raw >= 360 ? 0 : Math.round(raw);
        for (let i = frame; i < arr.length; i++) arr[i].dir = dir;
      } else {
        const v = round1(raw);
        for (let i = frame; i < arr.length; i++) arr[i][key] = v;
      }
      invalidate(frame);
      renderFrame();
    }

    function resetStation() {
      const ad = selectedAd();
      series[ad] = clone(baseSeries[ad]);
      invalidate(frame);
      renderFrame();
    }

    function clearAll() {
      series = clone(baseSeries);
      invalidate(frame);
      renderFrame();
    }

    function setMode(next) {
      mode = next;
      stopPlay();
      if (mode === 'demo') {
        states = [];
        buildThrough(frame);
      }
      renderFrame();
    }

    function setSpan(next) {
      if (mode !== 'demo') return;
      span = next;
      states = [];
      buildThrough(frame);
      renderFrame();
    }

    function openPanel() {
      panelEl.classList.add('is-mounted');
      panelEl.setAttribute('aria-hidden', 'false');
      launchEl.classList.add('is-on');
      launchEl.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => {
        panelEl.classList.add('is-open');
        const body = panelEl.querySelector('.ct-body');
        if (body) body.scrollTop = panelScroll;
      });
      renderFrame();
    }

    function closePanel() {
      stopPlay();
      const body = panelEl.querySelector('.ct-body');
      if (body) panelScroll = body.scrollTop;
      // 关闭只收起面板，保留当前演示状态，方便在手机上直接看首页卡的结果
      panelEl.classList.remove('is-open');
      panelEl.setAttribute('aria-hidden', 'true');
      launchEl.classList.remove('is-on');
      launchEl.setAttribute('aria-expanded', 'false');
      setTimeout(() => {
        if (!panelEl.classList.contains('is-open')) panelEl.classList.remove('is-mounted');
      }, 300);
    }

    const citySel = $('coldLabCity');
    if (citySel) {
      citySel.innerHTML = adcodes.map((ad) => {
        const name = (cityMeta.get(ad) || {}).short || ad;
        return `<option value="${ad}">${name}${GATE_STATIONS[ad] ? '（关口）' : ''}</option>`;
      }).join('');
      if (series['440100']) citySel.value = '440100';
      citySel.addEventListener('change', () => {
        renderFields();
        renderVerdict();
      });
    }

    const range = $('coldLabRange');
    if (range) {
      range.max = String(lastFrame);
      range.addEventListener('input', () => {
        if (mode !== 'demo') return;
        stopPlay();
        setFrame(Number(range.value));
      });
    }

    const playBtn = $('coldLabPlay');
    if (playBtn) playBtn.addEventListener('click', () => {
      if (mode !== 'demo') return;
      if (timer) stopPlay();
      else startPlay();
    });

    const prevBtn = $('coldLabPrev');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      stopPlay();
      setFrame(frame - 1);
    });
    const nextBtn = $('coldLabNext');
    if (nextBtn) nextBtn.addEventListener('click', () => {
      stopPlay();
      setFrame(frame + 1);
    });

    const speedBtn = $('coldLabSpeed');
    if (speedBtn) speedBtn.addEventListener('click', () => {
      speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
      speedBtn.textContent = `${speed}×`;
      if (timer) startPlay();
    });

    const marks = $('coldLabMarks');
    if (marks) marks.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-mark]');
      if (!btn) return;
      const mark = (demo.marks || [])[Number(btn.dataset.mark)];
      if (!mark) return;
      stopPlay();
      if (mode !== 'demo') setMode('demo');
      setFrame(mark.frame);
    });

    const bindings = [
      ['coldLabTemp', 'temp'],
      ['coldLabDir', 'dir'],
      ['coldLabSpd', 'spd'],
      ['coldLabRain', 'rain'],
    ];
    for (const [id, key] of bindings) {
      const input = $(id);
      if (input) input.addEventListener('input', () => applyChange(key, Number(input.value)));
    }

    const resetBtn = $('coldLabReset');
    if (resetBtn) resetBtn.addEventListener('click', resetStation);
    const clearBtn = $('coldLabClear');
    if (clearBtn) clearBtn.addEventListener('click', clearAll);

    const spanBox = $('coldLabSpan');
    if (spanBox) spanBox.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-span]');
      if (btn) setSpan(Number(btn.dataset.span));
    });

    const liveBtn = $('coldLabLive');
    if (liveBtn) liveBtn.addEventListener('click', () => setMode(mode === 'live' ? 'demo' : 'live'));

    launchEl.addEventListener('click', () => {
      if (panelEl.classList.contains('is-open')) closePanel();
      else openPanel();
    });
    const closeBtn = $('coldLabClose');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && panelEl.classList.contains('is-open')) closePanel();
    });

    buildThrough(0);
    launchEl.classList.add('is-ready');
    renderFrame();

    return {
      open: openPanel,
      close: closePanel,
      setFrame,
      getFrame: () => frame,
      setSpan,
      setMode,
      getMode: () => mode,
    };
  }

  boot();
})();
