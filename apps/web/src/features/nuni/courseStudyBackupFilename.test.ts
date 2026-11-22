import { describe, expect, it } from 'vitest';
import { courseStudyBackupFilenameStem } from './courseStudyBackupFilename';
import { courseStudyNotesFilename } from './courseStudyNotes';
import { courseStudyProgressFilename } from './courseStudyProgress';
import { courseStudyPracticeCheckpointFilename } from './courseStudyPracticeCheckpoint';
import { courseStudyBackupFilenameStem as mergeBaseFilenameStem } from './__fixtures__/courseStudyMergeBase/courseStudyBackupFilename';

describe('backup filename stems compared with merge-base', () => {
  const defaultStem = '讀書白板';

  it.each([
    ['Devanagari spacing mark (Mc)', 'ः.pdf'],
    ['Bengali spacing mark (Mc)', 'ঃ.pdf'],
    ['Thai tone mark (Mn)', '\u0e48.pdf'],
    ['Myanmar vowel sign (Mc)', '\u102b.pdf'],
    ['Arabic fatha (Mn)', '\u064e.pdf'],
    ['combining acute accent (Mn)', '\u0301.pdf'],
    ['combining enclosing circle (Me)', '\u20dd.pdf'],
    ['braille blank outside the allowed fallback set', '\u2800\u200d.pdf'],
    ['zero-width space', '\u200b'],
    ['BOM', '\ufeff'],
    ['directional controls', '\u200e\u202e\u2069'],
    ['control characters', '\u0001\u0007'],
    ['whitespace', ' \t\n '],
    ['ideographic space', '\u3000\u3000'],
    ['Unicode next-line whitespace', '\u0085'],
    ['empty after extension removal', '.pdf'],
    ['visible text with invisible characters', '\u061c課\u200c程\u200b.pdf'],
    ['Persian text with ZWNJ', 'می‌روم.md'],
    ['emoji with ZWJ', '👩‍💻.md'],
    ['emoji with variation selector', '✈️.pdf'],
    ['long title', '課'.repeat(80) + '.md'],
    ['visible text past the truncation limit', '\u3164'.repeat(48) + '課.pdf'],
    ['reserved name', 'CON.txt'],
    ['reserved filename characters', '<>:"/\\|?*'],
    ['leading dots', '...課程.pdf'],
  ])('matches merge-base for %s', (_label, title) => {
    const stem = mergeBaseFilenameStem(title);
    expect(courseStudyBackupFilenameStem(title)).toBe(stem);
    expect(courseStudyNotesFilename(title)).toBe(stem + '-學習筆記.txt');
    expect(courseStudyProgressFilename(title)).toBe(stem + '-閱讀進度.campus-study.json');
    expect(courseStudyPracticeCheckpointFilename(title)).toBe(stem + '-逐題練習.campus-practice.json');
  });

  it.each([
    ['ZWNJ', '\u200c'],
    ['ZWJ', '\u200d\u200d'],
    ['ZWJ before an extension', '\u200d.md'],
    ['format character', '\ufff9'],
    ['variation selectors', '\ufe0f\u{e0100}'],
    ['default-ignorable non-mark', '\u3164'],
    ['mixed invisible characters', '\u3000\u200c\u200d\ufeff\u202e\ufe0f.pdf'],
  ])('uses the default stem for %s retained by merge-base', (_label, title) => {
    expect(mergeBaseFilenameStem(title)).not.toBe(defaultStem);
    expect(courseStudyBackupFilenameStem(title)).toBe(defaultStem);
    expect(courseStudyNotesFilename(title)).toBe(defaultStem + '-學習筆記.txt');
    expect(courseStudyProgressFilename(title)).toBe(defaultStem + '-閱讀進度.campus-study.json');
    expect(courseStudyPracticeCheckpointFilename(title)).toBe(defaultStem + '-逐題練習.campus-practice.json');
  });
});

