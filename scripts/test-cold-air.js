const assert = require('assert');
const { buildState } = require('../cold-air-engine');

const HOUR = 3600e3;
const start = Date.parse('2026-11-01T00:00:00+08:00');
const key = (h) => new Date(start + (h + 8) * HOUR).toISOString().slice(0, 16);

function makeSeries(temps, dirs, spds, rainFn) {
  return temps.map((temp, i) => ({
    t: key(i),
    temp,
    dir: dirs[i],
    spd: spds[i],
    rain: rainFn ? rainFn(i) : 0,
  }));
}

const flat = (n, v) => Array.from({ length: n }, () => v);
const ramp = (n, from, to) => Array.from({ length: n }, (_, i) => Math.round((from + ((to - from) * i) / (n - 1)) * 10) / 10);

// 11-01 00~23：南岭四站 01 时转北风，04 时累计降温 4.2℃ → 事件 04 时开启
function build(gzFrom = 3, hours = 24) {
  const series = {};
  const gateTemps = [20, 19.6, 18.2, 16.9, 15.8, ...flat(hours - 5, 15.5)].slice(0, hours);
  for (const ad of ['440200', '441800', '441600', '441400']) {
    series[ad] = makeSeries(gateTemps, [190, ...flat(hours - 1, 350)], [3, ...flat(hours - 1, 4)]);
  }
  const gzDirs = [...flat(gzFrom, 180), ...flat(hours - gzFrom, 340)];
  const gzTemps = [25, ...flat(hours - 1, 24.8)];
  // 北风段气温：24.8 → 24.0 → 23.0 → 21.8（第 4 小时累计降 3.0）
  gzTemps[gzFrom + 1] = 24.0;
  gzTemps[gzFrom + 2] = 23.0;
  gzTemps[gzFrom + 3] = 21.8;
  series['440100'] = makeSeries(gzTemps, gzDirs, flat(hours, 3), (i) => (i === gzFrom + 3 ? 1.2 : 0));
  for (const ad of ['440300', '440600', '440500']) {
    series[ad] = makeSeries(ramp(hours, 26, 24), flat(hours, 170), flat(hours, 3));
  }
  return series;
}

// 1) 南岭四站达标 → 开过程，广州随后转蓝，降水标记锋面型
let state = buildState(build(), {});
assert.strictEqual(state.event.status, 'active', 'event should open');
assert.strictEqual(state.openedAt, undefined);
assert.strictEqual(state.event.openedAt, '2026-11-01T04:00');
assert.strictEqual(state.stats.gatePassed, 4);
assert.strictEqual(state.cities['440200'].status, 'arrived', 'gate city itself should be blue');
assert.strictEqual(state.cities['440100'].status, 'arrived', 'guangzhou should turn blue');
assert.strictEqual(state.cities['440100'].at, '2026-11-01T06:00');
assert.strictEqual(state.cities['440100'].red, undefined);
assert.strictEqual(state.cities['440100'].drop, 3);
assert.strictEqual(state.cities['440100'].kind, '锋面型南下');
assert.strictEqual(state.cities['440300'].status, 'pending');
assert.strictEqual(state.event.closesAt, '2026-11-02T06:00');

// 2) 20 小时后数据更新：已转蓝城市即使回暖、转南风也保持蓝色
state = buildState(build(3, 24), state);
assert.strictEqual(state.event.status, 'active', 'still active before 24h close');
assert.strictEqual(state.cities['440100'].status, 'arrived', 'blue is permanent');

// 3) 满 24 小时无新达标 → 过程关闭，所有城市回到灰色
const late = build(3, 32);
for (const ad of Object.keys(late)) {
  for (let h = 24; h < 32; h++) late[ad][h] = { t: key(h), temp: 26, dir: 170, spd: 3, rain: 0 };
}
state = buildState(late, state);
assert.strictEqual(state.event.status, 'watching', 'event should close after 24h');
assert.strictEqual(state.cities['440100'].status, 'pending', 'blue cleared on close');
assert.strictEqual(state.stats.arrived, 0);
assert.strictEqual(state.closedAt, '2026-11-02T06:00');
assert.strictEqual(state.stats.gatePassed, 0, 'gate markers reset on the close frame');
assert.strictEqual(state.gate['440200'].passed, false);

// 4) 关闭后同一批南岭达标数据不得立刻重开
state = buildState(build(3, 32), state);
assert.strictEqual(state.event.status, 'watching', 'no immediate reopen from stale gate data');

// 5) 风向摆动不算稳定偏北风
const swing = build();
for (let h = 1; h <= 5; h++) {
  for (const ad of ['440200', '441800', '441600', '441400']) {
    swing[ad][h].dir = h % 2 ? 350 : 60;
  }
}
assert.strictEqual(buildState(swing, {}).event.status, 'watching', 'swinging wind must not qualify');

// 6) 上一过程关闭后，旧达标记录仍在序列里时，新一轮冷空气要能重新开过程
const surge = build(3, 40);
for (const ad of Object.keys(surge)) {
  for (let h = 0; h <= 31; h++) surge[ad][h] = { t: key(h), temp: 26, dir: 170, spd: 3, rain: 0 };
}
for (const ad of ['440200', '441800', '441600', '441400']) {
  const temps = [25.0, 23.0, 21.8, 21.0];
  for (let h = 32; h < 36; h++) surge[ad][h] = { t: key(h), temp: temps[h - 32], dir: 350, spd: 4, rain: 0 };
}
for (let h = 32; h < 36; h++) {
  surge['440100'][h] = { t: key(h), temp: 26, dir: 170, spd: 3, rain: 0 };
}
const gzTemps2 = [24, 23, 22, 21];
for (let h = 36; h < 40; h++) surge['440100'][h] = { t: key(h), temp: gzTemps2[h - 36], dir: 350, spd: 4, rain: 0 };
state = buildState(surge, state);
assert.strictEqual(state.event.status, 'active', 'new surge should reopen the event');
assert.strictEqual(state.event.openedAt, key(35));
assert.strictEqual(state.cities['440200'].status, 'arrived', 'gate city arrives in new event');
assert.strictEqual(state.cities['440100'].status, 'arrived', 'guangzhou arrives in new event');

console.log('cold-air engine tests passed');
