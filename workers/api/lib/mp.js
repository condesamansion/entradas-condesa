// workers/api/lib/mp.js
// Integración con MercadoPago Checkout Pro

const MP_API = 'https://api.mercadopago.com';

/**
 * Crea una preference de pago en MercadoPago
 * @returns {Promise<{id: string, init_point: string}>}
 */
export async function crearPreference({ accessToken, entrada, tipoNombre, eventoNombre, baseUrl }) {
  const totalPersonas = 1 + (entrada.invitados_count || 0);
  const titulo = `${eventoNombre} — ${tipoNombre}${totalPersonas > 1 ? ` (${totalPersonas} personas)` : ''}`;

  const payload = {
    items: [
      {
        id: String(entrada.tipo_entrada_id),
        title: titulo,
        quantity: 1,
        unit_price: entrada.precio,
        currency_id: 'ARS',
      },
    ],
    payer: {
      name: entrada.nombre,
      surname: entrada.apellido,
      email: entrada.mail,
      phone: entrada.telefono ? { number: entrada.telefono } : undefined,
    },
    back_urls: {
      success: `${baseUrl}/pago/exito`,
      failure: `${baseUrl}/pago/error`,
      pending: `${baseUrl}/pago/pendiente`,
    },
    auto_return: 'approved',
    notification_url: `${baseUrl}/api/webhooks/mercadopago`,
    external_reference: entrada.qr_token, // usamos el token como referencia única
    statement_descriptor: 'CONDESA',
    expires: false,
    payment_methods: {
      excluded_payment_types: [],
      installments: 1,
    },
  };

  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MP error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    init_point: data.init_point, // URL de pago producción
    sandbox_init_point: data.sandbox_init_point,
  };
}

/**
 * Obtiene info de un pago por su ID
 */
export async function getPago(accessToken, paymentId) {
  const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) throw new Error(`MP getPago error ${res.status}`);
  return res.json();
}

/**
 * Valida la firma del webhook de MercadoPago
 * Header: x-signature  → ts=...,v1=...
 * Header: x-request-id → id único del request
 */
export async function validarWebhookFirma({ secret, xSignature, xRequestId, dataId }) {
  if (!xSignature || !secret) return false;

  const parts = Object.fromEntries(
    xSignature.split(',').map(p => p.split('='))
  );
  const ts = parts['ts'];
  const v1 = parts['v1'];

  if (!ts || !v1) return false;

  // Mensaje a hashear: id + ts + data.id
  const manifest = `id:${xRequestId};request-id:${xRequestId};ts:${ts};`;
  // Nota: MP firma: "id:{data.id};request-id:{x-request-id};ts:{ts};"
  const toSign = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const keyBytes = new TextEncoder().encode(secret);
  const msgBytes = new TextEncoder().encode(toSign);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return computed === v1;
}
