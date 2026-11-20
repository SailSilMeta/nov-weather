import app from './app.js';

const ORIGIN = 'https://function.local';

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  const at = url.pathname.indexOf('/api/');
  const target = (at > 0 ? url.pathname.slice(at) : url.pathname) + url.search;

  const init: RequestInit = { method: request.method, headers: request.headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  return app.fetch(new Request(ORIGIN + target, init), {
    RADAR_AUTH_SECRET: Deno.env.get('RADAR_AUTH_SECRET') || '',
  });
});
