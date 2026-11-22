import { webcrypto } from 'node:crypto';
import app from './app.js';
import { makeHandler } from './adapter.js';

/* Node 18 的 Web Crypto 不在全局，补上以免 auth/announcements 里的 crypto 调用报错 */
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });
}

const handler = makeHandler(app, () => ({
  RADAR_AUTH_SECRET: process.env.RADAR_AUTH_SECRET || '',
  ANNOUNCE_ADMIN_TOKEN: process.env.ANNOUNCE_ADMIN_TOKEN || '',
  PG_GATEWAY_URL: process.env.PG_GATEWAY_URL || '',
  PG_GATEWAY_KEY: process.env.PG_GATEWAY_KEY || '',
}));

export { handler, handler as main };
export default handler;