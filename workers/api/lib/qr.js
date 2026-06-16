// workers/api/lib/qr.js

const LOGO_PNG_URL = 'https://assets.condesamansion.com.ar/logo-condesa.png';

function buildQrUrl({ text, conLogo = false }) {
  const params = new URLSearchParams({
    text,
    size: '400',
    margin: '3',
    dark: '111111',
    light: 'f5f5f5',
    ecLevel: 'H',
    format: 'png',
  });

  if (conLogo) {
    params.set('centerImageUrl', LOGO_PNG_URL);
    params.set('centerImageSizeRatio', '0.25');
  }

  return `https://quickchart.io/qr?${params.toString()}`;
}

async function fetchQrAsBase64(qrApiUrl) {
  const res = await fetch(qrApiUrl);
  if (!res.ok) throw new Error(`QuickChart error ${res.status}`);

  const arrayBuffer = await res.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function generarQRBase64(token, baseUrl) {
  const url = `${baseUrl}/e/${token}`;
  const qrApiUrl = buildQrUrl({ text: url });
  return fetchQrAsBase64(qrApiUrl);
}

export async function subirQRaR2(bucket, token, base64) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const key = `qr/${token}.png`;
  await bucket.put(key, bytes, {
    httpMetadata: { contentType: 'image/png' },
  });
  return key;
}

export async function procesarQR(token, baseUrl, bucket) {
  const qrUrl_destino = `${baseUrl}/e/${token}`;

  let base64 = null;
  let intentoConLogo = !!bucket;

  if (intentoConLogo) {
    try {
      const urlConLogo = buildQrUrl({ text: qrUrl_destino, conLogo: true });
      base64 = await fetchQrAsBase64(urlConLogo);
      console.log('QR generado con logo Condesa');
    } catch (e) {
      console.warn('QR con logo falló, generando sin logo:', e.message);
      intentoConLogo = false;
    }
  }

  if (!base64) {
    const urlSinLogo = buildQrUrl({ text: qrUrl_destino, conLogo: false });
    base64 = await fetchQrAsBase64(urlSinLogo);
  }

  let url = null;
  if (bucket) {
    try {
      const key = await subirQRaR2(bucket, token, base64);
      url = `https://assets.condesamansion.com.ar/${key}`;
    } catch (e) {
      console.error('Error subiendo QR a R2:', e.message);
    }
  }

  return { base64, url };
}
