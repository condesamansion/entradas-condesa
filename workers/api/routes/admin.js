// workers/api/routes/admin.js
// Endpoints protegidos por Cloudflare Access (admin y portero no llegan aquí sin auth)

import {
  getEventos, getEventoById, createEvento, updateEvento, setEventoActivo,
  getTiposEntrada, getTipoEntradaById, createTipoEntrada, updateTipoEntrada,
  createEntrada, getEntradasByEvento, getEstadisticasEvento, checkCupo,
} from '../lib/db.js';
import { procesarQR } from '../lib/qr.js';
import { enviarMailQR } from '../lib/mail.js';
import { uuid, ok, err, validarCampos, validarEmail, parseBody } from '../lib/utils.js';

export async function handleAdmin(request, env, pathname) {
  const method = request.method;

  // ── Eventos ────────────────────────────────────────────────

  // GET /api/admin/eventos
  if (pathname === '/api/admin/eventos' && method === 'GET') {
    const eventos = await getEventos(env.DB);
    return ok(eventos);
  }

  // POST /api/admin/eventos
  if (pathname === '/api/admin/eventos' && method === 'POST') {
    const body = await parseBody(request);
    const error = validarCampos(body, ['nombre', 'fecha']);
    if (error) return err(error);

    const id = await createEvento(env.DB, body);
    const evento = await getEventoById(env.DB, id);
    return ok(evento, 201);
  }

  // PUT /api/admin/eventos/:id  |  DELETE /api/admin/eventos/:id
  const eventoMatch = pathname.match(/^\/api\/admin\/eventos\/(\d+)$/);
  if (eventoMatch && method === 'PUT') {
    const id = parseInt(eventoMatch[1]);
    const body = await parseBody(request);

    // Si se activa este evento, desactivar los demás
    if (body.activo == 1 || body.activo === true) {
      await setEventoActivo(env.DB, id);
      delete body.activo;
    }

    if (Object.keys(body).length > 0) {
      await updateEvento(env.DB, id, body);
    }

    const evento = await getEventoById(env.DB, id);
    return ok(evento);
  }

  if (eventoMatch && method === 'DELETE') {
    const id = parseInt(eventoMatch[1]);
    await env.DB.prepare('DELETE FROM entradas WHERE evento_id = ?').bind(id).run();
    await env.DB.prepare('DELETE FROM tipos_entrada WHERE evento_id = ?').bind(id).run();
    await env.DB.prepare('DELETE FROM eventos WHERE id = ?').bind(id).run();
    return ok({ deleted: id });
  }

  // POST /api/admin/eventos/:id/flyer
  const flyerMatch = pathname.match(/^\/api\/admin\/eventos\/(\d+)\/flyer$/);
  if (flyerMatch && method === 'POST') {
    const id = parseInt(flyerMatch[1]);
    const formData = await request.formData();
    const file = formData.get('flyer');
    if (!file) return err('No se envió archivo');

    const bytes = await file.arrayBuffer();
    const uint8 = new Uint8Array(bytes);
    let bin = '';
    for (let i = 0; i < uint8.length; i++) bin += String.fromCharCode(uint8[i]);
    const dataUrl = `data:${file.type};base64,${btoa(bin)}`;

    await updateEvento(env.DB, id, { flyer_url: dataUrl });
    return ok({ flyer_url: dataUrl });
  }

  // ── Tipos de entrada ───────────────────────────────────────

  // GET /api/admin/tipos-entrada?evento_id=X
  if (pathname === '/api/admin/tipos-entrada' && method === 'GET') {
    const url = new URL(request.url);
    const evento_id = url.searchParams.get('evento_id');
    if (!evento_id) return err('Falta evento_id');

    const tipos = await getTiposEntrada(env.DB, parseInt(evento_id));
    return ok(tipos);
  }

  // POST /api/admin/tipos-entrada
  if (pathname === '/api/admin/tipos-entrada' && method === 'POST') {
    const body = await parseBody(request);
    const error = validarCampos(body, ['evento_id', 'nombre']);
    if (error) return err(error);

    // Validar restricciones de edad mutuamente excluyentes
    if (body.restriccion_edad && ![16, 18, 21].includes(body.restriccion_edad)) {
      return err('restriccion_edad debe ser 16, 18 o 21');
    }

    const id = await createTipoEntrada(env.DB, body);
    const tipo = await getTipoEntradaById(env.DB, id);
    return ok(tipo, 201);
  }

  // PUT /api/admin/tipos-entrada/:id  |  DELETE /api/admin/tipos-entrada/:id
  const tipoMatch = pathname.match(/^\/api\/admin\/tipos-entrada\/(\d+)$/);
  if (tipoMatch && method === 'PUT') {
    const id = parseInt(tipoMatch[1]);
    const body = await parseBody(request);

    await updateTipoEntrada(env.DB, id, body);
    const tipo = await getTipoEntradaById(env.DB, id);
    return ok(tipo);
  }

  if (tipoMatch && method === 'DELETE') {
    const id = parseInt(tipoMatch[1]);
    await env.DB.prepare('DELETE FROM entradas WHERE tipo_entrada_id = ?').bind(id).run();
    await env.DB.prepare('DELETE FROM tipos_entrada WHERE id = ?').bind(id).run();
    return ok({ deleted: id });
  }

  // ── Invitaciones (generadas por admin) ────────────────────

  // POST /api/admin/invitaciones
  if (pathname === '/api/admin/invitaciones' && method === 'POST') {
    const body = await parseBody(request);
    const error = validarCampos(body, ['nombre', 'apellido', 'mail', 'tipo_entrada_id', 'evento_id']);
    if (error) return err(error);

    if (!validarEmail(body.mail)) return err('Email inválido');

    // Verificar cupo
    const cupo = await checkCupo(env.DB, body.tipo_entrada_id);
    if (!cupo.ok) return err(cupo.error, 409);

    // Verificar que el tipo pertenece al evento y es gratis (admin siempre free)
    const tipo = await getTipoEntradaById(env.DB, body.tipo_entrada_id);
    if (!tipo) return err('Tipo de entrada no encontrado', 404);

    const token = uuid();

    // Generar QR y subir a R2
    let qrBase64, qrUrl;
    console.log('Generando QR para token:', token, 'baseUrl:', env.QR_BASE_URL);
    try {
      const qr = await procesarQR(token, env.QR_BASE_URL, env.BUCKET);
      qrBase64 = qr.base64;
      qrUrl = qr.url;
    } catch (e) {
      console.error('Error completo QR:', e.message, e.stack);
      return err(`Error generando QR: ${e.message}`, 500);
    }

    // Crear entrada en DB
    const entradaId = await createEntrada(env.DB, {
      tipo_entrada_id: body.tipo_entrada_id,
      evento_id: body.evento_id,
      nombre: body.nombre,
      apellido: body.apellido,
      mail: body.mail,
      telefono: body.telefono,
      usuario_ig: body.usuario_ig,
      dni: body.dni,
      invitados_count: body.invitados_count ?? 0,
      invitados_detalle: body.invitados_detalle,
      qr_token: token,
      origen: 'admin',
      estado: 'valida',
      mensaje_especial: body.mensaje_especial,
      creado_por: body.creado_por ?? null,
    });

    // Obtener evento para el mail
    const evento = await getEventoById(env.DB, body.evento_id);

    // Enviar mail con QR
    try {
      await enviarMailQR({
        resendKey: env.RESEND_API_KEY,
        entrada: {
          nombre: body.nombre,
          apellido: body.apellido,
          mail: body.mail,
          invitados_count: body.invitados_count ?? 0,
          mensaje_especial: body.mensaje_especial,
          dni: body.dni,
          qr_token: token,
        },
        tipoNombre: tipo.nombre,
        eventoNombre: evento.nombre,
        eventoFecha: evento.fecha,
        qrBase64,
        qrUrl,
      });
    } catch (e) {
      // Mail no crítico — la entrada ya está creada
      console.error('Error enviando mail:', e.message);
    }

    return ok({ id: entradaId, qr_token: token, qr_url: qrUrl }, 201);
  }

  // ── Lista de asistentes ────────────────────────────────────

  // GET /api/admin/entradas?evento_id=X[&tipo_id=Y][&estado=Z]
  if (pathname === '/api/admin/entradas' && method === 'GET') {
    const url = new URL(request.url);
    const evento_id = url.searchParams.get('evento_id');
    if (!evento_id) return err('Falta evento_id');

    const filtros = {
      tipo_id: url.searchParams.get('tipo_id'),
      estado: url.searchParams.get('estado'),
    };

    const [entradas, stats] = await Promise.all([
      getEntradasByEvento(env.DB, parseInt(evento_id), filtros),
      getEstadisticasEvento(env.DB, parseInt(evento_id)),
    ]);

    return ok({ entradas, stats });
  }

  // ── DELETE Entrada ─────────────────────────────────────────
  const deleteEntradaMatch = pathname.match(/^\/api\/admin\/entradas\/(\d+)$/);
  if (deleteEntradaMatch && method === 'DELETE') {
    const id = parseInt(deleteEntradaMatch[1]);
    await env.DB.prepare('DELETE FROM entradas WHERE id = ?').bind(id).run();
    return ok({ deleted: id });
  }

  return null; // no matcheó ningún endpoint admin
}
