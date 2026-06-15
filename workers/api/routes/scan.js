// workers/api/routes/scan.js
// Endpoint protegido por Cloudflare Access (rol: portero)

import { getEntradaByToken, marcarEntradaUsada } from '../lib/db.js';
import { ok, err } from '../lib/utils.js';

export async function handleScan(request, env, pathname) {
  // GET /api/scan/:token
  const match = pathname.match(/^\/api\/scan\/([a-f0-9-]{36})$/i);
  if (!match || request.method !== 'GET') return null;

  const token = match[1];
  const entrada = await getEntradaByToken(env.DB, token);

  // Token no existe
  if (!entrada) {
    return ok({
      resultado: 'invalido',
      codigo: 'NOT_FOUND',
      mensaje: 'Entrada no encontrada',
    });
  }

  // Verificar que pertenece al evento activo
  const eventoActivo = await env.DB
    .prepare('SELECT id FROM eventos WHERE activo = 1 LIMIT 1')
    .first();

  if (!eventoActivo || entrada.evento_id !== eventoActivo.id) {
    return ok({
      resultado: 'invalido',
      codigo: 'EVENTO_INCORRECTO',
      mensaje: 'Esta entrada no corresponde al evento activo',
      entrada: resumenEntrada(entrada),
    });
  }

  // Ya fue usada
  if (entrada.estado === 'usada') {
    return ok({
      resultado: 'usada',
      codigo: 'YA_USADA',
      mensaje: 'Esta entrada ya fue utilizada',
      usado_at: entrada.usado_at,
      entrada: resumenEntrada(entrada),
    });
  }

  // Pendiente de pago
  if (entrada.estado === 'pendiente_pago') {
    return ok({
      resultado: 'invalido',
      codigo: 'PAGO_PENDIENTE',
      mensaje: 'El pago de esta entrada no fue confirmado',
      entrada: resumenEntrada(entrada),
    });
  }

  // ✅ Válida — marcar como usada
  await marcarEntradaUsada(env.DB, token);

  return ok({
    resultado: 'valido',
    codigo: 'OK',
    mensaje: 'Entrada válida',
    entrada: {
      ...resumenEntrada(entrada),
      mensaje_especial: entrada.mensaje_especial,
    },
  });
}

function resumenEntrada(e) {
  return {
    nombre: `${e.nombre} ${e.apellido}`,
    tipo: e.tipo_nombre,
    beneficios: e.beneficios,
    invitados_count: e.invitados_count,
    total_personas: 1 + (e.invitados_count || 0),
    invitados_detalle: e.invitados_detalle ? JSON.parse(e.invitados_detalle) : [],
    evento: e.evento_nombre,
    origen: e.origen,
    dni: e.dni,
  };
}
