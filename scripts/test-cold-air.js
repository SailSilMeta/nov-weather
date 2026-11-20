const assert = require('assert');
const { buildState, findGateQualify, gateReading, findQualify, qualifyAt, RULE_VERSION } = require('../cold-air-engine');

const HOUR = 3600e3;
const start = Date.parse('2026-11-01T00:00:00+08:00');
const key = (h) => new Date(start + (h + 8) * HOUR).toISOString().slice(0, 16);
const GATES = ['440200', '441800', '441600', '441400'];

function makeSeries(temps, dirs, spds, rainFn, firstHour = 0) {
  return temps.map((temp, i) => ({
    t: key(firstHour + i),
    temp,
    dir: dirs[i],
    spd: spds[i],
    rain: rainFn ? rainFn(i) : 0,
  }));
}

const flat = (n, v) => Array.from({ length: n }, () => v);
const ramp = (n, from, to) => Array.from({ length: n }, (_, i) => Math.round((from + ((to - from) * i) / (n - 1)) * 10) / 10);

function gatePair(drop = 6, spd = 1.6, dir = 350, at = 24, gap = 24) {
  return [
    { t: key(at - gap), temp: 20, dir: 180, spd: 3, rain: 0 },
    { t: key(at), temp: 20 - drop, dir, spd, rain: 0 },
  ];
}

for (const [label, drop, spd, dir, passed] of [
  ['6C + level 2 equality', 6, 1.6, 350, true],
  ['3C + level 3 equality', 3, 3.4, 350, true],
  ['qualified drop is rounded for display', 6.14, 1.6, 350, true],
  ['3C + stronger wind', 3, 5.5, 350, true],
  ['5.9C + level 2', 5.9, 1.6, 350, false],
  ['5.99C + level 2', 5.99, 1.6, 350, false],
  ['2.9C + level 3', 2.9, 3.4, 350, false],
  ['2.99C + level 3', 2.99, 3.4, 350, false],
  ['3C + level 2', 3, 1.6, 350, false],
  ['3C just below level 3', 3, 3.39, 350, false],
  ['6C just below level 2', 6, 1.59, 350, false],
  ['southerly wind', 6, 3.4, 180, false],
  ['north at 0 degrees', 6, 1.6, 0, true],
  ['northeast boundary', 6, 1.6, 67.5, true],
  ['outside northeast boundary', 6, 1.6, 67.51, false],
  ['northwest boundary', 6, 1.6, 292.5, true],
  ['outside northwest boundary', 6, 1.6, 292.49, false],
  ['north at 360 degrees', 6, 1.6, 360, true],
]) {
  const series = gatePair(drop, spd, dir);
  const reading = gateReading(series, 1);
  assert.strictEqual(reading.passed, passed, label);
  assert.strictEqual(reading.drop, Math.round(drop * 10) / 10, `${label}: display rounding`);
  const hit = findGateQualify(series, '');
  assert.strictEqual(Boolean(hit), passed, `${label}: qualification`);
  if (hit) {
    for (const [field, expected] of Object.entries({ at: key(24), sAt: key(24), drop: reading.drop, baseT: 20, t: 20 - drop })) {
      assert.strictEqual(hit[field], expected, `${label}: ${field}`);
    }
  }
}
assert.deepStrictEqual(gateReading(gatePair(), 1), { drop: 6, north: true, level: 2, passed: true });
assert.deepStrictEqual(gateReading(gatePair(3, 3.4), 1), { drop: 3, north: true, level: 3, passed: true });

for (const [label, index, field, output, expected] of [
  ['current temperature', 1, 'temp', 'drop', null],
  ['baseline temperature', 0, 'temp', 'drop', null],
  ['wind speed', 1, 'spd', 'level', null],
  ['wind direction', 1, 'dir', 'north', false],
]) {
  for (const missing of [null, undefined, NaN]) {
    const series = gatePair();
    series[index][field] = missing;
    const reading = gateReading(series, 1);
    assert.strictEqual(reading[output], expected, `missing ${label}: ${String(missing)}`);
    assert.strictEqual(reading.passed, false, `missing ${label} cannot pass`);
    assert.strictEqual(findGateQualify(series, ''), null, `missing ${label} cannot qualify`);
  }
}
for (const gap of [23, 25]) {
  const series = gatePair(6, 1.6, 350, 24, gap);
  assert.strictEqual(gateReading(series, 1).drop, null, `${gap}h is not a 24h baseline`);
  assert.strictEqual(gateReading(series, 1).passed, false);
  assert.strictEqual(findGateQualify(series, ''), null);
}

