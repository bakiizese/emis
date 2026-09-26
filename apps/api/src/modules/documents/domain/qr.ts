import QRCode from 'qrcode';

/** A QR code as an inline SVG string (no image files, no external requests). */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#111111', light: '#ffffff' },
  });
}
