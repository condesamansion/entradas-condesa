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

  // Verificar fecha del evento (válido el día del evento y hasta las 8am del día siguiente)
  const fechaEvento = new Date(entrada.evento_fecha);
  const ahora = new Date();

  const inicioEvento = new Date(fechaEvento);
  inicioEvento.setHours(0, 0, 0, 0);

  const limitePost = new Date(fechaEvento);
  limitePost.setDate(limitePost.getDate() + 1);
  limitePost.setHours(11, 0, 0, 0); // 8am ARG = 11am UTC

  if (ahora < inicioEvento || ahora > limitePost) {
    return ok({
      resultado: 'otro_dia',
      codigo: 'FECHA_INCORRECTA',
      mensaje: `Esta entrada es para ${fmtFechaEvento(entrada.evento_fecha)}`,
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

function fmtFechaEvento(iso) {
  if (!iso) return 'otro evento';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
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