for (const [label, change, startHour] of [
  ['missing temperature, warming and swinging wind', () => {}, 21],
  ['missing intermediate hour', (s) => s.splice(2, 1), 23],
  ['intermediate southerly wind', (s) => { s[3].dir = 180; }, 24],
  ['intermediate weak wind', (s) => { s[3].spd = 1.59; }, 24],
  ['intermediate missing wind', (s) => { s[3].spd = null; }, 24],
]) {
  const series = [gatePair()[0], ...makeSeries([17, null, 21, 14], [292.5, 67.5, 0, 350], flat(4, 1.6), undefined, 21)];
  change(series);
  assert.strictEqual(gateReading(series, series.length - 1).passed, true, label);
  const hit = findGateQualify(series, '');
  assert.ok(hit, label);
  assert.strictEqual(hit.at, key(24), label);
  assert.strictEqual(hit.sAt, key(startHour), `${label}: sAt only tracks consecutive hourly north wind`);
  assert.strictEqual(hit.drop, 6, label);
}
const repeated = [gatePair()[0], gatePair(6, 1.6, 350, 25)[0], gatePair()[1], gatePair(6, 1.6, 350, 25)[1]];
assert.strictEqual(findGateQualify(repeated, key(23)).at, key(24), 'first qualification after minAt');
assert.strictEqual(findGateQualify(repeated, key(24)).at, key(25), 'minAt is exclusive');
assert.strictEqual(findGateQualify(repeated, key(24)).sAt, key(24), 'sAt can precede minAt qualification');
assert.strictEqual(findGateQualify(repeated, key(25)), null);

const ordinary = () => makeSeries([24.8, 24.8, 24, 23, 21.8], [180, 350, 350, 350, 350], flat(5, 3), (i) => i === 4 ? 1.2 : 0);
const cityHit = qualifyAt(ordinary(), 0, 3);
assert.strictEqual(cityHit.at, key(4), 'ordinary cities still use the short-term 3C drop');
assert.strictEqual(cityHit.drop, 3);
assert.strictEqual(cityHit.kind, '锋面型南下');
assert.deepStrictEqual(findQualify(ordinary(), key(3), 3), cityHit);
assert.strictEqual(findQualify(ordinary(), key(4), 3), null);
for (const [label, change] of [
  ['swinging north wind', (s) => { s[2].dir = 60; s[4].dir = 60; }],
  ['southerly interruption', (s) => { s[2].dir = 180; }],
  ['weak wind interruption', (s) => { s[2].spd = 1.59; }],
  ['temperature rebound', (s) => { s[2].temp = 25; }],
  ['missing temperature', (s) => { s[2].temp = null; }],
  ['missing hour', (s) => s.splice(2, 1)],
  ['only three north-wind hours', (s) => { s.pop(); s[3].temp = 21.8; }],
]) {
  const series = ordinary();
  change(series);
  assert.strictEqual(qualifyAt(series, 0, 3), null, `ordinary city rejects ${label}`);
  assert.strictEqual(findQualify(series, '', 3), null, `ordinary city search rejects ${label}`);
}

function build(gzFrom = 3, hours = 24) {
  const series = {};
  const gateTemps = [20, 19.6, 18.2, 17.1, 15.8, ...flat(hours - 5, 15.5)].slice(0, hours);
  for (const ad of GATES) {
    series[ad] = makeSeries(gateTemps, [190, ...flat(hours - 1, 350)], [3, ...flat(hours - 1, 4)]);
  }
  const gzDirs = [...flat(gzFrom, 180), ...flat(hours - gzFrom, 340)];
  const gzTemps = [25, ...flat(hours - 1, 24.8)];
  gzTemps[gzFrom + 1] = 24.0;
  gzTemps[gzFrom + 2] = 23.0;
  gzTemps[gzFrom + 3] = 21.8;
  series['440100'] = makeSeries(gzTemps, gzDirs, flat(hours, 3), (i) => (i === gzFrom + 3 ? 1.2 : 0));
  for (const ad of ['440300', '440600', '440500']) {
    series[ad] = makeSeries(ramp(hours, 26, 24), flat(hours, 170), flat(hours, 3));
  }
  for (const ad of Object.keys(series)) {
    series[ad] = [...makeSeries(flat(24, series[ad][0].temp), flat(24, 180), flat(24, 3), undefined, -24), ...series[ad]];
  }
  return series;
}

const initial = buildState(build(3, 7), {});
let state = initial;
assert.strictEqual(RULE_VERSION, 2);
assert.strictEqual(state.ruleVersion, RULE_VERSION);
assert.strictEqual(state.event.status, 'active', 'event should open');
assert.strictEqual(state.openedAt, undefined);
assert.strictEqual(state.event.openedAt, key(4));
assert.strictEqual(state.event.windowStart, key(1));
assert.strictEqual(state.stats.gatePassed, 4);
assert.strictEqual(state.cities['440200'].status, 'arrived', 'gate city itself should be blue');
assert.strictEqual(state.cities['440100'].status, 'arrived', 'guangzhou should turn blue');
assert.strictEqual(state.cities['440100'].at, key(6));
assert.strictEqual(state.cities['440100'].red, undefined);
assert.strictEqual(state.cities['440100'].drop, 3);
assert.strictEqual(state.cities['440100'].kind, '锋面型南下');
assert.strictEqual(state.cities['440300'].status, 'pending');
assert.strictEqual(state.event.closesAt, key(30));

