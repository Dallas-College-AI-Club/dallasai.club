// Turns page 1 of a PDF flyer into a JPEG the event image upload accepts.
// Loaded on demand, so officers who never pick a PDF never download PDF.js.
// The legacy build carries polyfills (such as Uint8Array#toHex) in both this
// chunk and its worker, so phones and browsers a few versions old still work.
import {
  getDocument,
  GlobalWorkerOptions,
} from 'pdfjs-dist/legacy/build/pdf.mjs';

// The build copies the worker, PDF.js's plain-JavaScript image decoders and
// its character maps next to this file. The Club Office CSP allows scripts and
// workers from 'self' only and no WebAssembly, so without the decoders JPEG
// 2000 and JBIG2 images (common in scanned flyers) would silently render
// blank, and without the maps Chinese, Japanese or Korean text would vanish.
GlobalWorkerOptions.workerSrc = new URL(
  './pdf.worker.js',
  import.meta.url,
).href;
const assets = new URL('./pdfjs/', import.meta.url).href;

export async function pdfFlyerImage(file, longSide = 2400, maxBytes = 2097152) {
  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useWasm: false,
    wasmUrl: assets,
    cMapUrl: assets + 'cmaps/',
    cMapPacked: true,
  });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: longSide / Math.max(base.width, base.height),
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    // A detailed page may not fit at full size; the server keeps at most
    // 1800 px anyway, so try smaller copies before giving up.
    for (const scale of [1, 0.75, 0.5]) {
      let image = canvas;
      if (scale < 1) {
        image = document.createElement('canvas');
        image.width = Math.round(canvas.width * scale);
        image.height = Math.round(canvas.height * scale);
        image
          .getContext('2d')
          .drawImage(canvas, 0, 0, image.width, image.height);
      }
      for (const quality of [0.9, 0.8, 0.7, 0.6]) {
        const blob = await new Promise((resolve) =>
          image.toBlob(resolve, 'image/jpeg', quality),
        );
        if (blob && blob.size <= maxBytes) return { blob, pages: pdf.numPages };
      }
    }
    throw Error('The first page is too detailed to fit in 2 MB.');
  } finally {
    await task.destroy();
  }
}
