// Turns page 1 of a PDF flyer into a JPEG the event image upload accepts.
// Loaded on demand, so officers who never pick a PDF never download PDF.js.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

// The build copies the worker and PDF.js's plain-JavaScript image decoders
// next to this file. The Club Office CSP allows scripts and workers from
// 'self' only and no WebAssembly, so without those decoders JPEG 2000 and
// JBIG2 images (common in scanned flyers) would silently render blank.
GlobalWorkerOptions.workerSrc = new URL(
  './pdf.worker.js',
  import.meta.url,
).href;

export async function pdfFlyerImage(file, longSide = 2400, maxBytes = 2097152) {
  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useWasm: false,
    wasmUrl: new URL('./pdfjs/', import.meta.url).href,
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
    for (const quality of [0.9, 0.8, 0.7, 0.6]) {
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      );
      if (blob && blob.size <= maxBytes) return { blob, pages: pdf.numPages };
    }
    throw Error('The first page is too detailed to fit in 2 MB.');
  } finally {
    await task.destroy();
  }
}
