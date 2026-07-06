// workers/api/routes/admin.js
// Endpoints protegidos por Cloudflare Access (admin y portero no llegan aquí sin auth)

import {
  getEventos, getEventoById, createEvento, updateEvento, setEventoActivo, getEventosActivos,
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

    // Toggle activo sin tocar los demás eventos
    if (body.activo !== undefined) {
      await setEventoActivo(env.DB, id, body.activo == 1 || body.activo === true);
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
          telefono: body.telefono,
          usuario_ig: body.usuario_ig,
          invitados_count: body.invitados_count ?? 0,
          invitados_detalle: body.invitados_detalle,
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

  // GET /api/admin/eventos-activos
  if (pathname === '/api/admin/eventos-activos' && method === 'GET') {
    const eventos = await getEventosActivos(env.DB);
    return ok(eventos);
  }

  // GET /api/admin/contactos
  if (pathname === '/api/admin/contactos' && method === 'GET') {
    const contactos = await env.DB
      .prepare('SELECT * FROM contactos ORDER BY nombre, apellido')
      .all();
    return ok(contactos.results || []);
  }

  // POST /api/admin/contactos
  if (pathname === '/api/admin/contactos' && method === 'POST') {
    const body = await parseBody(request);
    if (!body.nombre || !body.apellido) return err('Nombre y apellido son requeridos');
    const existing = await env.DB
      .prepare('SELECT id FROM contactos WHERE dni = ? AND dni != ""')
      .bind(body.dni || '').first();
    if (existing) return err('Ya existe un contacto con ese DNI', 409);
    await env.DB.prepare(`
      INSERT INTO contactos (nombre, apellido, mail, telefono, usuario_ig, dni)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      body.nombre, body.apellido,
      body.mail || '', body.telefono || '',
      body.usuario_ig || '', body.dni || ''
    ).run();
    return ok({ ok: true }, 201);
  }

  // PUT + DELETE /api/admin/contactos/:id
  const contactoMatch = pathname.match(/^\/api\/admin\/contactos\/(\d+)$/);
  if (contactoMatch && method === 'PUT') {
    const id = parseInt(contactoMatch[1]);
    const body = await parseBody(request);
    const fields = ['nombre','apellido','mail','telefono','usuario_ig','dni']
      .filter(k => body[k] !== undefined);
    if (!fields.length) return err('Nada que actualizar');
    const sets   = fields.map(k => `${k} = ?`).join(', ');
    const values = fields.map(k => body[k]);
    await env.DB.prepare(`UPDATE contactos SET ${sets} WHERE id = ?`)
      .bind(...values, id).run();
    return ok({ updated: true });
  }

  if (contactoMatch && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM contactos WHERE id = ?')
      .bind(parseInt(contactoMatch[1])).run();
    return ok({ deleted: true });
  }

  // ── Config (hero) ──────────────────────────────────────────

  // POST /api/admin/hero (sube imagen a R2 y guarda URL en config)
  if (pathname === '/api/admin/hero' && method === 'POST') {
    const formData = await request.formData();
    const file = formData.get('hero');
    if (!file) return err('No se envió archivo');

    const bytes = await file.arrayBuffer();
    const key = `hero/hero.${file.type.split('/')[1] || 'jpg'}`;
    await env.BUCKET.put(key, bytes, {
      httpMetadata: { contentType: file.type },
    });
    const url = `https://assets.condesamansion.com.ar/${key}`;
    await env.DB.prepare(
      'INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor'
    ).bind('hero_url', url).run();
    return ok({ url });
  }

  // POST /api/admin/hero-mobile
  if (pathname === '/api/admin/hero-mobile' && method === 'POST') {
    const formData = await request.formData();
    const file = formData.get('hero');
    if (!file) return err('No se envió archivo');
    const bytes = await file.arrayBuffer();
    const key = `hero/hero-mobile.${file.type.split('/')[1] || 'jpg'}`;
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: file.type } });
    const url = `https://assets.condesamansion.com.ar/${key}`;
    await env.DB.prepare(
      'INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor'
    ).bind('hero_url_mobile', url).run();
    return ok({ url });
  }

  // POST /api/admin/config (para otros valores clave/valor)
  if (pathname === '/api/admin/config' && method === 'POST') {
    const body = await parseBody(request);
    for (const [clave, valor] of Object.entries(body)) {
      await env.DB.prepare(
        'INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor'
      ).bind(clave, valor).run();
    }
    return ok({ ok: true });
  }

  // ── Álbumes ────────────────────────────────────────────────

  // GET /api/admin/albums
  if (pathname === '/api/admin/albums' && method === 'GET') {
    const r = await env.DB.prepare('SELECT * FROM albums ORDER BY creado_at DESC').all();
    return ok(r.results || []);
  }

  // POST /api/admin/albums
  if (pathname === '/api/admin/albums' && method === 'POST') {
    const body = await parseBody(request);
    if (!body.nombre || !body.url) return err('Nombre y URL son requeridos');
    await env.DB.prepare('INSERT INTO albums (nombre, url) VALUES (?, ?)').bind(body.nombre, body.url).run();
    return ok({ ok: true }, 201);
  }

  // DELETE /api/admin/albums/:id
  const albumMatch = pathname.match(/^\/api\/admin\/albums\/(\d+)$/);
  if (albumMatch && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM albums WHERE id = ?').bind(parseInt(albumMatch[1])).run();
    return ok({ deleted: true });
  }

  // ── Promos ─────────────────────────────────────────────────

  // GET /api/admin/promos
  if (pathname === '/api/admin/promos' && method === 'GET') {
    const r = await env.DB.prepare('SELECT * FROM promos ORDER BY orden ASC, creado_at DESC').all();
    return ok(r.results || []);
  }

  // POST /api/admin/promos
  if (pathname === '/api/admin/promos' && method === 'POST') {
    let nombre, descripcion, whatsapp, imagen_url = null;

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      nombre      = formData.get('nombre') || null;
      descripcion = formData.get('descripcion');
      whatsapp    = formData.get('whatsapp') === '1' ? 1 : 0;
      const file  = formData.get('imagen');
      if (file && file.size > 0) {
        const bytes = await file.arrayBuffer();
        const key   = `promos/promo-${Date.now()}.${file.type.split('/')[1] || 'jpg'}`;
        await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: file.type } });
        imagen_url = `https://assets.condesamansion.com.ar/${key}`;
      }
    } else {
      const body  = await parseBody(request);
      nombre      = body.nombre || null;
      descripcion = body.descripcion;
      whatsapp    = body.whatsapp ? 1 : 0;
      imagen_url  = body.imagen_url || null;
    }

    if (!descripcion) return err('Descripción es requerida');

    const maxOrden = await env.DB.prepare('SELECT MAX(orden) as max FROM promos').first();
    const orden    = (maxOrden?.max ?? 0) + 1;

    await env.DB.prepare(
      'INSERT INTO promos (nombre, descripcion, imagen_url, activa, whatsapp, orden) VALUES (?, ?, ?, 1, ?, ?)'
    ).bind(nombre, descripcion, imagen_url, whatsapp, orden).run();

    return ok({ ok: true }, 201);
  }

  // PUT /api/admin/promos/:id (actualizar orden)
  const promoMatch = pathname.match(/^\/api\/admin\/promos\/(\d+)$/);
  if (promoMatch && method === 'PUT') {
    const id = parseInt(promoMatch[1]);
    const body = await parseBody(request);
    if (body.orden !== undefined) {
      await env.DB.prepare('UPDATE promos SET orden = ? WHERE id = ?').bind(body.orden, id).run();
    }
    return ok({ ok: true });
  }

  // DELETE /api/admin/promos/:id
  if (promoMatch && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM promos WHERE id = ?').bind(parseInt(promoMatch[1])).run();
    return ok({ deleted: true });
  }

  return null; // no matcheó ningún endpoint admin
}
