(function () {
  'use strict';

  var STORE_BASE = 'qxksh.announce.admin.base';
  var STORE_TOKEN = 'qxksh.announce.admin.token';
  var MIN_TOKEN = 16;

  var ERROR_TEXT = {
    unauthorized: '口令不正确，或云函数没有配置 ANNOUNCE_ADMIN_TOKEN（至少 16 位）',
    pg_not_configured: '云函数还没有配置 PostgreSQL 环境变量（PG_CONNECTION_STRING 或 PG_HOST 等）',
    db_error: '数据库执行失败：确认 announcements 表已创建、连接信息与私有网络正确',
    invalid_body: '请求内容不是有效的 JSON',
    invalid_title: '标题不能为空，且不超过 120 字',
    invalid_text: '正文不超过 2000 字',
    invalid_url: '链接需以 http:// 或 https:// 开头，且不超过 500 字',
    invalid_time: '时间格式无法识别',
    invalid_time_range: '结束时间必须晚于开始时间',
    not_found: '公告不存在，或已被删除',
    method_not_allowed: '接口不支持该请求方法',
  };

  var els = {
    connectForm: document.getElementById('connectForm'),
    apiBase: document.getElementById('apiBase'),
    adminToken: document.getElementById('adminToken'),
    connectBtn: document.getElementById('connectBtn'),
    connectStatus: document.getElementById('connectStatus'),
    listCard: document.getElementById('listCard'),
    itemList: document.getElementById('itemList'),
    itemCount: document.getElementById('itemCount'),
    refreshBtn: document.getElementById('refreshBtn'),
    createBtn: document.getElementById('createBtn'),
    dialog: document.getElementById('editorDialog'),
    editorForm: document.getElementById('editorForm'),
    editorTitle: document.getElementById('editorTitle'),
    fTitle: document.getElementById('fTitle'),
    fBody: document.getElementById('fBody'),
    fLevel: document.getElementById('fLevel'),
    fUrl: document.getElementById('fUrl'),
    fStartsAt: document.getElementById('fStartsAt'),
    fEndsAt: document.getElementById('fEndsAt'),
    fPinned: document.getElementById('fPinned'),
    fPublished: document.getElementById('fPublished'),
    editorStatus: document.getElementById('editorStatus'),
    saveBtn: document.getElementById('saveBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    editorClose: document.getElementById('editorClose'),
    swatchList: document.getElementById('swatchList'),
    customColor: document.getElementById('customColor'),
    clearColor: document.getElementById('clearColor'),
    colorPreview: document.getElementById('colorPreview'),
  };

  if (!els.connectForm || !els.dialog) return;

  var state = { base: '', token: '', items: [], editingId: null, colorField: null };

  var PRESET_COLORS = [
    { color: '#d33b3b', name: '红色' },
    { color: '#e07b12', name: '橙色' },
    { color: '#b48910', name: '金色' },
    { color: '#2c7a45', name: '绿色' },
    { color: '#1f6fae', name: '蓝色' },
    { color: '#7048c8', name: '紫色' },
    { color: '#b0306e', name: '玫红' },
    { color: '#14303f', name: '深灰' },
  ];

  function readStore(key) {
    try {
      return sessionStorage.getItem(key) || '';
    } catch (error) {
      return '';
    }
  }

  function writeStore(key, value) {
    try {
      if (value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
    } catch (error) {
      /* 隐私模式下忽略 */
    }
  }

  function normalizeBase(raw) {
    var base = String(raw || '').trim().replace(/\/+$/, '').replace(/\/api$/i, '');
    if (!base) throw new Error('请填写 CloudBase HTTP 访问服务地址');
    if (!/^https?:\/\//i.test(base)) throw new Error('接口地址需以 http:// 或 https:// 开头');
    return base;
  }

  function setConnectStatus(message, isError) {
    els.connectStatus.textContent = message || '';
    els.connectStatus.classList.toggle('error', Boolean(isError));
  }

  function setEditorStatus(message, isError) {
    if (!message) {
      els.editorStatus.hidden = true;
      els.editorStatus.textContent = '';
      return;
    }
    els.editorStatus.hidden = false;
    els.editorStatus.textContent = message;
    els.editorStatus.classList.toggle('error', Boolean(isError));
  }

  async function request(path, options) {
    var opts = options || {};
    var headers = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    headers.Authorization = 'Bearer ' + state.token;

    var response;
    try {
      response = await fetch(state.base + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch (error) {
      throw new Error('无法连接接口地址：检查地址是否正确、HTTP 访问服务是否已发布');
    }

    var text = await response.text();
    var payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        payload = null;
      }
    }

    if (!response.ok) {
      var code = payload && payload.error ? String(payload.error) : '';
      if (response.status === 401 && !code) code = 'unauthorized';
      throw new Error(ERROR_TEXT[code] || '接口返回 HTTP ' + response.status);
    }
    if (!payload) throw new Error('接口返回的不是 JSON，确认地址映射到了云函数');
    return payload;
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function formatTime(iso) {
    var date = new Date(iso);
    if (!iso || isNaN(date.getTime())) return '—';
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function timeRange(item) {
    if (!item.startsAt && !item.endsAt) return '长期有效';
    if (item.startsAt && !item.endsAt) return formatTime(item.startsAt) + ' 起';
    if (!item.startsAt && item.endsAt) return '至 ' + formatTime(item.endsAt);
    return formatTime(item.startsAt) + ' → ' + formatTime(item.endsAt);
  }

  function toLocalInput(iso) {
    if (!iso) return '';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function fromLocalInput(value) {
    if (!value) return null;
    var date = new Date(value);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  function appendRichText(target, text) {
    var value = typeof text === 'string' ? text : '';
    var re = /\[c=(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))\]([\s\S]*?)\[\/c\]/g;
    var last = 0;
    var match;
    while ((match = re.exec(value))) {
      if (match.index > last) target.appendChild(document.createTextNode(value.slice(last, match.index)));
      var span = document.createElement('span');
      span.style.color = match[1];
      span.textContent = match[2];
      target.appendChild(span);
      last = re.lastIndex;
    }
    if (last < value.length) target.appendChild(document.createTextNode(value.slice(last)));
    return target;
  }

  function stripColors(text) {
    var value = String(text == null ? '' : text);
    var re = /\[c=#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\]([\s\S]*?)\[\/c\]/g;
    var next = value.replace(re, '$1');
    while (next !== value) {
      value = next;
      next = value.replace(re, '$1');
    }
    return value
      .replace(/\[c=#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\]/g, '')
      .replace(/\[\/c\]/g, '');
  }

  function colorRuns(text) {
    var re = /\[c=#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\]|\[\/c\]/g;
    var stack = [];
    var runs = [];
    var match;
    while ((match = re.exec(text))) {
      if (match[0] === '[/c]') {
        var open = stack.pop();
        if (open) runs.push({ start: open.start, end: re.lastIndex });
      } else {
        stack.push({ start: match.index, end: re.lastIndex });
      }
    }
    return runs;
  }

  function expandSelection(text, start, end) {
    var s = start;
    var e = end;
    var changed = true;
    while (changed) {
      changed = false;
      var runs = colorRuns(text);
      for (var i = 0; i < runs.length; i += 1) {
        var run = runs[i];
        if (s >= run.end || e <= run.start) continue;
        if (s > run.start) { s = run.start; changed = true; }
        if (e < run.end) { e = run.end; changed = true; }
      }
    }
    return { start: s, end: e };
  }

  function updatePreview() {
    if (!els.colorPreview) return;
    var title = els.fTitle.value.trim();
    var body = els.fBody.value.trim();
    els.colorPreview.textContent = '';
    if (!title && !body) return;

    function previewLine(labelText, value) {
      var row = document.createElement('div');
      var label = document.createElement('span');
      label.className = 'preview-label';
      label.textContent = labelText;
      row.appendChild(label);
      appendRichText(row, value);
      return row;
    }

    if (title) els.colorPreview.appendChild(previewLine('标题', title));
    if (body) els.colorPreview.appendChild(previewLine('正文', body));
  }

  function applyColor(color) {
    var field = state.colorField || els.fTitle;
    if (document.activeElement === field) {
      state.selStart = field.selectionStart;
      state.selEnd = field.selectionEnd;
    }
    var text = field.value;
    var start = Math.min(state.selStart || 0, text.length);
    var end = Math.min(Math.max(state.selEnd || 0, start), text.length);

    if (start === end) {
      if (color) {
        setEditorStatus('先在标题或正文里选中要上色的文字，再点色块', true);
        return;
      }
      start = 0;
      end = text.length;
    }
    if (start === end) return;

    var range = expandSelection(text, start, end);
    var inner = stripColors(text.slice(range.start, range.end));
    var open = color ? '[c=' + color + ']' : '';
    var next = text.slice(0, range.start) + open + inner + (color ? '[/c]' : '') + text.slice(range.end);
    var limit = field.maxLength;
    if (limit > 0 && next.length > limit) {
      setEditorStatus('加上颜色标记后超过 ' + limit + ' 字上限，请缩短文字后再试', true);
      return;
    }

    field.value = next;
    var caret = range.start + open.length;
    field.setSelectionRange(caret, caret + inner.length);
    state.selStart = caret;
    state.selEnd = caret + inner.length;
    field.focus();
    updatePreview();
    setEditorStatus('');
  }

  function buildPalette() {
    if (!els.swatchList) return;
    PRESET_COLORS.forEach(function (preset) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch';
      btn.style.setProperty('--swatch', preset.color);
      btn.title = preset.name;
      btn.setAttribute('aria-label', '设为' + preset.name);
      btn.addEventListener('click', function () {
        applyColor(preset.color);
      });
      els.swatchList.appendChild(btn);
    });
  }

  function trackSelection(field) {
    state.colorField = field;
    state.selStart = field.selectionStart;
    state.selEnd = field.selectionEnd;
  }

  function statusOf(item) {
    var now = Date.now();
    if (!item.published) return { label: '已下线', cls: 'off' };
    if (item.startsAt && Date.parse(item.startsAt) > now) return { label: '未开始', cls: 'warn' };
    if (item.endsAt && Date.parse(item.endsAt) <= now) return { label: '已结束', cls: 'off' };
    return { label: '有效', cls: 'on' };
  }

  function badge(text, cls) {
    var node = document.createElement('span');
    node.className = 'badge' + (cls ? ' ' + cls : '');
    node.textContent = text;
    return node;
  }

  function metaLine(text) {
    var node = document.createElement('div');
    node.textContent = text;
    return node;
  }

  function renderItem(item) {
    var card = document.createElement('div');
    card.className = 'item';

    var head = document.createElement('div');
    head.className = 'item-head';
    var title = document.createElement('div');
    title.className = 'item-title';
    appendRichText(title, item.title);
    head.appendChild(title);
    card.appendChild(head);

    var badges = document.createElement('div');
    badges.className = 'badges';
    var status = statusOf(item);
    badges.appendChild(badge(status.label, status.cls));
    if (item.pinned) badges.appendChild(badge('置顶', 'pin'));
    if (item.level === 'warning') badges.appendChild(badge('提醒', 'warn'));
    if (item.url) badges.appendChild(badge('含链接'));
    card.appendChild(badges);

    var meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.appendChild(metaLine('时间：' + timeRange(item)));
    if (item.body) {
      var plainBody = stripColors(item.body);
      meta.appendChild(metaLine('正文：' + (plainBody.length > 60 ? plainBody.slice(0, 60) + '…' : plainBody)));
    }
    if (item.url) meta.appendChild(metaLine('链接：' + item.url));
    meta.appendChild(metaLine('更新：' + formatTime(item.updatedAt || item.createdAt)));
    card.appendChild(meta);

    var actions = document.createElement('div');
    actions.className = 'item-actions';
    var edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'ghost';
    edit.textContent = '编辑';
    edit.dataset.action = 'edit';
    edit.dataset.id = item.id;
    actions.appendChild(edit);
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = '删除';
    remove.dataset.action = 'delete';
    remove.dataset.id = item.id;
    actions.appendChild(remove);
    card.appendChild(actions);

    return card;
  }

  function renderList() {
    els.itemList.textContent = '';
    els.itemCount.textContent = '共 ' + state.items.length + ' 条';
    if (!state.items.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '还没有公告，点「新增公告」创建第一条。';
      els.itemList.appendChild(empty);
      return;
    }
    state.items.forEach(function (item) {
      els.itemList.appendChild(renderItem(item));
    });
  }

  async function refreshList(announce) {
    try {
      var payload = await request('/api/announcements/admin');
      state.items = Array.isArray(payload.items) ? payload.items : [];
      renderList();
      if (announce !== false) setConnectStatus('已连接，共 ' + state.items.length + ' 条公告');
      return true;
    } catch (error) {
      setConnectStatus(error.message, true);
      return false;
    }
  }

  async function connect(event) {
    if (event) event.preventDefault();
    var base;
    try {
      base = normalizeBase(els.apiBase.value);
    } catch (error) {
      setConnectStatus(error.message, true);
      return;
    }
    var token = els.adminToken.value.trim();
    if (token.length < MIN_TOKEN) {
      setConnectStatus('管理口令至少 ' + MIN_TOKEN + ' 位，与云函数 ANNOUNCE_ADMIN_TOKEN 保持一致', true);
      return;
    }

    state.base = base;
    state.token = token;
    els.connectBtn.disabled = true;
    setConnectStatus('正在连接…');
    try {
      var payload = await request('/api/announcements/admin');
      state.items = Array.isArray(payload.items) ? payload.items : [];
      writeStore(STORE_BASE, base);
      writeStore(STORE_TOKEN, token);
      els.listCard.hidden = false;
      renderList();
      setConnectStatus('已连接，共 ' + state.items.length + ' 条公告');
    } catch (error) {
      state.base = '';
      state.token = '';
      els.listCard.hidden = true;
      setConnectStatus(error.message, true);
    } finally {
      els.connectBtn.disabled = false;
    }
  }

  function openEditor(item) {
    state.editingId = item ? item.id : null;
    els.editorTitle.textContent = item ? '编辑公告' : '新增公告';
    els.fTitle.value = item ? item.title : '';
    els.fBody.value = item ? item.body || '' : '';
    els.fLevel.value = item && item.level === 'warning' ? 'warning' : 'info';
    els.fUrl.value = item ? item.url || '' : '';
    els.fStartsAt.value = item ? toLocalInput(item.startsAt) : '';
    els.fEndsAt.value = item ? toLocalInput(item.endsAt) : '';
    els.fPinned.checked = item ? Boolean(item.pinned) : false;
    els.fPublished.checked = item ? item.published !== false : true;
    state.colorField = els.fTitle;
    state.selStart = 0;
    state.selEnd = 0;
    updatePreview();
    setEditorStatus('');
    if (typeof els.dialog.showModal === 'function') {
      if (!els.dialog.open) els.dialog.showModal();
    } else {
      els.dialog.setAttribute('open', '');
    }
    els.fTitle.focus();
  }

  function closeEditor() {
    if (typeof els.dialog.close === 'function' && els.dialog.open) els.dialog.close();
    else els.dialog.removeAttribute('open');
    state.editingId = null;
    setEditorStatus('');
  }

  async function saveItem(event) {
    event.preventDefault();
    if (!state.base || !state.token) {
      setEditorStatus('请先在上方连接接口', true);
      return;
    }
    var title = els.fTitle.value.trim();
    var plainTitle = stripColors(title).trim();
    if (!plainTitle) {
      setEditorStatus('标题不能为空', true);
      return;
    }
    if (title.length > els.fTitle.maxLength || els.fBody.value.trim().length > els.fBody.maxLength) {
      setEditorStatus('标题或正文超出字数上限，请缩短后再保存', true);
      return;
    }
    var startsAt = els.fStartsAt.value;
    var endsAt = els.fEndsAt.value;
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      setEditorStatus('结束时间必须晚于开始时间', true);
      return;
    }
    var payload = {
      title: title,
      body: els.fBody.value.trim(),
      level: els.fLevel.value === 'warning' ? 'warning' : 'info',
      url: els.fUrl.value.trim(),
      pinned: els.fPinned.checked,
      published: els.fPublished.checked,
      startsAt: fromLocalInput(startsAt),
      endsAt: fromLocalInput(endsAt),
    };

    els.saveBtn.disabled = true;
    els.cancelBtn.disabled = true;
    if (els.editorClose) els.editorClose.disabled = true;
    setEditorStatus('正在保存…');
    try {
      if (state.editingId) {
        await request('/api/announcements/admin/' + state.editingId, { method: 'PUT', body: payload });
      } else {
        await request('/api/announcements/admin', { method: 'POST', body: payload });
      }
      closeEditor();
      await refreshList(false);
      setConnectStatus('已保存「' + plainTitle + '」');
    } catch (error) {
      setEditorStatus(error.message, true);
    } finally {
      els.saveBtn.disabled = false;
      els.cancelBtn.disabled = false;
      if (els.editorClose) els.editorClose.disabled = false;
    }
  }

  async function deleteItem(item) {
    var plainTitle = stripColors(item.title);
    if (!window.confirm('确定删除「' + plainTitle + '」？删除后无法恢复。')) return;
    try {
      await request('/api/announcements/admin/' + item.id, { method: 'DELETE' });
      await refreshList(false);
      setConnectStatus('已删除「' + plainTitle + '」');
    } catch (error) {
      setConnectStatus(error.message, true);
    }
  }

  function wireColorField(field) {
    ['focus', 'select', 'mouseup', 'keyup', 'input'].forEach(function (type) {
      field.addEventListener(type, function () {
        trackSelection(field);
      });
    });
    field.addEventListener('input', updatePreview);
  }

  function captureSelection() {
    if (state.colorField) trackSelection(state.colorField);
  }

  buildPalette();
  wireColorField(els.fTitle);
  wireColorField(els.fBody);
  if (els.swatchList) els.swatchList.addEventListener('mousedown', captureSelection);
  if (els.customColor) {
    els.customColor.addEventListener('mousedown', captureSelection);
    els.customColor.addEventListener('input', function () {
      applyColor(els.customColor.value);
    });
    els.customColor.addEventListener('change', function () {
      applyColor(els.customColor.value);
    });
  }
  if (els.clearColor) {
    els.clearColor.addEventListener('click', function () {
      applyColor('');
    });
  }

  els.connectForm.addEventListener('submit', connect);
  els.refreshBtn.addEventListener('click', function () {
    refreshList(true);
  });
  els.createBtn.addEventListener('click', function () {
    if (!state.base || !state.token) {
      setConnectStatus('请先连接接口', true);
      return;
    }
    openEditor(null);
  });
  els.editorForm.addEventListener('submit', saveItem);
  els.cancelBtn.addEventListener('click', closeEditor);
  if (els.editorClose) els.editorClose.addEventListener('click', closeEditor);
  els.dialog.addEventListener('cancel', function (event) {
    event.preventDefault();
  });
  els.dialog.addEventListener('close', function () {
    state.editingId = null;
    setEditorStatus('');
  });
  els.itemList.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-action]');
    if (!button) return;
    var item = state.items.find(function (row) {
      return row.id === button.dataset.id;
    });
    if (!item) return;
    if (button.dataset.action === 'edit') openEditor(item);
    else if (button.dataset.action === 'delete') deleteItem(item);
  });

  var savedBase = readStore(STORE_BASE) || String(window.QXKSH_ANNOUNCE_API || '').replace(/\/+$/, '');
  var savedToken = readStore(STORE_TOKEN);
  if (savedBase) els.apiBase.value = savedBase;
  if (savedToken) els.adminToken.value = savedToken;
  if (savedBase && savedToken.length >= MIN_TOKEN) connect();
})();