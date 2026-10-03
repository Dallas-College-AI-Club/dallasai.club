// Minimal offline WordprocessingML package: no remote scripts, macros, or HTML
// masquerading as .docx. ZIP uses the STORE method and UTF-8 filenames/content.
function xmlText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&apos;',
        })[c],
    );
}
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(files) {
  const encoder = new TextEncoder(),
    parts = [],
    central = [];
  let offset = 0;
  const header = (size) => {
    const bytes = new Uint8Array(size);
    return { bytes, v: new DataView(bytes.buffer) };
  };
  for (const [path, content] of Object.entries(files)) {
    const name = encoder.encode(path),
      data = encoder.encode(content),
      crc = crc32(data),
      h = header(30);
    h.v.setUint32(0, 0x04034b50, true);
    h.v.setUint16(4, 20, true);
    h.v.setUint16(6, 0x0800, true);
    h.v.setUint16(12, 33, true);
    h.v.setUint32(14, crc, true);
    h.v.setUint32(18, data.length, true);
    h.v.setUint32(22, data.length, true);
    h.v.setUint16(26, name.length, true);
    parts.push(h.bytes, name, data);
    const c = header(46);
    c.v.setUint32(0, 0x02014b50, true);
    c.v.setUint16(4, 20, true);
    c.v.setUint16(6, 20, true);
    c.v.setUint16(8, 0x0800, true);
    c.v.setUint16(14, 33, true);
    c.v.setUint32(16, crc, true);
    c.v.setUint32(20, data.length, true);
    c.v.setUint32(24, data.length, true);
    c.v.setUint16(28, name.length, true);
    c.v.setUint32(42, offset, true);
    central.push(c.bytes, name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((sum, b) => sum + b.length, 0),
    end = header(22);
  end.v.setUint32(0, 0x06054b50, true);
  end.v.setUint16(8, Object.keys(files).length, true);
  end.v.setUint16(10, Object.keys(files).length, true);
  end.v.setUint32(12, centralSize, true);
  end.v.setUint32(16, offset, true);
  const total = [...parts, ...central, end.bytes],
    result = new Uint8Array(offset + centralSize + 22);
  let pos = 0;
  for (const p of total) {
    result.set(p, pos);
    pos += p.length;
  }
  return result;
}
export function makeDocx(playbook, questions = []) {
  if (
    !playbook ||
    playbook.kind !== 'personal-full-copy' ||
    !Array.isArray(playbook.sections) ||
    !playbook.sections.length
  )
    throw Error('A nonempty personal copy is required.');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const p = (text, style = 'Normal', keepNext = false) =>
    `<w:p><w:pPr><w:pStyle w:val="${style}"/>${keepNext ? '<w:keepNext/>' : ''}</w:pPr><w:r><w:t xml:space="preserve">${xmlText(text)}</w:t></w:r></w:p>`;
  const questionTitles = new Set(questions.map((q) => q.title));
  let body =
    p('Dallas College AI Club', 'ClubLabel') +
    p('My full Advisor Studio responses', 'Title') +
    p(playbook.advisorName, 'Subtitle') +
    p('Personal copy · Includes responses not selected for sharing.', 'Normal');
  for (const s of playbook.sections) {
    body += p(s.title, 'Heading1');
    const lines = s.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      body += p(
        line,
        questionTitles.has(line) || line === 'My comments'
          ? 'Question'
          : 'Normal',
        questionTitles.has(line) || line === 'My comments',
      );
    }
  }
  body +=
    '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1152" w:bottom="1080" w:left="1152" w:header="480" w:footer="480" w:gutter="0"/></w:sectPr>';
  const styles =
    declaration +
    `<w:styles xmlns:w="${W}">
 <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="21"/><w:color w:val="263347"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="110" w:line="270" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults>
 <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
 <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Subtitle"/><w:pPr><w:keepNext/><w:spacing w:before="40" w:after="90"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/><w:color w:val="172A43"/></w:rPr></w:style>
 <w:style w:type="paragraph" w:styleId="ClubLabel"><w:name w:val="Club label"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="19"/><w:color w:val="376B69"/></w:rPr></w:style>
 <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="280"/></w:pPr><w:rPr><w:sz w:val="24"/><w:color w:val="536276"/></w:rPr></w:style>
 <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="260" w:after="130"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="246363"/></w:rPr></w:style>
 <w:style w:type="paragraph" w:styleId="Question"><w:name w:val="Question"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="150" w:after="70"/></w:pPr><w:rPr><w:b/><w:sz w:val="21"/></w:rPr></w:style>
 <w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="right"/></w:pPr><w:rPr><w:sz w:val="17"/><w:color w:val="667084"/></w:rPr></w:style></w:styles>`;
  const files = {
    '[Content_Types].xml':
      declaration +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
    '_rels/.rels':
      declaration +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDocument" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':
      declaration +
      `<w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`,
    'word/styles.xml': styles,
    'word/_rels/document.xml.rels':
      declaration +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
    'word/footer1.xml':
      declaration +
      `<w:ftr xmlns:w="${W}"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t xml:space="preserve">Dallas College AI Club | </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`,
  };
  return zipStore(files);
}
