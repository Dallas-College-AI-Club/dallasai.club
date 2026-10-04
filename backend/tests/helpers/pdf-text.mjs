import { inflateSync } from 'node:zlib';
// The text a jsPDF file draws, in order: each content stream is inflated and
// its text operations read. Each run has its colour ('r g b' from 0 to 1),
// its position in points from the bottom-left corner, and its text. Built-in
// fonts use Windows-1252, which TextDecoder calls latin1.
export function pdfRuns(bytes) {
  const runs = [];
  for (const match of Buffer.from(bytes)
    .toString('latin1')
    .matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const stream = Buffer.from(match[1], 'latin1');
    let content;
    try {
      content = inflateSync(stream);
    } catch {
      content = stream;
    }
    for (const [, color, x, y, text] of new TextDecoder('latin1')
      .decode(content)
      .matchAll(
        /([\d.]+ [\d.]+ [\d.]+) rg\s+([\d.-]+) ([\d.-]+) Td\s+\(((?:\\.|[^\\)])*)\) Tj/g,
      ))
      runs.push({
        color,
        x: Number(x),
        y: Number(y),
        text: text.replace(/\\(.)/g, '$1'),
      });
  }
  return runs;
}
export const pdfLines = (bytes) => pdfRuns(bytes).map((run) => run.text);
