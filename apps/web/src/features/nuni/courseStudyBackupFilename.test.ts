import { describe, expect, it } from 'vitest';
import { courseStudyBackupFilenameStem } from './courseStudyBackupFilename';
import { courseStudyNotesFilename } from './courseStudyNotes';
import { courseStudyProgressFilename } from './courseStudyProgress';
import { courseStudyPracticeCheckpointFilename } from './courseStudyPracticeCheckpoint';

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
