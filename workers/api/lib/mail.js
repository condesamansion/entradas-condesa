// workers/api/lib/mail.js
const RESEND_API = 'https://api.resend.com/emails';
const FROM = 'Condesa <onboarding@resend.dev>';

export async function enviarMailQR({ resendKey, entrada, tipoNombre, eventoNombre, eventoFecha, qrBase64, qrUrl }) {
  const fechaFormateada = formatearFecha(eventoFecha);
  const totalPersonas = 1 + (entrada.invitados_count || 0);

  const invitadosTexto = entrada.invitados_count > 0
    ? `<p style="margin:4px 0 0;color:#888888;font-size:13px;">+ ${entrada.invitados_count} invitado${entrada.invitados_count > 1 ? 's' : ''}</p>`
    : '';

  const mensajeEspecial = entrada.mensaje_especial
    ? `<div style="border-left:3px solid #f1f1f1;padding:12px 16px;margin:24px 0;background:#2a2a2a;">
        <p style="color:#f1f1f1;margin:0;font-size:13px;line-height:1.5;">${entrada.mensaje_especial}</p>
       </div>`
    : '';

  const logoSvg = `<svg width="48" height="38" viewBox="0 0 1010.6 797.7" xmlns="http://www.w3.org/2000/svg">
    <path fill="#f1f1f1" d="M728.1,332.9c8.6-39.6,13.5-74.4,11.6-111.2C734,91.3,642,0,505.3,0S276.5,91.1,270.8,221.6c-1.7,35.5,2.5,68.9,11.7,111.2c20.2,96.5,59.6,204.8,100.4,292.4c33.5,1.3,70.5,2,110.8,2c-94-136-186.4-443.7,11.7-443.7s105.8,307.7,11.7,443.7c40.3,0,77.2-0.8,110.8-2C668,537.4,707.9,429.2,728.1,332.9z"/>
    <path fill="#f1f1f1" d="M148,434.2c-14.4-92.8,55-129.4,116.6-109.1c-8-40.6-12.7-76.5-8.7-117.9c-25.2-21.6-63.2-42.1-113.6-42.1S-21.5,196.5,4.2,350.2c16.9,101.5,110.8,197.4,172.6,251l27.5,5.7c20,5.1,47.4,9.3,81.5,12.5C239.9,581.4,160.3,507.3,148,434.2z"/>
    <path fill="#f1f1f1" d="M868.3,165.1c-50.4,0-88.4,20.5-113.6,42.1c2.6,27.2,1.6,56-3,85.7c-1.7,10.7-3.6,21.5-5.7,32.2c10.2-3.4,21.7-5.4,34.3-5.4c42.6,0,95.1,32,82.3,114.5c-11.3,73-90.9,147.2-137.9,185.2c59.5-5.7,109-18.2,109-18.2c61.8-53.5,155.7-149.4,172.6-251C1032.1,196.5,933.8,165.1,868.3,165.1z"/>
  </svg>`;

  const qrBlock = qrUrl
    ? `<img src="${qrUrl}" width="260" height="260" alt="Código QR de ingreso" style="display:block;border:0;" />`
    : `<p style="margin:0;color:#888888;font-size:13px;">Tu QR está adjunto a este mail como <strong>entrada-condesa.png</strong></p>`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Tu entrada — ${eventoNombre}</title>
</head>
<body style="margin:0;padding:0;background:#1a1a1a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#222222;">

        <tr>
          <td style="padding:32px 40px 24px;border-bottom:1px solid #333333;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>${logoSvg}</td>
                <td align="right" style="vertical-align:middle;">
                  <span style="color:#888888;font-size:10px;letter-spacing:3px;text-transform:uppercase;">Vertical Producciones</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:32px 40px 0;">
            <p style="margin:0 0 8px;color:#888888;font-size:10px;letter-spacing:3px;text-transform:uppercase;">${fechaFormateada}</p>
            <h1 style="margin:0 0 8px;color:#f1f1f1;font-size:32px;font-weight:800;letter-spacing:-1px;line-height:1;">${eventoNombre}</h1>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #333333;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 4px;color:#888888;font-size:10px;letter-spacing:2px;text-transform:uppercase;">Titular</p>
                  <p style="margin:0;color:#f1f1f1;font-size:22px;font-weight:700;">${entrada.nombre} ${entrada.apellido}</p>
                  <p style="margin:6px 0 0;color:#888888;font-size:13px;">${tipoNombre} &nbsp;·&nbsp; ${totalPersonas} persona${totalPersonas > 1 ? 's' : ''}</p>
                  ${invitadosTexto}
                  ${entrada.dni ? `<p style="margin:6px 0 0;color:#555555;font-size:12px;">DNI: ${entrada.dni}</p>` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${mensajeEspecial ? `<tr><td style="padding:0 40px 24px;">${mensajeEspecial}</td></tr>` : ''}

        <tr>
          <td align="center" style="padding:0 40px 40px;">
            <p style="margin:0 0 20px;color:#888888;font-size:10px;letter-spacing:3px;text-transform:uppercase;">Código de ingreso</p>
            <table cellpadding="0" cellspacing="0" style="background:#f5f5f5;display:inline-table;">
              <tr>
                <td style="padding:20px;">
                  ${qrBlock}
                </td>
              </tr>
            </table>
            <p style="margin:16px 0 0;color:#555555;font-size:11px;letter-spacing:1px;">Presentá este QR en la puerta · Uso único</p>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 40px;border-top:1px solid #333333;">
            <p style="margin:0;color:#444444;font-size:11px;line-height:1.6;">
              Esta entrada es personal e intransferible. El código QR solo puede escanearse una vez.
              Si tenés algún problema, contactanos por Instagram.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 40px;background:#1a1a1a;">
            <p style="margin:0;color:#333333;font-size:11px;">© Condesa · Vertical Producciones</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const attachments = qrUrl ? [] : [{
    filename: 'entrada-condesa.png',
    content: qrBase64,
    content_type: 'image/png',
  }];

  const payload = {
    from: FROM,
    to: [entrada.mail],
    subject: `Tu entrada para ${eventoNombre} 🎫`,
    html,
    ...(attachments.length > 0 && { attachments }),
  };

  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend error ${res.status}: ${errText}`);
  }

  return res.json();
}

function formatearFecha(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).toUpperCase();
}
