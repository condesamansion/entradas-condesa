// workers/api/lib/qr.js

export async function generarQRBase64(token, baseUrl) {
  const url = `${baseUrl}/e/${token}`;

  const params = new URLSearchParams({
    text: url,
    size: '400',
    margin: '3',
    dark: '111111',
    light: 'f5f5f5',
    ecLevel: 'H',
    format: 'png',
  });

  const qrApiUrl = `https://quickchart.io/qr?${params.toString()}`;

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

export async function subirQRaR2(bucket, token, base64) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const key = `qr/${token}.png`;
  await bucket.put(key, bytes, {
    httpMetadata: { contentType: 'image/png' },
  });
  return key;
}

export async function procesarQR(token, baseUrl, bucket) {
  const base64 = await generarQRBase64(token, baseUrl);

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
