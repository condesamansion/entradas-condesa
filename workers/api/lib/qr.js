// workers/api/lib/qr.js
// Genera QR usando la API pública de QuickChart (sin canvas)

export async function generarQRBase64(token, baseUrl) {
  const url = `${baseUrl}/e/${token}`;

  // QuickChart QR API — gratuita, no requiere API key
  const qrApiUrl = `https://quickchart.io/qr?text=${encodeURIComponent(url)}&size=400&margin=2&dark=000000&light=ffffff&ecLevel=H`;

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

export async function procesarQR(token, baseUrl, bucket) {
  const base64 = await generarQRBase64(token, baseUrl);
  return { base64, url: null };
}
