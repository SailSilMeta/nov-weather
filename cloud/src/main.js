import app from './app.js';

const BINARY = /^(image\/|application\/octet-stream)/i;
const TEXT = /^(text\/|application\/(json|javascript|xml|problem\+json))/i;

function parseEvent(raw) {
  if (Buffer.isBuffer(raw)) {
    const text = raw.toString('utf8').trim();
    if (!text.startsWith('{')) return null;
    raw = text;
  }
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  return raw && typeof raw === 'object' ? raw : null;
}

function headerBag(source) {
  const headers = {};
  if (!source || typeof source !== 'object') return headers;
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    headers[String(key).toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value);
  }
  return headers;
}

function queryString(event) {
  const bag = event.queryParameters || event.queryStringParameters;
  if (bag && typeof bag === 'object') {
    const parts = [];
    for (const [key, value] of Object.entries(bag)) {
      if (value == null) continue;
      const list = Array.isArray(value) ? value : [value];
      for (const item of list) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
    }
    if (parts.length) return parts.join('&');
  }
  const raw = event.rawQueryString || event.queryString || '';
  return typeof raw === 'string' ? raw.replace(/^\?/, '') : '';
}

function normalize(rawEvent) {
  const event = parseEvent(rawEvent);
  if (!event) return null;
  const http = (event.requestContext && (event.requestContext.http || event.requestContext)) || {};
  const method = String(event.httpMethod || http.method || 'GET').toUpperCase();
  let path = String(event.rawPath || http.path || event.path || '/');
  path = path.split('?')[0] || '/';
  const apiAt = path.indexOf('/api/');
  if (apiAt > 0) path = path.slice(apiAt);
  if (!path.startsWith('/')) path = `/${path}`;

  const query = queryString(event);
  let body = event.body;
  if (typeof body === 'object' && body !== null) body = JSON.stringify(body);
  if (typeof body === 'string') {
    /* 阿里云文本请求不编码；华为 APIG 默认 base64；直接传 JSON 字符串时保持原样 */
    const looksJson = /^\s*[[{]/.test(body);
    if (!looksJson && event.isBase64Encoded !== false) body = Buffer.from(body, 'base64');
  } else {
    body = undefined;
  }
  if (method === 'GET' || method === 'HEAD') body = undefined;

  return {
    request: new Request(`https://function.local${path}${query ? `?${query}` : ''}`, {
      method,
      headers: headerBag(event.headers),
      body,
    }),
  };
}

async function respond(res) {
  const buffer = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || '';
  const headers = {};
  res.headers.forEach((value, key) => {
    /* 由网关重新计算长度，避免 base64 响应与 Content-Length 不一致 */
    if (key === 'content-length' || key === 'transfer-encoding' || key === 'connection') return;
    headers[key] = value;
  });
  if (res.status === 204 || !buffer.length) {
    return { statusCode: res.status, headers, body: '', isBase64Encoded: false };
  }
  const binary = !TEXT.test(type) || BINARY.test(type);
  return {
    statusCode: res.status,
    headers,
    body: binary ? buffer.toString('base64') : buffer.toString('utf8'),
    isBase64Encoded: binary,
  };
}

async function handler(event, context) {
  const normalized = normalize(event);
  if (!normalized) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: false, error: 'bad_event' }),
      isBase64Encoded: false,
    };
  }
  const env = { RADAR_AUTH_SECRET: process.env.RADAR_AUTH_SECRET || '' };
  try {
    return await respond(await app.fetch(normalized.request, env));
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: false, error: 'function_error' }),
      isBase64Encoded: false,
    };
  }
}

export { handler };
export default handler;
