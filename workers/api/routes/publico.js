// workers/api/routes/publico.js
// Endpoints públicos: evento activo, compra de entrada, páginas de resultado pago

import {
  getEventoActivo, getTiposEntrada,
  createEntrada, checkCupo, getTipoEntradaById, getEventoById,
} from '../lib/db.js';
import { procesarQR } from '../lib/qr.js';
import { enviarMailQR } from '../lib/mail.js';
import { crearPreference } from '../lib/mp.js';
import { uuid, ok, err, validarCampos, validarEmail, parseBody } from '../lib/utils.js';

export async function handlePublico(request, env, pathname) {
  const method = request.method;

  // ── GET /api/evento-activo ─────────────────────────────────
  if (pathname === '/api/evento-activo' && method === 'GET') {
    const evento = await getEventoActivo(env.DB);
    if (!evento) {
      return ok({ evento: null, tipos: [] });
    }

    // Solo tipos visibles al público y con precio (clientes pagan)
    const tipos = await getTiposEntrada(env.DB, evento.id, { soloPublicos: true });

    // Filtrar los que tienen precio > 0 y están activos
    const tiposPublicos = tipos.filter(t => t.precio > 0 && t.activo);

    return ok({ evento, tipos: tiposPublicos });
  }

  // ── POST /api/entradas — cliente compra ───────────────────
  if (pathname === '/api/entradas' && method === 'POST') {
    const body = await parseBody(request);
    const error = validarCampos(body, ['nombre', 'apellido', 'mail', 'tipo_entrada_id']);
    if (error) return err(error);

    if (!validarEmail(body.mail)) return err('Email inválido');

    // Verificar tipo de entrada
    const tipo = await getTipoEntradaById(env.DB, body.tipo_entrada_id);
    if (!tipo) return err('Tipo de entrada no encontrado', 404);
    if (!tipo.activo) return err('Este tipo de entrada no está disponible', 409);
    if (!tipo.visible_publico) return err('Este tipo de entrada no está disponible', 409);
    if (tipo.precio === 0) return err('Las entradas gratuitas solo se obtienen por invitación', 403);

    // Verificar cupo
    const cupo = await checkCupo(env.DB, body.tipo_entrada_id);
    if (!cupo.ok) return err(cupo.error, 409);

    // Obtener evento activo y verificar que coincide
    const evento = await getEventoActivo(env.DB);
    if (!evento) return err('No hay evento activo', 404);
    if (evento.id !== tipo.evento_id) return err('Evento incorrecto', 400);

    const token = uuid();

    // Crear entrada en estado pendiente_pago
    const entradaId = await createEntrada(env.DB, {
      tipo_entrada_id: tipo.id,
      evento_id: evento.id,
      nombre: body.nombre,
      apellido: body.apellido,
      mail: body.mail,
      telefono: body.telefono,
      usuario_ig: body.usuario_ig,
      qr_token: token,
      origen: 'cliente',
      estado: 'pendiente_pago',
      precio: tipo.precio, // para el payload de MP
    });

    // Crear preference de MercadoPago
    let preference;
    try {
      preference = await crearPreference({
        accessToken: env.MP_ACCESS_TOKEN,
        entrada: {
          tipo_entrada_id: tipo.id,
          precio: tipo.precio,
          nombre: body.nombre,
          apellido: body.apellido,
          mail: body.mail,
          telefono: body.telefono,
          invitados_count: 0,
        },
        tipoNombre: tipo.nombre,
        eventoNombre: evento.nombre,
        baseUrl: env.QR_BASE_URL,
      });
    } catch (e) {
      return err(`Error creando preferencia de pago: ${e.message}`, 500);
    }

    // Guardar mp_preference_id en la entrada
    await env.DB
      .prepare('UPDATE entradas SET mp_preference_id = ? WHERE id = ?')
      .bind(preference.id, entradaId)
      .run();

    return ok(
      {
        entrada_id: entradaId,
        qr_token: token,
        mp_init_point: preference.init_point,
        mp_preference_id: preference.id,
      },
      201
    );
  }

  // GET /api/landing
  if (pathname === '/api/landing' && method === 'GET') {
    const [eventosRes, albumsRes, promosRes, configRes] = await Promise.all([
      env.DB.prepare('SELECT * FROM eventos ORDER BY fecha ASC').all(),
      env.DB.prepare('SELECT * FROM albums ORDER BY creado_at DESC').all(),
      env.DB.prepare('SELECT * FROM promos WHERE activa = 1 ORDER BY creado_at DESC').all(),
      env.DB.prepare('SELECT * FROM config').all(),
    ]);

    const config = {};
    for (const row of (configRes.results || [])) {
      config[row.clave] = row.valor;
    }

    return ok({
      eventos:  eventosRes.results  || [],
      albums:   albumsRes.results   || [],
      promos:   promosRes.results   || [],
      config,
    });
  }

  return null;
}
