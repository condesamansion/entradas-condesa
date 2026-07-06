// workers/api/routes/scan.js

import { getEntradaByToken, marcarEntradaUsada } from '../lib/db.js';
import { ok } from '../lib/utils.js';

export async function handleScan(request, env, pathname) {

  // POST /api/scan/:token/confirmar — marca como usada (se llama después de mostrar VÁLIDO)
  const matchConfirmar = pathname.match(/^\/api\/scan\/([a-f0-9-]{36})\/confirmar$/i);
  if (matchConfirmar && request.method === 'POST') {
    const token = matchConfirmar[1];
    const entrada = await getEntradaByToken(env.DB, token);

    if (!entrada) {
      return ok({ resultado: 'invalido', codigo: 'NOT_FOUND' });
    }
    if (entrada.estado === 'usada') {
      return ok({ resultado: 'ya_confirmada', codigo: 'YA_USADA' });
    }

    await marcarEntradaUsada(env.DB, token);
    return ok({ resultado: 'confirmada', codigo: 'OK' });
  }

  // GET /api/scan/:token — solo verifica, no marca como usada
  const match = pathname.match(/^\/api\/scan\/([a-f0-9-]{36})$/i);
  if (!match || request.method !== 'GET') return null;

  const token = match[1];
  const entrada = await getEntradaByToken(env.DB, token);

  if (!entrada) {
    return ok({
      resultado: 'invalido',
      codigo: 'NOT_FOUND',
      mensaje: 'Entrada no encontrada',
    });
  }

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

  if (entrada.estado === 'usada') {
    return ok({
      resultado: 'usada',
      codigo: 'YA_USADA',
      mensaje: 'Esta entrada ya fue utilizada',
      usado_at: entrada.usado_at,
      entrada: resumenEntrada(entrada),
    });
  }

  if (entrada.estado === 'pendiente_pago') {
    return ok({
      resultado: 'invalido',
      codigo: 'PAGO_PENDIENTE',
      mensaje: 'El pago de esta entrada no fue confirmado',
      entrada: resumenEntrada(entrada),
    });
  }

  // ✅ Válida — devuelve info pero NO marca como usada todavía
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
    telefono: e.telefono,
    usuario_ig: e.usuario_ig,
  };
}
