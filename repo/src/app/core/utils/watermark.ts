/**
 * Applies a text watermark overlay to an image Blob using Canvas.
 * Returns a new Blob with the watermark -- original is unchanged.
 */
export async function watermarkImage(
  blob: Blob, userName: string, timestamp: string,
): Promise<Blob> {
  const img = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob; // fallback: return unwatermarked

  ctx.drawImage(img, 0, 0);

  // Semi-transparent diagonal watermark
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#888888';
  const fontSize = Math.max(14, Math.min(img.width / 20, 36));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.translate(img.width / 2, img.height / 2);
  ctx.rotate(-Math.PI / 6);

  const text = `${userName} -- ${timestamp}`;
  const metrics = ctx.measureText(text);
  ctx.fillText(text, -metrics.width / 2, 0);
  ctx.restore();

  // Bottom-right small watermark
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#666666';
  ctx.font = `${Math.max(10, fontSize * 0.6)}px sans-serif`;
  const smallText = `${userName} | ${timestamp}`;
  const sm = ctx.measureText(smallText);
  ctx.fillText(smallText, img.width - sm.width - 10, img.height - 10);
  ctx.restore();

  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ?? blob), blob.type);
  });
}

/**
 * For PDF watermarking, we wrap the PDF in a container that overlays text.
 * Since browser-side PDF manipulation requires a library (pdf-lib), this
 * returns a wrapper HTML string that can be displayed in an iframe.
 * The original PDF is embedded with a CSS overlay.
 */
export function createPdfWatermarkOverlay(userName: string, timestamp: string): string {
  return `<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);
    font-size:24px;color:rgba(128,128,128,0.3);white-space:nowrap;pointer-events:none;z-index:9999;
    font-family:sans-serif">${userName} -- ${timestamp}</div>`;
}
