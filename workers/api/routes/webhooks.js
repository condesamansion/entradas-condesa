// workers/api/routes/webhooks.js
// Webhook de MercadoPago — valida firma, confirma pago, genera QR, envía mail

import { confirmarPago, getEntradaByPreferenceId, getTipoEntradaById, getEventoById } from '../lib/db.js';
import { validarWebhookFirma, getPago } from '../lib/mp.js';
import { procesarQR } from '../lib/qr.js';
import { enviarMailQR } from '../lib/mail.js';

export async function handleWebhooks(request, env, pathname) {
  // POST /api/webhooks/mercadopago
  if (pathname !== '/api/webhooks/mercadopago' || request.method !== 'POST') {
    return null;
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // Solo procesar notificaciones de pago
  if (body.type !== 'payment') {
    return new Response('OK', { status: 200 });
  }

  const paymentId = body.data?.id;
  if (!paymentId) return new Response('OK', { status: 200 });

  // Validar firma del webhook
  const xSignature = request.headers.get('x-signature');
  const xRequestId = request.headers.get('x-request-id');

  const firmaValida = await validarWebhookFirma({
    secret: env.MP_WEBHOOK_SECRET,
    xSignature,
    xRequestId,
    dataId: String(paymentId),
  });

  if (!firmaValida) {
    console.warn('Webhook MP: firma inválida');
    return new Response('Unauthorized', { status: 401 });
  }

  // Obtener datos del pago desde la API de MP
  let pago;
  try {
    pago = await getPago(env.MP_ACCESS_TOKEN, paymentId);
  } catch (e) {
    console.error('Error obteniendo pago MP:', e.message);
    return new Response('Error', { status: 500 });
  }

  // Solo procesar pagos aprobados
  if (pago.status !== 'approved') {
    return new Response('OK', { status: 200 });
  }

  const preferenceId = pago.preference_id;

  // Buscar la entrada por preference_id
  const entrada = await getEntradaByPreferenceId(env.DB, preferenceId);
  if (!entrada) {
    console.warn(`Webhook MP: no se encontró entrada para preference ${preferenceId}`);
    return new Response('OK', { status: 200 });
  }

  // Idempotencia: si ya está en estado 'valida', no procesar de nuevo
  if (entrada.estado === 'valida' || entrada.estado === 'usada') {
    console.log(`Webhook MP: entrada ${entrada.id} ya procesada`);
    return new Response('OK', { status: 200 });
  }

  // Confirmar pago en DB
  await confirmarPago(env.DB, String(paymentId), preferenceId);

  // Generar QR
  let qrBase64, qrUrl;
  try {
    const qr = await procesarQR(entrada.qr_token, env.QR_BASE_URL, env.BUCKET);
    qrBase64 = qr.base64;
    qrUrl = qr.url;
  } catch (e) {
    console.error('Error generando QR post-pago:', e.message);
    // No retornar error — el pago ya está confirmado, el QR puede reintentarse
    return new Response('OK', { status: 200 });
  }

  // Obtener datos para el mail
  const [tipo, evento] = await Promise.all([
    getTipoEntradaById(env.DB, entrada.tipo_entrada_id),
    getEventoById(env.DB, entrada.evento_id),
  ]);

  // Enviar mail con QR
  try {
    await enviarMailQR({
      resendKey: env.RESEND_API_KEY,
      entrada,
      tipoNombre: tipo.nombre,
      eventoNombre: evento.nombre,
      eventoFecha: evento.fecha,
      qrBase64,
      qrUrl,
    });
  } catch (e) {
    console.error('Error enviando mail post-pago:', e.message);
  }

  return new Response('OK', { status: 200 });
}
