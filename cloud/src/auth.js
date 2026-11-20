const SUFFIX = 'LJH';
const TTL = 2 * 3600e3;
const SKEW = 60e3;
const encoder = new TextEncoder();

function toB64url(bytes) {
  const arr = new Uint8Array(bytes);
  let text = '';
  for (let i = 0; i < arr.length; i += 0x8000) {
    text += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  }
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(secret, body) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toB64url(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
}

function answerAt(now) {
  const d = new Date(now + 8 * 3600e3);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}${mm}${SUFFIX}`;
}

function normalize(input) {
  return String(input == null ? '' : input).replace(/\s+/g, '').toUpperCase();
}

function matches(input, now = Date.now()) {
  const value = normalize(input);
  if (!value || value.length > 16) return false;
  return answerAt(now) === value || answerAt(now - SKEW) === value;
}

async function issue(secret, now = Date.now()) {
  const exp = now + TTL;
  const body = `${exp}.${toB64url(crypto.getRandomValues(new Uint8Array(9)))}`;
  return { token: `${body}.${await sign(secret, body)}`, exp };
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function check(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const exp = Number(parts[0]);
  if (!Number.isFinite(exp) || exp <= now || exp > now + TTL + SKEW) return null;
  const expected = await sign(secret, `${parts[0]}.${parts[1]}`);
  return safeEqual(expected, parts[2]) ? { exp } : null;
}

export { SUFFIX, TTL, answerAt, matches, issue, check };
