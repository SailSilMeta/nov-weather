(function () {
  'use strict';

  const DATA_URL = 'data/announcements.json';
  const API = String(window.QXKSH_ANNOUNCE_API || '').replace(/\/+$/, '');
  const MAX_ITEMS = 5;
  const SPEED = 50;

  const bar = document.getElementById('announceBar');
  const viewport = document.getElementById('announceViewport');
  const track = document.getElementById('announceTrack');
  if (!bar || !viewport || !track) return;

  const modal = document.getElementById('announceModal');
  const card = modal ? modal.querySelector('.announce-card') : null;
  const cardBody = document.getElementById('announceBody');
  const closeBtn = document.getElementById('announceClose');
  const mask = modal ? modal.querySelector('[data-announce-close]') : null;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let currentItems = [];
  let lastFocus = null;
  let openedWithKeyboard = false;

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

  function safeUrl(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '';
  }

  function formatTime(item) {
    const time = Date.parse(item.startsAt || item.createdAt || item.date || '');
    if (!Number.isFinite(time)) return '';
    const date = new Date(time);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function appendRichText(target, text) {
    const value = typeof text === 'string' ? text : '';
    const re = /\[c=(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))\]([\s\S]*?)\[\/c\]/g;
    let last = 0;
    let match;
    while ((match = re.exec(value))) {
      if (match.index > last) target.appendChild(document.createTextNode(value.slice(last, match.index)));
      const span = document.createElement('span');
      span.style.color = match[1];
      span.textContent = match[2];
      target.appendChild(span);
      last = re.lastIndex;
    }
    if (last < value.length) target.appendChild(document.createTextNode(value.slice(last)));
    return target;
  }

  function makeItem(item) {
    const node = document.createElement('span');
    node.className = 'announce-item';
    const text = document.createElement('span');
    text.className = 'announce-item-text';
    appendRichText(text, item.title.trim());
    node.appendChild(text);
    return node;
  }

  function render(items) {
    currentItems = items;
    track.textContent = '';
    track.classList.remove('is-static');
    bar.classList.remove('is-static');
    for (const item of items) track.appendChild(makeItem(item));
    bar.hidden = false;

    const half = track.scrollWidth;
    const needLoop = Number.isFinite(half) && half > viewport.clientWidth + 8;
    const isStatic = !needLoop || reduceMotion.matches;
    bar.classList.toggle('is-static', isStatic);
    track.classList.toggle('is-static', isStatic);
    if (isStatic) return;

    for (const item of items) {
      const dup = makeItem(item);
      dup.setAttribute('aria-hidden', 'true');
      track.appendChild(dup);
    }
    const duration = Math.max(12, Math.round(half / SPEED / 0.92));
    track.style.setProperty('--announce-duration', `${duration}s`);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function svgPath(d, className) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    if (className) svg.classList.add(className);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  function renderList() {
    cardBody.textContent = '';
    const list = el('div', 'announce-list');

    currentItems.forEach((item, index) => {
      const row = el('button', 'announce-row');
      row.type = 'button';

      const main = el('span', 'announce-row-main');
      const title = el('span', 'announce-row-title');
      appendRichText(title, item.title.trim());
      main.appendChild(title);

      const meta = el('span', 'announce-row-meta');
      if (item.pinned) meta.appendChild(el('span', 'announce-badge', '置顶'));
      const time = formatTime(item);
      if (time) meta.appendChild(el('span', null, time));
      if (meta.childNodes.length) main.appendChild(meta);

      row.appendChild(main);
      row.appendChild(svgPath('M6 3.5 10.5 8 6 12.5', 'announce-chevron'));
      row.addEventListener('click', () => renderDetail(index));
      list.appendChild(row);
    });

    cardBody.appendChild(list);
    cardBody.scrollTop = 0;
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  }

  function renderDetail(index) {
    const item = currentItems[index];
    if (!item) return;
    cardBody.textContent = '';

    const detail = el('div', 'announce-detail');

    const back = el('button', 'announce-back');
    back.type = 'button';
    back.appendChild(svgPath('M10 3.5 5.5 8 10 12.5'));
    back.appendChild(el('span', 'announce-back-label', '返回列表'));
    back.addEventListener('click', renderList);
    detail.appendChild(back);

    const heading = el('h3');
    appendRichText(heading, item.title.trim());
    detail.appendChild(heading);

    const meta = el('div', 'announce-detail-meta');
    if (item.pinned) meta.appendChild(el('span', 'announce-badge', '置顶'));
    const time = formatTime(item);
    if (time) meta.appendChild(el('span', null, time));
    if (meta.childNodes.length) detail.appendChild(meta);

    const body = typeof item.body === 'string' ? item.body.trim() : '';
    if (body) {
      const text = el('p', 'announce-detail-text');
      appendRichText(text, body);
      detail.appendChild(text);
    } else {
      detail.appendChild(el('p', 'announce-detail-text is-empty', '暂无更多内容。'));
    }

    const url = safeUrl(item.url);
    if (url) {
      const link = el('a', 'announce-link');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.appendChild(document.createTextNode('查看相关链接'));
      link.appendChild(svgPath('M6 3.5 10.5 8 6 12.5'));
      detail.appendChild(link);
    }

    cardBody.appendChild(detail);
    cardBody.scrollTop = 0;
    back.focus({ preventScroll: true });
  }

  function openModal() {
    if (!modal || !cardBody || !currentItems.length || !modal.hidden) return;
    lastFocus = document.activeElement;
    modal.hidden = false;
    bar.setAttribute('aria-expanded', 'true');
    pause();
    renderList();
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    bar.setAttribute('aria-expanded', 'false');
    cardBody.textContent = '';
    resume();

    const target = lastFocus;
    lastFocus = null;
    if (openedWithKeyboard && target && typeof target.focus === 'function') {
      target.focus({ preventScroll: true });
    }
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

  bar.addEventListener('click', () => {
    openedWithKeyboard = false;
    openModal();
  });
  bar.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    event.preventDefault();
    openedWithKeyboard = true;
    openModal();
  });

  bar.addEventListener('touchstart', pause, { passive: true });
  bar.addEventListener('touchend', resumeLater, { passive: true });
  bar.addEventListener('touchcancel', resumeLater, { passive: true });
  bar.addEventListener('focusin', pause);
  bar.addEventListener('focusout', resume);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else resume();
  });

  if (modal && card && cardBody) {
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (mask) mask.addEventListener('click', closeModal);

    modal.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusables = card.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) {
        event.preventDefault();
        closeModal();
      }
    });
  }

  load();
})();