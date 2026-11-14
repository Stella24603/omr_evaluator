/* Cloudflare Worker. The files in public/ are served as the site; only /api/* reaches this code. */
import { handleSync } from './sync.js';
import { handleAuth } from './auth.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/api/sync' && request.method === 'POST') return await handleSync(request, env);
      if (pathname.startsWith('/api/auth/')) return await handleAuth(request, env, pathname.slice(10));
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Server error: ' + (e.message || e) }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
    if (pathname.startsWith('/api/')) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    return env.ASSETS.fetch(request);
  },
};
