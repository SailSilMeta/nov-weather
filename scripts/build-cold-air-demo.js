const fs = require('fs');
const path = require('path');
const { buildState, toKey } = require('../cold-air-engine');

const OUT = path.join(__dirname, '..', 'data', 'cold-air-demo.js');
const START = '2026-11-18T00:00';
const HOURS = 60;

// 合成一场自北向南的冷空气过程：南岭四站先达标，随后城市依次转蓝，最后满 24h 关闭
const PLAN = {
  440200: { name: '韶关', base: 18.0, from: 6, rate: 1.2, gate: true },
  441800: { name: '清远', base: 19.5, from: 7, rate: 1.0, gate: true },
  441400: { name: '梅州', base: 20.5, from: 9, rate: 1.1, gate: true },
  441600: { name: '河源', base: 20.0, from: 9, rate: 1.2, gate: true },
  440100: { name: '广州', base: 23.0, from: 13, rate: 1.1, rain: true },
  440600: { name: '佛山', base: 22.8, from: 13, rate: 1.1, rain: true },
  441900: { name: '东莞', base: 23.2, from: 14, rate: 1.0, rain: true },
  442000: { name: '中山', base: 23.4, from: 15, rate: 1.0, rain: true },
  440700: { name: '江门', base: 23.5, from: 15, rate: 1.0 },
  440400: { name: '珠海', base: 23.6, from: 16, rate: 1.0 },
  440300: { name: '深圳', base: 23.8, from: 16, rate: 0.9 },
  441300: { name: '惠州', base: 22.8, from: 17, rate: 1.0 },
  441200: { name: '肇庆', base: 22.4, from: 17, rate: 1.1 },
  445300: { name: '云浮', base: 22.2, from: 18, rate: 1.1 },
  445100: { name: '潮州', base: 22.2, from: 19, rate: 1.0 },
  445200: { name: '揭阳', base: 22.4, from: 19, rate: 1.0 },
  440500: { name: '汕头', base: 22.6, from: 20, rate: 0.9 },
  441500: { name: '汕尾', base: 23.0, from: 20, rate: 0.9 },
  441700: { name: '阳江', base: 23.8, from: 21, rate: 0.9 },
  440900: { name: '茂名', base: 24.2, from: 22, rate: 0.9 },
  440800: { name: '湛江', base: 24.5, from: 23, rate: 0.9 },
};

const hourKey = (h) => {
  const ms = Date.parse(`${START}:00+08:00`) + h * 3600e3;
  return new Date(ms + 8 * 3600e3).toISOString().slice(0, 16);
};

function sampleFor(plan, h) {
  if (h < plan.from) {
    return { t: hourKey(h), temp: Math.round((plan.base + (h % 2 ? 0.2 : 0)) * 10) / 10, dir: 172 + (h % 3) * 4, spd: 2.4 + (h % 3) * 0.4, rain: 0 };
  }
  const cold = Math.min((h - plan.from + 1) * plan.rate, 8.6);
  const temp = Math.round((plan.base - cold + (h > 40 ? (h - 40) * 0.1 : 0)) * 10) / 10;
  const dir = h <= 36 ? 350 + (h % 3 - 1) * 6 : 88 + (h % 2) * 4;
  const spd = h <= 36 ? 4.2 + (h % 3) * 0.5 : 2.6;
  const raining = plan.rain && h >= plan.from && h <= plan.from + 3;
  return { t: hourKey(h), temp, dir, spd, rain: raining ? 0.6 : 0 };
}

const series = {};
for (const [ad, plan] of Object.entries(PLAN)) {
  series[ad] = Array.from({ length: HOURS }, (_, h) => sampleFor(plan, h));
}

// 逐帧跑引擎，标出关键节点
let prev = {};
let wasActive = false;
const marks = [];
let hit = {};
for (let f = 0; f < HOURS; f++) {
  const sliced = {};
  for (const ad of Object.keys(series)) sliced[ad] = series[ad].slice(0, f + 1);
  const state = buildState(sliced, prev);
  prev = state;

  if (!hit.gate && state.stats.gatePassed >= 1) { hit.gate = 1; marks.push({ frame: f, label: '南岭首站达标' }); }
  if (!hit.open && state.event.status === 'active') { hit.open = 1; marks.push({ frame: f, label: '四站达标 · 过程开启' }); }
  if (!hit.first && state.stats.arrived >= 1) { hit.first = 1; marks.push({ frame: f, label: '首个城市转蓝' }); }
  if (!hit.all && state.stats.arrived === Object.keys(series).length) { hit.all = 1; marks.push({ frame: f, label: '全部城市抵达' }); }
  if (wasActive && state.event.status !== 'active') { marks.push({ frame: f, label: '满 24h · 过程关闭' }); wasActive = false; }
  if (state.event.status === 'active') wasActive = true;
  if (f === HOURS - 1) {
    console.log(`end: status=${state.event.status} closedAt=${state.closedAt} arrived=${state.stats.arrived}`);
  }
}

const demo = {
  title: '合成冷空气过程演示',
  startAt: START,
  hours: HOURS,
  marks,
  series,
};
fs.writeFileSync(OUT, `window.COLD_AIR_DEMO = ${JSON.stringify(demo)};\n`);
console.log(`marks: ${marks.map((m) => `${m.frame}h ${m.label}`).join(' | ')}`);
console.log(`demo ${HOURS}h, ${Object.keys(series).length} cities, ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
