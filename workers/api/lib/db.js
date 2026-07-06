// workers/api/lib/db.js
// Helpers para Cloudflare D1 (SQLite)

// ── Eventos ──────────────────────────────────────────────────

export async function getEventoActivo(db) {
  return db.prepare('SELECT * FROM eventos WHERE activo = 1 ORDER BY fecha ASC LIMIT 1').first();
}

export async function getEventosActivos(db) {
  return (await db.prepare('SELECT * FROM eventos WHERE activo = 1 ORDER BY fecha ASC').all()).results;
}

export async function getEventos(db) {
  return (await db.prepare('SELECT * FROM eventos ORDER BY creado_at DESC').all()).results;
}

export async function getEventoById(db, id) {
  return db.prepare('SELECT * FROM eventos WHERE id = ?').bind(id).first();
}

export async function createEvento(db, data) {
  const { nombre, fecha, descripcion, flyer_url, creado_por } = data;
  const r = await db
    .prepare(
      'INSERT INTO eventos (nombre, fecha, descripcion, flyer_url, creado_por) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(nombre, fecha, descripcion ?? null, flyer_url ?? null, creado_por ?? null)
    .run();
  return r.meta.last_row_id;
}

export async function updateEvento(db, id, data) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(data)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  values.push(id);
  return db
    .prepare(`UPDATE eventos SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function setEventoActivo(db, id, activo) {
  return db.prepare('UPDATE eventos SET activo = ? WHERE id = ?').bind(activo ? 1 : 0, id).run();
}

// ── Tipos de entrada ─────────────────────────────────────────

export async function getTiposEntrada(db, eventoId, { soloPublicos = false } = {}) {
  let sql = 'SELECT * FROM tipos_entrada WHERE evento_id = ? AND activo = 1';
  if (soloPublicos) sql += ' AND visible_publico = 1';
  return (await db.prepare(sql).bind(eventoId).all()).results;
}

export async function getTipoEntradaById(db, id) {
  return db.prepare('SELECT * FROM tipos_entrada WHERE id = ?').bind(id).first();
}

export async function createTipoEntrada(db, data) {
  const { evento_id, nombre, precio, beneficios, restriccion_edad, cupo_maximo, visible_publico, creado_por } = data;
  const r = await db
    .prepare(
      `INSERT INTO tipos_entrada
        (evento_id, nombre, precio, beneficios, restriccion_edad, cupo_maximo, visible_publico, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      evento_id,
      nombre,
      precio ?? 0,
      beneficios ?? null,
      restriccion_edad ?? null,
      cupo_maximo ?? null,
      visible_publico ?? 1,
      creado_por ?? null
    )
    .run();
  return r.meta.last_row_id;
}

export async function updateTipoEntrada(db, id, data) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(data)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  values.push(id);
  return db
    .prepare(`UPDATE tipos_entrada SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

// Verificar cupo disponible antes de crear una entrada
export async function checkCupo(db, tipoEntradaId) {
  const tipo = await getTipoEntradaById(db, tipoEntradaId);
  if (!tipo) return { ok: false, error: 'Tipo de entrada no encontrado' };
  if (!tipo.cupo_maximo) return { ok: true }; // sin límite

  const { results } = await db
    .prepare(
      `SELECT COUNT(*) as total FROM entradas
       WHERE tipo_entrada_id = ? AND estado != 'pendiente_pago'`
    )
    .bind(tipoEntradaId)
    .all();

  const usadas = results[0]?.total ?? 0;
  if (usadas >= tipo.cupo_maximo) {
    return { ok: false, error: 'No hay cupo disponible para este tipo de entrada' };
  }
  return { ok: true, disponibles: tipo.cupo_maximo - usadas };
}

// ── Entradas ─────────────────────────────────────────────────

export async function getEntradaByToken(db, token) {
  return db
    .prepare(
      `SELECT e.*, te.nombre as tipo_nombre, te.beneficios, te.precio,
              te.restriccion_edad, ev.nombre as evento_nombre, ev.fecha as evento_fecha
       FROM entradas e
       JOIN tipos_entrada te ON te.id = e.tipo_entrada_id
       JOIN eventos ev ON ev.id = e.evento_id
       WHERE e.qr_token = ?`
    )
    .bind(token)
    .first();
}

export async function getEntradasByEvento(db, eventoId, { tipo_id, estado } = {}) {
  let sql = `
    SELECT e.*, te.nombre as tipo_nombre, te.precio, e.creado_por
    FROM entradas e
    JOIN tipos_entrada te ON te.id = e.tipo_entrada_id
    WHERE e.evento_id = ?`;
  const binds = [eventoId];

  if (tipo_id) {
    sql += ' AND e.tipo_entrada_id = ?';
    binds.push(tipo_id);
  }
  if (estado) {
    sql += ' AND e.estado = ?';
    binds.push(estado);
  }

  sql += ' ORDER BY e.creado_at DESC';
  return (await db.prepare(sql).bind(...binds).all()).results;
}

export async function getEstadisticasEvento(db, eventoId) {
  const { results } = await db
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN estado = 'valida'         THEN 1 ELSE 0 END) as validas,
         SUM(CASE WHEN estado = 'usada'          THEN 1 ELSE 0 END) as usadas,
         SUM(CASE WHEN estado = 'pendiente_pago' THEN 1 ELSE 0 END) as pendientes_pago
       FROM entradas WHERE evento_id = ?`
    )
    .bind(eventoId)
    .all();
  return results[0] ?? { total: 0, validas: 0, usadas: 0, pendientes_pago: 0 };
}

export async function createEntrada(db, data) {
  const {
    tipo_entrada_id, evento_id,
    nombre, apellido, mail, telefono, usuario_ig, dni,
    invitados_count, invitados_detalle,
    qr_token, origen, estado, mensaje_especial,
    mp_preference_id, creado_por,
  } = data;

  const r = await db
    .prepare(
      `INSERT INTO entradas
        (tipo_entrada_id, evento_id,
         nombre, apellido, mail, telefono, usuario_ig, dni,
         invitados_count, invitados_detalle,
         qr_token, origen, estado, mensaje_especial, mp_preference_id, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      tipo_entrada_id, evento_id,
      nombre, apellido, mail, telefono ?? null, usuario_ig ?? null, dni ?? null,
      invitados_count ?? 0,
      invitados_detalle ? JSON.stringify(invitados_detalle) : null,
      qr_token,
      origen ?? 'admin',
      estado ?? 'valida',
      mensaje_especial ?? null,
      mp_preference_id ?? null,
      creado_por ?? null
    )
    .run();
  return r.meta.last_row_id;
}

export async function marcarEntradaUsada(db, token) {
  return db
    .prepare(
      `UPDATE entradas SET estado = 'usada', usado_at = datetime('now')
       WHERE qr_token = ? AND estado = 'valida'`
    )
    .bind(token)
    .run();
}

export async function confirmarPago(db, mpPaymentId, mpPreferenceId) {
  return db
    .prepare(
      `UPDATE entradas
       SET estado = 'valida', mp_payment_id = ?
       WHERE mp_preference_id = ? AND estado = 'pendiente_pago'`
    )
    .bind(mpPaymentId, mpPreferenceId)
    .run();
}

export async function getEntradaByPreferenceId(db, preferenceId) {
  return db
    .prepare('SELECT * FROM entradas WHERE mp_preference_id = ?')
    .bind(preferenceId)
    .first();
}
