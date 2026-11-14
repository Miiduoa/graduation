/**
 * A visible local filename stem shared by note TXT, reading JSON and practice
 * JSON exports. Do not leak invisible format controls into mobile file lists.
 * Keep ZWJ/ZWNJ for readable multilingual and emoji lesson titles.
 */
// A 48-code-point slice can leave one regional indicator of a flag, a
// dangling emoji joiner or a detached combining accent in a download name.
// Keep the established code-point cap, but cut only at a complete grapheme
// boundary when the browser supports its built-in segmenter.
const MAX_FILENAME_CODE_POINTS = 48;

function isFilenameRegionalIndicator(character: string): boolean {
  const point = character.codePointAt(0) ?? 0;
  return point >= 0x1f1e6 && point <= 0x1f1ff;
}

function fallbackFilenameBoundary(value: string): string {
  // Older WebViews do not always expose Intl.Segmenter. Conservatively
  // retract a cut in the middle of common emoji, accents and Hangul Jamo.
  // This is bounded by the filename cap, not a complete UAX #29 parser.
  const points = Array.from(value);
  let end = Math.min(MAX_FILENAME_CODE_POINTS, points.length);
  if (end === points.length) return value;
  while (end > 0) {
    const next = points[end];
    const previous = points[end - 1];
    const nextPoint = next?.codePointAt(0) ?? 0;
    const previousPoint = previous?.codePointAt(0) ?? 0;
    const nextV = (nextPoint >= 0x1160 && nextPoint <= 0x11a7) ||
      (nextPoint >= 0xd7b0 && nextPoint <= 0xd7c6);
    const previousL = (previousPoint >= 0x1100 && previousPoint <= 0x115f) ||
      (previousPoint >= 0xa960 && previousPoint <= 0xa97f);
    const previousV = (previousPoint >= 0x1160 && previousPoint <= 0x11a7) ||
      (previousPoint >= 0xd7b0 && previousPoint <= 0xd7c6);
    const nextT = (nextPoint >= 0x11a8 && nextPoint <= 0x11ff) ||
      (nextPoint >= 0xd7cb && nextPoint <= 0xd7fb);
    const previousT = (previousPoint >= 0x11a8 && previousPoint <= 0x11ff) ||
      (previousPoint >= 0xd7cb && previousPoint <= 0xd7fb);
    if (next && (
      /^\p{Mark}$/u.test(next) || next === '\u200c' || next === '\u200d' ||
      previous === '\u200c' || previous === '\u200d' ||
      (nextPoint >= 0x1f3fb && nextPoint <= 0x1f3ff) ||
      (nextPoint >= 0xe0020 && nextPoint <= 0xe007f) ||
      (previous === '\r' && next === '\n') ||
      (nextV && (previousL || previousV)) ||
      (nextT && (previousV || previousT))
    )) {
      end -= 1;
      continue;
    }
    if (next && isFilenameRegionalIndicator(next) && isFilenameRegionalIndicator(previous)) {
      let run = 0;
      for (let index = end - 1; index >= 0 && isFilenameRegionalIndicator(points[index]); index -= 1)
        run += 1;
      if (run % 2 === 1) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return points.slice(0, end).join('');
}

function truncateFilenameStem(value: string): string {
  if (Array.from(value).length <= MAX_FILENAME_CODE_POINTS) return value;
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      let offset = 0;
      let count = 0;
      let truncated = false;
      let result = '';
      for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)) {
        // A broken WebView segmenter must not skip or duplicate the source.
        if (typeof segment !== 'string' || !segment || !value.startsWith(segment, offset))
          throw new Error('invalid filename segmentation');
        offset += segment.length;
        const width = Array.from(segment).length;
        if (!truncated) {
          if (count + width <= MAX_FILENAME_CODE_POINTS) {
            count += width;
            result += segment;
          } else {
            // Do not resume with later short clusters after a rejected one:
            // that would silently skip letters in the saved filename.
            truncated = true;
          }
        }
      }
      if (offset !== value.length) throw new Error('incomplete filename segmentation');
      return result;
    } catch {
      // The original title remains untouched; use the bounded local fallback.
    }
  }
  return fallbackFilenameBoundary(value);
}

export function courseStudyBackupFilenameStem(sourceTitle: string): string {
  const safe = sourceTitle
    .replace(/[\p{Cc}\u00ad\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff<>:"/\\|?*]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/\.(pdf|txt|md|markdown)$/i, '')
    .replace(/^[. ]+|[. ]+$/gu, '');
  return truncateFilenameStem(safe).trim() || '讀書白板';
}
