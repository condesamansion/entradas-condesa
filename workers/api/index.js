// workers/api/index.js
// Entry point del Cloudflare Worker — router principal

import { handleAdmin } from './routes/admin.js';
import { handlePublico } from './routes/publico.js';
import { handleScan } from './routes/scan.js';
import { handleWebhooks } from './routes/webhooks.js';
import { corsOk, withCors, err } from './lib/utils.js';

export default {
  async fetch(request, env, ctx) {
    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return corsOk();
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      let response = null;

      // ── Webhook MP (sin auth) ──────────────────────────────
      if (pathname.startsWith('/api/webhooks/')) {
        response = await handleWebhooks(request, env, pathname);
      }

      // ── Endpoints públicos ─────────────────────────────────
      else if (
        pathname === '/api/evento-activo' ||
        pathname === '/api/entradas'
      ) {
        response = await handlePublico(request, env, pathname);
      }

      // ── Escáner portero (Cloudflare Access — rol portero) ──
      else if (pathname.startsWith('/api/scan/')) {
        response = await handleScan(request, env, pathname);
      }

      // ── Panel admin (Cloudflare Access — rol admin) ────────
      else if (pathname.startsWith('/api/admin/')) {
        response = await handleAdmin(request, env, pathname);
      }

      // ── QR viewer público (/e/:token) ──────────────────────
      // Muestra una página simple con la info de la entrada (para abrir desde el celular)
      else if (pathname.startsWith('/e/')) {
        response = await handleEntradaViewer(request, env, pathname);
      }

      if (!response) {
        response = err('Endpoint no encontrado', 404);
      }

      return withCors(response);
    } catch (e) {
      console.error('Worker error:', e);
      return withCors(err('Error interno del servidor', 500));
    }
  },
};

// ── QR Viewer (/e/:token) ──────────────────────────────────────
// Página mínima que se abre cuando el portero escanea el QR con la cámara del celular.
// Alternativa al escáner de la app: el QR puede ser una URL o solo un token.
// En este caso la URL redirige a /scan que procesa el token.

async function handleEntradaViewer(request, env, pathname) {
  const match = pathname.match(/^\/e\/([a-f0-9-]{36})$/i);
  if (!match) return err('Token inválido', 400);

  const token = match[1];
  const base = new URL(request.url).origin;
  return Response.redirect(`${base}/scan?token=${token}`, 302);
}
