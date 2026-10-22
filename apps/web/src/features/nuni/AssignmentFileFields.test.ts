import { describe, expect, it } from 'vitest';
import { collectLocalFiles } from './AssignmentFileFields';

function file(name: string, type: string) {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type });
}

describe('collectLocalFiles', () => {
  it('keeps at most eight images and two documents, and drops disallowed types', () => {
    const images = Array.from({ length: 9 }, (_, index) => file(`shot-${index}.jpg`, 'image/jpeg'));
    const docs = [file('a.pdf', 'application/pdf'), file('b.pdf', 'application/pdf'), file('c.pdf', 'application/pdf')];
    const next = collectLocalFiles([], [...images, ...docs, file('bad.exe', 'application/octet-stream')]);
    expect(next.filter((item) => item.kind === 'image')).toHaveLength(8);
    expect(next.filter((item) => item.kind === 'file')).toHaveLength(2);
    expect(next.some((item) => item.file.name.endsWith('.exe'))).toBe(false);
  });
});
