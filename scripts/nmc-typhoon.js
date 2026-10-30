const { writeJsonAtomic } = require('./fetch-typhoons');

const SOURCE = '中央气象台';
const BASE = 'https://typhoon.nmc.cn/weatherservice/typhoon/jsons/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

function beijingYear() {
  return new Date(Date.now() + 8 * 3600e3).getUTCFullYear();
}

function validYear(value) {
  return /^\d{4}$/.test(String(value)) && Number(value) >= 1949 && Number(value) <= beijingYear();
}

function validId(value) {
  return /^\d{1,10}$/.test(String(value)) && Number(value) > 0;
}

function validKey(kind, key) {
  return kind === 'list' ? validYear(key) : kind === 'detail' && validId(key);
}

function parseJsonp(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 8e6) throw new Error('中央气象台响应为空或过大');
  const match = /^\s*[A-Za-z_$][\w$]*\s*\(([\s\S]*)\)\s*;?\s*$/.exec(text);
  if (!match) throw new Error('中央气象台响应不是有效 JSONP');
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (e) {
    throw new Error('中央气象台 JSONP 内容无法解析');
  }
  return data;
}

function validPoint(row) {
  return Array.isArray(row) && row.length >= 10
    && Number.isFinite(Number(row[2]))
    && Number.isFinite(Number(row[4])) && Math.abs(Number(row[4])) <= 180
    && Number.isFinite(Number(row[5])) && Math.abs(Number(row[5])) <= 85;
}

function validData(kind, key, data) {
  if (!validKey(kind, key) || !data || typeof data !== 'object') return false;
  if (kind === 'list') {
    return Array.isArray(data.typhoonList) && data.typhoonList.length <= 300
      && data.typhoonList.every((row) => Array.isArray(row) && row.length >= 8 && /^\d{1,10}$/.test(String(row[0])) && (row[7] === 'start' || row[7] === 'stop'));
  }
  const storm = data.typhoon;
  return Array.isArray(storm) && storm.length >= 9 && String(storm[0]) === String(key)
    && Array.isArray(storm[8]) && storm[8].length <= 3000 && storm[8].every(validPoint);
}

async function fetchNmc(kind, key) {
  if (!validKey(kind, key)) throw new Error('非法中央气象台台风参数');
  const endpoint = kind === 'list' ? `list_${key}` : `view_${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const response = await fetch(`${BASE}${endpoint}`, {
      signal: ctrl.signal,
      redirect: 'error',
      headers: { 'User-Agent': UA, Accept: '*/*', Referer: 'https://typhoon.nmc.cn/web.html' },
    });
    if (!response.ok) throw new Error(`中央气象台上游 HTTP ${response.status}`);
    const data = parseJsonp(await response.text());
    if (!validData(kind, key, data)) throw new Error('中央气象台数据结构不符');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { SOURCE, BASE, beijingYear, validYear, validId, validKey, parseJsonp, validData, fetchNmc, writeJsonAtomic };
