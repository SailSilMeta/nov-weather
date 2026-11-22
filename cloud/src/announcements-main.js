import { webcrypto } from 'node:crypto';
import app from './announcements-app.js';
import { makeHandler } from './adapter.js';

/* Node 18 的 Web Crypto 不在全局，补上以免 announcements 里的 crypto 调用报错 */
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });
}

const handler = makeHandler(app, () => ({
  ANNOUNCE_ADMIN_TOKEN: process.env.ANNOUNCE_ADMIN_TOKEN || '',
  PG_GATEWAY_URL: process.env.PG_GATEWAY_URL || '',
  PG_GATEWAY_KEY: process.env.PG_GATEWAY_KEY || '',
}));

export { handler, handler as main };
export default handler;