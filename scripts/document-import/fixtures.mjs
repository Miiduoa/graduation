import * as XLSX from 'xlsx';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export function makePdf(pages) {
  const objects = [];
  const put = (value) => {
    objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
    return objects.length;
  };
  put('<< /Type /Catalog /Pages 2 0 R >>');
  put('');
  put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const refs = [];
  for (const content of pages) {
    const page = put('');
    refs.push(page);
    const stream = content.image
      ? Buffer.from(`q 500 0 0 250 40 450 cm /Im0 Do Q\n${content.text || ''}`)
      : Buffer.from(content.text);
    const contents = put(
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
        stream,
        Buffer.from('\nendstream'),
      ]),
    );
    let image = '';
    if (content.image) {
      const data = deflateSync(content.image.data);
      const ref = put(
        Buffer.concat([
          Buffer.from(
            `<< /Type /XObject /Subtype /Image /Width ${content.image.width} /Height ${content.image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`,
          ),
          data,
          Buffer.from('\nendstream'),
        ]),
      );
      image = `/XObject << /Im0 ${ref} 0 R >>`;
    }
    objects[page - 1] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> ${image} >> /Contents ${contents} 0 R >>`,
    );
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Kids [${refs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${refs.length} >>`,
  );
  const chunks = [Buffer.from('%PDF-1.7\n')],
    offsets = [0];
  let size = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(size);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(chunk);
    size += chunk.length;
  });
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join(
          '',
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}
export const textPage = {
  text: 'BT /F1 12 Tf 1 0 0 1 40 730 Tm (title) Tj 1 0 0 1 240 730 Tm (credits) Tj 1 0 0 1 360 730 Tm (grade) Tj 1 0 0 1 40 705 Tm (English) Tj 1 0 0 1 240 705 Tm (3) Tj 1 0 0 1 360 705 Tm (A) Tj ET',
};
if (process.argv.includes('--write')) {
  const directory = new URL('./fixtures/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const workbook = XLSX.utils.book_new();
  const first = XLSX.utils.aoa_to_sheet([
    ['115 學年成績'],
    [],
    ['課程名稱', '課程代碼', '學分', '成績'],
    ['英文', '00042', 3, 'A'],
    ['微積分', 7, 2, 90],
    ['待更新', '00999', 1, null],
  ]);
  first.B5.z = '00000';
  first.D5 = { t: 'n', f: '45+45', v: 90 };
  first.D6 = { t: 'n', f: '1+1' };
  XLSX.utils.book_append_sheet(workbook, first, '本學期');
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['課程名稱', '學分', '成績'],
      ['歷史', 2, 'B'],
    ]),
    '上學期',
  );
  await writeFile(
    new URL('multi-sheet.xlsx', directory),
    XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }),
  );
  await writeFile(
    new URL('text-two-pages.pdf', directory),
    makePdf([textPage, { text: textPage.text.replace('English', 'History') }]),
  );
  const pdfRequire = createRequire(require.resolve('pdfjs-dist/package.json'));
  const { createCanvas } = pdfRequire('@napi-rs/canvas');
  const canvas = createCanvas(1000, 500),
    context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, 1000, 500);
  context.fillStyle = 'black';
  context.font = '32px sans-serif';
  for (const [y, values] of [
    [100, ['title', 'credits', 'grade']],
    [200, ['English', '3', 'A']],
    [300, ['History', '2', 'B']],
  ])
    values.forEach((text, index) => context.fillText(text, [40, 430, 730][index], y));
  const rgba = context.getImageData(0, 0, 1000, 500).data,
    rgb = Buffer.alloc(1000 * 500 * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) {
    rgb[j++] = rgba[i];
    rgb[j++] = rgba[i + 1];
    rgb[j++] = rgba[i + 2];
  }
  await writeFile(
    new URL('scanned-table.pdf', directory),
    makePdf([{ image: { width: 1000, height: 500, data: rgb } }]),
  );
  await writeFile(
    new URL('hybrid-scanned-table.pdf', directory),
    makePdf([
      {
        image: { width: 1000, height: 500, data: rgb },
        text: 'BT /F1 12 Tf 1 0 0 1 40 750 Tm (Semester report) Tj ET',
      },
    ]),
  );
  context.fillStyle = 'white';
  context.fillRect(0, 0, 1000, 500);
  context.fillStyle = 'black';
  context.font = '36px sans-serif';
  for (const [y, values] of [
    [100, ['課程名稱', '學分', '成績']],
    [200, ['英文', '3', '90']],
    [300, ['歷史', '2', '85']],
  ])
    values.forEach((text, index) => context.fillText(text, [40, 430, 730][index], y));
  const chineseRgba = context.getImageData(0, 0, 1000, 500).data;
  for (let i = 0, j = 0; i < chineseRgba.length; i += 4) {
    rgb[j++] = chineseRgba[i];
    rgb[j++] = chineseRgba[i + 1];
    rgb[j++] = chineseRgba[i + 2];
  }
  await writeFile(
    new URL('scanned-chinese-grades.pdf', directory),
    makePdf([{ image: { width: 1000, height: 500, data: rgb } }]),
  );
  console.log('Wrote real XLSX, text PDF, English/Chinese scanned PDF and hybrid PDF fixtures.');
}
