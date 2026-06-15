# entradas-qr-condesa — CLAUDE.md

Sistema de entradas con QR para boliche nocturno. Marca: **Vertical Producciones / Condesa**.

## Stack
- **Backend**: Cloudflare Workers (JS ESM)
- **DB**: Cloudflare D1 (SQLite) — binding `DB`
- **Storage**: Cloudflare R2 — binding `BUCKET`
- **Auth**: Cloudflare Access + Google OAuth
- **Mail**: Resend (`RESEND_API_KEY`)
- **Pagos**: MercadoPago Checkout Pro (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`)
- **QR**: npm `qrcode`
- **Frontend**: HTML/JS vanilla (Cloudflare Pages)

## Estructura
```
workers/api/
  index.js          ← router principal (entry point)
  schema.sql        ← DDL de la DB
  routes/
    admin.js        ← /api/admin/* (protegido por CF Access)
    publico.js      ← /api/evento-activo, /api/entradas
    scan.js         ← /api/scan/:token (protegido por CF Access)
    webhooks.js     ← /api/webhooks/mercadopago
  lib/
    db.js           ← helpers D1
    qr.js           ← generación QR + subida R2
    mail.js         ← Resend
    mp.js           ← MercadoPago
    utils.js        ← uuid, ok(), err(), CORS, validaciones
pages/
  index.html        ← web pública (cliente compra)
  admin/            ← panel admin
  scan/             ← escáner portero
```

## Identidad visual
- **Fondo**: `#333333`
- **Texto / bordes**: `#f1f1f1`
- **Fuente**: Montserrat (Google Fonts), pesos 300–800
- Assets en `/` del proyecto: `logo.svg`, `logohorizontal.svg`, `slogan.svg`, `favicon.svg`
- Slogan en `#f1f1f1` (ya corregido)
- Sin border-radius excesivo, estética limpia

## Roles
| Rol | Ruta | Auth |
|-----|------|------|
| admin | `/api/admin/*` | Cloudflare Access |
| portero | `/api/scan/*` | Cloudflare Access |
| cliente | `/api/evento-activo`, `/api/entradas` | Público |

## Flujos clave
1. **Admin → invitación**: POST `/api/admin/invitaciones` → genera QR → mail
2. **Cliente → pago**: POST `/api/entradas` → MP preference → webhook → QR → mail
3. **Portero → escaneo**: GET `/api/scan/:token` → valida → marca usada → UI semafórica

## Secrets (wrangler secret put)
```
RESEND_API_KEY
MP_ACCESS_TOKEN
MP_WEBHOOK_SECRET
QR_BASE_URL=https://entradas.condesa.com.ar
```

## Setup inicial
```bash
npm install
wrangler d1 create entradas-qr-db          # crear DB
wrangler r2 bucket create entradas-qr-assets
npm run db:init                             # aplicar schema (local)
npm run db:init:remote                      # aplicar schema (producción)
npm run dev                                 # desarrollo local
npm run deploy                              # deploy
```
