// Render the picker with the same color key as the Three.js flag material.
// Source mascot artwork is retained unchanged on disk.
export function drawFlagPreview(canvas, image, color) {
  canvas.width = 144;
  canvas.height = 96;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, 144, 96);
  ctx.fillStyle = color.getStyle();
  ctx.fillRect(0, 0, 144, 96);
  const scale = Math.min(144 / image.width, 96 / image.height),
    w = image.width * scale,
    h = image.height * scale;
  ctx.drawImage(image, (144 - w) / 2, (96 - h) / 2, w, h);
  const pixels = ctx.getImageData(0, 0, 144, 96),
    a = pixels.data,
    linear = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4),
    srgb = (v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  for (let i = 0; i < a.length; i += 4) {
    const r = linear(a[i]),
      g = linear(a[i + 1]),
      b = linear(a[i + 2]),
      t = Math.max(0, Math.min(1, (Math.min(r, g, b) - 0.82) / 0.15)),
      key = t * t * (3 - 2 * t);
    a[i] = srgb(r + (color.r - r) * key);
    a[i + 1] = srgb(g + (color.g - g) * key);
    a[i + 2] = srgb(b + (color.b - b) * key);
  }
  ctx.putImageData(pixels, 0, 0);
}
