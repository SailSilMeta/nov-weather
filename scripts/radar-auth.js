const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SUFFIX = 'LJH';
const TTL = 2 * 3600e3;
const SKEW = 60e3;

const keyFile = path.join(__dirname, '..', 'cache', 'radar-auth.key');
let memoryKey = null;

function secret() {
  if (process.env.RADAR_AUTH_SECRET) return Buffer.from(process.env.RADAR_AUTH_SECRET, 'utf8');
  if (memoryKey) return memoryKey;
  try {
    memoryKey = fs.readFileSync(keyFile);
    if (memoryKey.length >= 16) return memoryKey;
  } catch (e) {
    /* generate below */
  }
  memoryKey = crypto.randomBytes(32);
  try {
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, memoryKey, { mode: 0o600 });
  } catch (e) {
    /* read-only host: keep the key in memory, tokens expire with the process */
  }
  return memoryKey;
}

function answerAt(now) {
  const d = new Date(now.getTime() + 8 * 3600e3);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}${mm}${SUFFIX}`;
}

function normalize(input) {
  return String(input == null ? '' : input).replace(/\s+/g, '').toUpperCase();
}

function matches(input, now = new Date()) {
  const value = normalize(input);
  if (!value || value.length > 16) return false;
  return answerAt(now) === value || answerAt(new Date(now.getTime() - SKEW)) === value;
}

function sign(body) {
  return crypto.createHmac('sha256', secret()).update(body).digest('base64url');
}

function issue(now = Date.now()) {
  const exp = now + TTL;
  const body = `${exp}.${crypto.randomBytes(9).toString('base64url')}`;
  return { token: `${body}.${sign(body)}`, exp };
}

function check(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const exp = Number(parts[0]);
  if (!Number.isFinite(exp) || exp <= now || exp > now + TTL + SKEW) return null;
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return { exp };
}

module.exports = { SUFFIX, TTL, answerAt, matches, issue, check };