const warm = Object.fromEntries(Object.keys(build()).map((ad) => [ad, makeSeries(flat(23, 26), flat(23, 170), flat(23, 3), undefined, 7)]));
state = buildState(warm, state);
assert.strictEqual(state.event.status, 'active', 'still active one hour before 24h close');
assert.strictEqual(state.cities['440100'].status, 'arrived', 'warming and south wind do not clear an arrival');
assert.strictEqual(state.cities['440100'].at, key(6));
assert.strictEqual(state.stats.gatePassed, 4, 'gate history survives absent qualifying samples');
assert.deepStrictEqual(state.gate, initial.gate);

function warmAfterArrival(series) {
  for (const points of Object.values(series)) {
    for (const point of points) {
      if (point.t >= key(7)) Object.assign(point, { temp: 26, dir: 170, spd: 3, rain: 0 });
    }
  }
  return series;
}
const late = warmAfterArrival(build(3, 31));
state = buildState(late, state);
assert.strictEqual(state.event.status, 'watching', 'event closes exactly 24h after the last arrival');
assert.strictEqual(state.cities['440100'].status, 'pending', 'blue cleared on close');
assert.strictEqual(state.stats.arrived, 0);
assert.strictEqual(state.closedAt, key(30));
assert.strictEqual(state.stats.gatePassed, 0, 'gate markers reset on the close frame');
for (const ad of GATES) assert.strictEqual(state.gate[ad].passed, false);
state = buildState(late, state);
assert.strictEqual(state.event.status, 'watching', 'no immediate reopen from stale gate data');
assert.strictEqual(state.closedAt, key(30));
assert.strictEqual(state.stats.gatePassed, 0, 'old qualifications cannot restore closed gate markers');

const surge = warmAfterArrival(build(3, 40));
for (const ad of GATES) {
  const temps = [25, 23.1, 23.1, 21];
  for (let h = 32; h < 36; h++) Object.assign(surge[ad].find((p) => p.t === key(h)), { temp: temps[h - 32], dir: 350, spd: 4 });
  assert.strictEqual(findGateQualify(surge[ad], '').at, key(4), 'old gate records remain in the series');
  assert.strictEqual(findGateQualify(surge[ad], state.closedAt).at, key(35), 'new qualification must be after close');
}
for (let h = 36; h < 40; h++) Object.assign(surge['440100'].find((p) => p.t === key(h)), { temp: 24 - (h - 36), dir: 350, spd: 4 });
state = buildState(surge, state);
assert.strictEqual(state.event.status, 'active', 'new surge should reopen the event');
assert.strictEqual(state.event.openedAt, key(35));
assert.strictEqual(state.cities['440200'].status, 'arrived', 'gate city arrives in new event');
assert.strictEqual(state.cities['440200'].at, key(35));
assert.strictEqual(state.cities['440100'].status, 'arrived', 'guangzhou arrives in new event');
assert.strictEqual(state.cities['440100'].at, key(39));
assert.strictEqual(state.event.closesAt, key(63));

const gateSnapshot = (times) => Object.fromEntries(GATES.map((ad, i) => [ad, gatePair(6, 1.6, 350, times[i])]));
const three = gateSnapshot([24, 24, 24, 24]);
three[GATES[3]][1].temp = 20;
const partial = buildState(three, {});
assert.strictEqual(partial.event.status, 'watching', 'three of four gates cannot open an event');
assert.strictEqual(partial.stats.gatePassed, 3);
for (const [times, status] of [
  [[24, 25, 26, 27], 'active'],
  [[24, 25, 26, 60], 'active'],
  [[24, 25, 26, 61], 'watching'],
]) {
  const snapshot = buildState(gateSnapshot(times), {});
  assert.strictEqual(snapshot.stats.gatePassed, 4);
  assert.strictEqual(snapshot.event.status, status, `gate span ${times[3] - times[0]}h`);
  for (const [i, ad] of GATES.entries()) assert.strictEqual(snapshot.gate[ad].at, key(times[i]));
  if (status === 'active') assert.strictEqual(snapshot.event.openedAt, key(times[3]), 'last gate opens the event');
}

for (const version of [undefined, 1]) {
  const legacy = { ...initial, ruleVersion: version, closedAt: key(100), event: { ...initial.event, openedAt: key(-10) } };
  const cleared = buildState({}, legacy);
  assert.strictEqual(cleared.ruleVersion, RULE_VERSION);
  assert.strictEqual(cleared.event.status, 'watching', 'legacy event must not survive without current qualifications');
  assert.strictEqual(cleared.closedAt, '', 'legacy closedAt must not block recalculation');
  assert.strictEqual(cleared.stats.arrived, 0);
  assert.strictEqual(cleared.stats.gatePassed, 0);
  const recalculated = buildState(build(3, 7), legacy);
  assert.strictEqual(recalculated.event.status, 'active');
  assert.strictEqual(recalculated.event.openedAt, key(4), 'legacy opening time is recomputed');
  assert.strictEqual(recalculated.closedAt, '');
  assert.strictEqual(recalculated.event.closesAt, key(30));
}

console.log('cold-air engine tests passed');
