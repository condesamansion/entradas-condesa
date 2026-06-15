// workers/api/lib/utils.js

// ── Respuestas ────────────────────────────────────────────────

export function ok(data, status = 200) {
  return Response.json({ ok: true, data }, { status });
}

export function err(message, status = 400, details = null) {
  return Response.json({ ok: false, error: message, ...(details && { details }) }, { status });
}

// ── UUID v4 ───────────────────────────────────────────────────

export function uuid() {
  // crypto.randomUUID() disponible en Workers
  return crypto.randomUUID();
}

// ── Validaciones ─────────────────────────────────────────────

export function validarCampos(body, requeridos) {
  const faltantes = requeridos.filter(k => !body[k] && body[k] !== 0);
  if (faltantes.length) {
    return `Campos requeridos: ${faltantes.join(', ')}`;
  }
  return null;
}

export function validarEmail(mail) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail);
}

// ── CORS ─────────────────────────────────────────────────────

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function corsOk() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function withCors(response) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(CORS_HEADERS)) r.headers.set(k, v);
  return r;
}

// ── Parseo seguro de JSON ─────────────────────────────────────

export async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
