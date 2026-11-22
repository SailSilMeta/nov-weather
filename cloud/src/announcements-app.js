import { handleAnnouncements } from './announcements.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...CORS,
      ...extra,
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    /* 网关可能已去掉 /api 前缀，统一补回后再路由 */
    const path = url.pathname === '/api' || url.pathname.startsWith('/api/')
      ? url.pathname
      : `/api${url.pathname.startsWith('/') ? '' : '/'}${url.pathname}`;
    const target = new URL(request.url);
    target.pathname = path;

    if (path === '/api/announcements' || path.startsWith('/api/announcements/')) {
      return handleAnnouncements(request, target, env);
    }
    if (path === '/api/health') {
      return json({
        ok: true,
        announcements: Boolean(env.PG_GATEWAY_URL && env.PG_GATEWAY_KEY),
      });
    }

    return json({ ok: false, error: 'not_found' }, 404);
  },
};