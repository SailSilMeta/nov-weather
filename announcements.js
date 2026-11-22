(function () {
  'use strict';

  const DATA_URL = 'data/announcements.json';
  const API = String(window.QXKSH_ANNOUNCE_API || '').replace(/\/+$/, '');
  const MAX_ITEMS = 5;
  const SPEED = 42;

  const bar = document.getElementById('announceBar');
  const viewport = document.getElementById('announceViewport');
  const track = document.getElementById('announceTrack');
  if (!bar || !viewport || !track) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function usable(item) {
    if (!item || typeof item.title !== 'string' || !item.title.trim()) return false;
    if (item.published === false) return false;
    const now = Date.now();
    const start = Date.parse(item.startsAt || '');
    const end = Date.parse(item.endsAt || '');
    if (Number.isFinite(start) && start > now) return false;
    if (Number.isFinite(end) && end <= now) return false;
    return true;
  }

  function sortKey(item) {
    const time = Date.parse(item.startsAt || item.date || '');
    return Number.isFinite(time) ? time : 0;
  }

  function makeItem(item) {
    const safeUrl = typeof item.url === 'string' && /^https?:\/\//i.test(item.url) ? item.url : '';
    const node = document.createElement(safeUrl ? 'a' : 'span');
    node.className = 'announce-item';
    node.textContent = item.title.trim();
    if (safeUrl) {
      node.href = safeUrl;
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
    }
    return node;
  }

  function render(items) {
    track.textContent = '';
    track.classList.remove('is-static');
    for (const item of items) track.appendChild(makeItem(item));
    bar.hidden = false;

    const half = track.scrollWidth;
    const needLoop = Number.isFinite(half) && half > viewport.clientWidth + 8;
    if (!needLoop || reduceMotion.matches) {
      if (reduceMotion.matches) track.classList.add('is-static');
      return;
    }

    for (const item of items) {
      const dup = makeItem(item);
      dup.setAttribute('aria-hidden', 'true');
      if (dup.tagName === 'A') dup.tabIndex = -1;
      track.appendChild(dup);
    }
    const duration = Math.max(12, Math.round(half / SPEED));
    track.style.setProperty('--announce-duration', `${duration}s`);
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { cache: 'no-cache', credentials: 'omit', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function load() {
    let data = null;
    if (API) {
      try {
        data = await fetchJson(`${API}/api/announcements`);
      } catch (error) {
        /* 接口不可用时回落静态快照 */
      }
    }
    if (!data || !Array.isArray(data.items)) {
      try {
        data = await fetchJson(DATA_URL);
      } catch (error) {
        return;
      }
    }
    if (!data || !Array.isArray(data.items)) return;
    const items = data.items
      .filter(usable)
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || sortKey(b) - sortKey(a))
      .slice(0, MAX_ITEMS);
    if (!items.length) return;
    render(items);
  }

  let resumeTimer = 0;
  function pause() {
    clearTimeout(resumeTimer);
    bar.classList.add('is-paused');
  }
  function resume() {
    clearTimeout(resumeTimer);
    bar.classList.remove('is-paused');
  }
  function resumeLater() {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(resume, 2500);
  }

  bar.addEventListener('touchstart', pause, { passive: true });
  bar.addEventListener('touchend', resumeLater, { passive: true });
  bar.addEventListener('touchcancel', resumeLater, { passive: true });
  bar.addEventListener('focusin', pause);
  bar.addEventListener('focusout', resume);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else resume();
  });

  load();
})();