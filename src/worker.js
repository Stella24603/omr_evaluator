/* Cloudflare Worker. The files in public/ are served as the site; only /api/* reaches this code. */
import { handleSync } from './sync.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/sync' && request.method === 'POST') return handleSync(request, env);
    if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
