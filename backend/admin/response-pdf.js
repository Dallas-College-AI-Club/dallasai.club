// Lays out a responseDocument() as a US Letter PDF. Loaded on demand, so
// jsPDF stays out of the Club Office's first download.
import { jsPDF } from 'jspdf';
// Helvetica, built into every PDF reader, has Windows-1252 glyphs only, and
// jsPDF garbles a whole line that contains anything else. Emoji become '?';
// other characters an ASCII spelling, their unaccented letter, or '?'.
const supported = /[\n\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/,
  spelled = {
    '→': '->',
    '←': '<-',
    '↔': '<->',
    '≥': '>=',
    '≤': '<=',
    '≠': '!=',
    '−': '-',
    '‐': '-',
    '‑': '-',
    '‒': '–',
    '―': '—',
    '′': "'",
    '″': '"',
    '✓': 'v',
    '✔': 'v',
  };
export const pdfText = (text) =>
  Array.from(
    String(text ?? '')
      .replace(/[\r\u200b\u200c\u2060\ufe0e\ufe0f]/g, '')
      .replace(
        /\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\u200d\p{Extended_Pictographic})*/gu,
        (emoji) => (supported.test(emoji) ? emoji : '?'),
      ),
    (c) => {
      if (supported.test(c)) return c;
      if (spelled[c]) return spelled[c];
      if (/\s/.test(c)) return ' ';
      const plain = c.normalize('NFKD').replace(/\p{M}/gu, '');
      return plain && [...plain].every((p) => supported.test(p)) ? plain : '?';
    },
  ).join('');
const ink = '#1f2937',
  muted = '#6b7280',
  accent = '#1e3a8a',
  rule = '#d1d5db';
export function responsePdf(model) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true }),
    width = doc.internal.pageSize.getWidth(),
    height = doc.internal.pageSize.getHeight(),
    left = 60,
    right = width - 60,
    top = 60,
    bottom = height - 72;
  let y = top;
  doc.setProperties({
    title: pdfText(model.title + ' — ' + model.details[0][1]),
    subject: 'Survey response',
    creator: model.club,
  });
  doc.setLanguage('en-US');
  const style = (size, font = 'normal', color = ink) => {
    doc.setFont('helvetica', font);
    doc.setFontSize(size);
    doc.setTextColor(color);
    return size * 1.4;
  };
  // Lines that fit `room` points at the current font size.
  const wrap = (text, room) => doc.splitTextToSize(pdfText(text), room);
  const fit = (space) => {
    if (y + space <= bottom) return;
    doc.addPage();
    y = top;
  };
  const write = (lines, x, lead) => {
    for (const line of lines) {
      fit(lead);
      doc.text(line, x, y, { baseline: 'top' });
      y += lead;
    }
  };
  const line = (color, from = y) => {
    doc.setDrawColor(color);
    doc.setLineWidth(0.75);
    doc.line(left, from, right, from);
  };
  write([model.club], left, style(10, 'bold', accent));
  y += 4;
  let lead = style(18, 'bold');
  write(wrap(model.title, right - left), left, lead * 0.9);
  y += 10;
  for (const [label, value] of model.details) {
    lead = style(10.5, 'bold', muted);
    doc.text(label, left, y, { baseline: 'top' });
    style(10.5);
    write(wrap(value, right - left - 84), left + 84, lead);
  }
  y += 8;
  line(rule);
  y += 6;
  let afterHeading = true;
  for (const block of model.blocks) {
    if (block.heading) {
      lead = style(13.5, 'bold', accent);
      const heading = wrap(block.heading, right - left);
      // Keep a heading with the start of its first question.
      fit(18 + heading.length * lead + 60);
      if (y > top) y += 18;
      write(heading, left, lead);
      afterHeading = true;
      continue;
    }
    // Question titles stay with at least the first two lines of the answer.
    const titleLead = style(11, 'bold'),
      title = wrap(block.question, right - left);
    const bodyLead = style(10.5);
    fit(16 + title.length * titleLead + 2 * bodyLead);
    if (y === top) afterHeading = true;
    else if (!afterHeading) line('#e5e7eb', y + 7);
    if (y > top) y += afterHeading ? 8 : 16;
    afterHeading = false;
    style(11, 'bold');
    write(title, left, titleLead);
    y += 3;
    for (const text of block.lines) {
      const item =
        block.kind === 'ranked'
          ? /^(\d+\.)\s*(.*)$/.exec(text)
          : block.kind === 'choices'
            ? [text, '•', text]
            : null;
      if (block.kind === 'none') style(10.5, 'italic', muted);
      else style(10.5);
      if (!item) {
        write(wrap(text, right - left), left, bodyLead);
        y += 3;
        continue;
      }
      const rest = wrap(item[2], right - left - 22);
      fit(bodyLead);
      doc.text(item[1], left + 4, y, { baseline: 'top' });
      write(rest, left + 22, bodyLead);
      y += 2;
    }
    for (const note of block.notes) {
      style(10, 'italic', muted);
      write(wrap(note, right - left), left, 10 * 1.4);
    }
  }
  const pages = doc.getNumberOfPages(),
    footer = model.details[0][1] + ' · ' + model.title;
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    style(9, 'normal', muted);
    line(rule, height - 52);
    const label = wrap(footer, right - left - 110);
    doc.text(label[0] + (label.length > 1 ? '…' : ''), left, height - 44, {
      baseline: 'top',
    });
    doc.text(`Page ${page} of ${pages}`, right, height - 44, {
      baseline: 'top',
      align: 'right',
    });
  }
  return doc;
}
