-- ============================================================
-- Schema: Sistema de Entradas QR — Condesa
-- DB: Cloudflare D1 (SQLite)
-- Aplicar con: wrangler d1 execute entradas-qr-db --file=workers/api/schema.sql
-- ============================================================

-- Eventos
CREATE TABLE IF NOT EXISTS eventos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT    NOT NULL,
  fecha       TEXT    NOT NULL,           -- ISO8601: "2025-03-15T23:00:00"
  descripcion TEXT,
  flyer_url   TEXT,                       -- URL pública en R2
  activo      INTEGER DEFAULT 0,          -- 0|1 — solo 1 activo a la vez
  creado_at   TEXT    DEFAULT (datetime('now')),
  creado_por  TEXT                        -- usuario del panel que lo creó
);

-- Tipos de entrada (por evento)
CREATE TABLE IF NOT EXISTS tipos_entrada (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id        INTEGER NOT NULL REFERENCES eventos(id),
  nombre           TEXT    NOT NULL,      -- "VIP", "Free +21", etc.
  precio           INTEGER DEFAULT 0,     -- ARS, 0 = gratis
  beneficios       TEXT,                  -- texto libre
  restriccion_edad INTEGER,               -- NULL | 16 | 18 | 21
  cupo_maximo      INTEGER,               -- NULL = sin límite
  visible_publico  INTEGER DEFAULT 1,     -- 0|1
  activo           INTEGER DEFAULT 1,
  creado_por       TEXT                   -- usuario del panel que lo creó
);

-- Entradas individuales (cada QR es una entrada)
CREATE TABLE IF NOT EXISTS entradas (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo_entrada_id    INTEGER NOT NULL REFERENCES tipos_entrada(id),
  evento_id          INTEGER NOT NULL REFERENCES eventos(id),

  -- Titular
  nombre             TEXT NOT NULL,
  apellido           TEXT NOT NULL,
  mail               TEXT NOT NULL,
  telefono           TEXT,
  usuario_ig         TEXT,
  dni                TEXT,

  -- Grupo
  invitados_count    INTEGER DEFAULT 0,   -- personas adicionales
  invitados_detalle  TEXT,                -- JSON: [{"nombre":"..."}]

  -- QR y estado
  qr_token           TEXT UNIQUE NOT NULL, -- UUID v4
  origen             TEXT DEFAULT 'admin', -- 'admin' | 'cliente'
  estado             TEXT DEFAULT 'valida',-- 'pendiente_pago' | 'valida' | 'usada'
  mensaje_especial   TEXT,

  -- Pago (solo entradas de clientes)
  mp_preference_id   TEXT,
  mp_payment_id      TEXT,

  -- Timestamps y auditoría
  creado_at          TEXT DEFAULT (datetime('now')),
  usado_at           TEXT,
  creado_por         TEXT                -- usuario del panel que generó la entrada
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_entradas_qr_token ON entradas(qr_token);
CREATE INDEX IF NOT EXISTS idx_entradas_evento   ON entradas(evento_id);
CREATE INDEX IF NOT EXISTS idx_entradas_mail     ON entradas(mail);
CREATE INDEX IF NOT EXISTS idx_tipos_evento      ON tipos_entrada(evento_id);