describe('mobile backup filename grapheme boundaries', () => {
  const prefix = '課'.repeat(47);
  const partialClusters = [
    ['flag', '🇹🇼'],
    ['emoji ZWJ', '👩‍💻'],
    ['accent', 'e\u0301'],
    ['skin tone', '👍🏽'],
    ['Hangul Jamo', '한'],
    ['subdivision flag', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'],
  ] as const;

  it.each(partialClusters)('does not leave an incomplete %s at the 48-point limit', (_label, cluster) => {
    const title = prefix + cluster + '後續文字.markdown';
    expect(courseStudyBackupFilenameStem(title)).toBe(prefix);
    expect(courseStudyNotesFilename(title)).toBe(prefix + '-學習筆記.txt');
    expect(courseStudyProgressFilename(title)).toBe(prefix + '-閱讀進度.campus-study.json');
    expect(courseStudyPracticeCheckpointFilename(title)).toBe(prefix + '-逐題練習.campus-practice.json');
  });

  it('preserves a complete boundary cluster and the original 48-code-point cap', () => {
    const full = '課'.repeat(45) + '👩‍💻';
    expect(courseStudyBackupFilenameStem(full + '後續文字.md')).toBe(full);
    expect(courseStudyBackupFilenameStem('😀'.repeat(100))).toBe('😀'.repeat(48));
    expect(courseStudyBackupFilenameStem('e\u0301'.repeat(24))).toBe('e\u0301'.repeat(24));
    expect(Buffer.byteLength(courseStudyPracticeCheckpointFilename('😀'.repeat(100)), 'utf8')).toBeLessThan(255);
  });

  it('uses a bounded local fallback when an older mobile WebView has no Segmenter', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
    try {
      for (const [, cluster] of partialClusters) {
        expect(courseStudyBackupFilenameStem(prefix + cluster + '後續文字.md')).toBe(prefix);
      }
      expect(courseStudyBackupFilenameStem('課'.repeat(45) + '👩‍💻' + '後續')).toBe('課'.repeat(45) + '👩‍💻');
    } finally {
      if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
      else Reflect.deleteProperty(Intl, 'Segmenter');
    }
  });

  it('falls back when a WebView splits an emoji into UTF-16 surrogate halves', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: class {
        segment(value: string) {
          // Each UTF-16 code unit is returned in source order, including
          // the two halves of emoji. Coverage alone must not validate this.
          return Array.from({ length: value.length }, (_, index) => ({ segment: value[index] }));
        }
      },
    });
    try {
      const prefix = '課'.repeat(47);
      const flag = prefix + '🇹🇼後續文字.markdown';
      expect(courseStudyBackupFilenameStem(flag)).toBe(prefix);
      expect(courseStudyNotesFilename(flag)).toBe(prefix + '-學習筆記.txt');
      expect(courseStudyProgressFilename(flag)).toBe(prefix + '-閱讀進度.campus-study.json');
      expect(courseStudyPracticeCheckpointFilename(flag)).toBe(prefix + '-逐題練習.campus-practice.json');

      // An ordinary surrogate pair that fits the cap should remain intact.
      expect(courseStudyBackupFilenameStem(prefix + '😀後續.md')).toBe(prefix + '😀');
    } finally {
      if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
      else Reflect.deleteProperty(Intl, 'Segmenter');
    }
  });

  it('does not skip characters after an overlong cluster from an abnormal WebView', () => {
    const title = prefix + '🇹🇼後續文字.md';
    const original = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: class {
        segment(value: string) {
          return [{ segment: value.slice(0, prefix.length) },
            { segment: '🇹🇼' }, { segment: '後續文字' }];
        }
      },
    });
    try {
      expect(courseStudyBackupFilenameStem(title)).toBe(prefix);
    } finally {
      if (original) Object.defineProperty(Intl, 'Segmenter', original);
      else Reflect.deleteProperty(Intl, 'Segmenter');
    }
  });
  it('rejects contiguous but non-grapheme WebView segments at the filename cut', () => {
    const original = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: class {
        // All source code points are present, but the stated cluster breaks
        // are false. The output must never end with half a combined glyph.
        segment(value: string) {
          return Array.from(value, (segment) => ({ segment }));
        }
      },
    });
    try {
      for (const [, cluster] of partialClusters) {
        const title = prefix + cluster + '後續文字.md';
        expect(courseStudyBackupFilenameStem(title)).toBe(prefix);
        expect(courseStudyNotesFilename(title)).toBe(prefix + '-學習筆記.txt');
        expect(courseStudyProgressFilename(title)).toBe(prefix + '-閱讀進度.campus-study.json');
        expect(courseStudyPracticeCheckpointFilename(title)).toBe(prefix + '-逐題練習.campus-practice.json');
      }
      const complete = '課'.repeat(45) + '👩‍💻';
      expect(courseStudyBackupFilenameStem(complete + '後續.md')).toBe(complete);
    } finally {
      if (original) Object.defineProperty(Intl, 'Segmenter', original);
      else Reflect.deleteProperty(Intl, 'Segmenter');
    }
  });

});
