import { inflateSync } from 'node:zlib';
// The lines of text a jsPDF file draws, in order: each content stream is
// inflated and its (…) Tj strings unescaped. Built-in fonts use
// Windows-1252, which TextDecoder calls latin1.
export function pdfLines(bytes) {
  const raw = Buffer.from(bytes),
    lines = [];
  for (const match of raw
    .toString('latin1')
    .matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const stream = Buffer.from(match[1], 'latin1');
    let content;
    try {
      content = inflateSync(stream);
    } catch {
      content = stream;
    }
    for (const [, text] of new TextDecoder('latin1')
      .decode(content)
      .matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g))
      lines.push(text.replace(/\\(.)/g, '$1'));
  }
  return lines;
}
