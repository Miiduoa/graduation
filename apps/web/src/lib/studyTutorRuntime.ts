'use client';

import { getPersonalImportAiAvailability } from './personalImportAiLocal';
import type { PersonalImportAiWorkerRequest } from './personalImportAiConfig';
import {
  buildStudyTutorPrompt,
  parseTutorExplanation,
  type StudyMode,
  type StudyPassage,
  type StudyTutorHistory,
  type TutorExplanation,
} from './studyTutor';

export const STUDY_TUTOR_TIMEOUT_MS = 10 * 60_000;
export const STUDY_TUTOR_GENERATION_TIMEOUT_MS = 120_000;

export function getStudyTutorAvailability(): {
  available: boolean;
  reason?: string;
  downloadLabel: string;
} {
  const availability = getPersonalImportAiAvailability();
  return availability.available ? availability : {
    ...availability,
    reason: '這個瀏覽器目前無法執行裝置端 AI。仍可閱讀原文與自行複習，或改用支援 WebGPU 的瀏覽器開啟講解。',
  };
}

/** Browser-observed wall time for one local worker run. No cold/warm or quality inference. */
export type StudyTutorTiming = {
  preparationMs: number;
  generationMs: number | null;
  totalMs: number;
  outcome: 'success' | 'failed' | 'cancelled';
};

export type StudyTutorRequest = {
  passage: StudyPassage;
  mode: StudyMode;
  question?: string;
  history?: StudyTutorHistory;
  signal: AbortSignal;
  onProgress?: (message: string) => void;
  onTiming?: (timing: StudyTutorTiming) => void;
};

let sequence = 0;
let running = false;

function aborted() {
  return new DOMException('已停止這次講解，原文仍保留。', 'AbortError');
}

function workerError(code: unknown): Error {
  const messages: Record<string, string> = {
    unsupported: '這台裝置無法執行講解模型，仍可使用白板閱讀原文。',
    input_limit: '原文與追問超過模型能處理的範圍，請縮短提問，或不帶追問紀錄重新講解。',
    output_limit: '這次講解沒有完整產生，請重試或縮小問題範圍。',
    memory: '裝置記憶體不足，講解已停止。請關閉其他分頁後重試，或先閱讀原文。',
    download: '講解模型尚未下載完成，請確認網路後重試。教材內容仍在本機。',
    runtime: '裝置端 AI 暫時無法啟動，請稍後重試；原文仍可閱讀。',
    busy: '上一段講解仍在處理，請等候完成或先停止。',
    invalid_response: '這次講解無法對照原文，請重試。',
  };
  return new Error(typeof code === 'string' && Object.hasOwn(messages, code)
    ? messages[code] : messages.invalid_response);
}

// An exact substring can be just a period or operator: matching the source is
// necessary, but punctuation alone does not identify what the lesson explains.
function generatedEvidenceQuotes(explanation: TutorExplanation): string[] {
  return [explanation.sourceQuote, ...(explanation.steps?.map((step) => step.sourceQuote) ?? [])];
}
// Enforce this only for NEW worker results. Saved v1/v2 explanations continue
// to use their original schema so old offline study backups remain readable.
function hasSubstantiveGeneratedEvidence(explanation: TutorExplanation): boolean {
  return generatedEvidenceQuotes(explanation).every((quote) => /[\p{L}\p{N}]/u.test(quote));
}

// The prompt asks for at most 60 Unicode characters per quote; the generic
// parser keeps its older 400-code-unit allowance for saved v1/v2 backups.
// Enforce the tighter bound only when accepting new worker-generated lessons.
function hasBoundedGeneratedEvidence(explanation: TutorExplanation): boolean {
  return generatedEvidenceQuotes(explanation).every((quote) => Array.from(quote).length <= 60);
}

// Normalize only a temporary comparison copy: never rewrite source quotes,
// displayed explanations or existing offline backups. Keep ZWJ/ZWNJ because
// they can carry meaning in other scripts and emoji.
function comparableGeneratedTeaching(text: string, preserveLineBreaks = false): string {
  return text.normalize('NFC')
    .replace(/[\u00ad\u034f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu, '')
    // Answer-key list markers must remain on their own line for validation.
    // Other comparisons deliberately retain the existing collapsed whitespace.
    .replace(preserveLineBreaks ? /[^\S\r\n]+/gu : /\s+/gu, ' ').trim();
}

// Match only the visual width variants of printable ASCII in NEW self-check
// disclosures. NFKC would also fold mathematically distinct characters such as
// x² and x2; never change the displayed question, source quote or saved lesson.
function comparableGeneratedAnswerDisplay(text: string, preserveLineBreaks = false): string {
  const folded = text.replace(/[\uFF01-\uFF5E]/gu,
    (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/gu, ' ');
  return comparableGeneratedTeaching(folded, preserveLineBreaks);
}

// A valid source quote is not enough if the model leaves the explanation itself
// as punctuation or mathematical operators. Require visible letters or digits
// in the NEW generated summary and each instructional step, not in saved data.
function hasSubstantiveGeneratedTeaching(explanation: TutorExplanation): boolean {
  return [explanation.explanation, ...(explanation.steps?.map((step) => step.explanation) ?? [])]
    .every((text) => /[\p{L}\p{N}]/u.test(comparableGeneratedTeaching(text)));
}

// A valid quote and visible explanation do not make a punctuation-only
// self-check usable. Keep the legacy parser unchanged for saved lessons.
function hasSubstantiveGeneratedReview(explanation: TutorExplanation): boolean {
  return [explanation.question, explanation.answer]
    .every((text) => /[\p{L}\p{N}]/u.test(comparableGeneratedTeaching(text)));
}

// If the model repeats its answer as the question, there is nothing for the
// student to recall. Ignore only whitespace, punctuation and display-only
// characters for this NEW-output comparison; retain mathematical operators.
function hasDistinctGeneratedReview(explanation: TutorExplanation): boolean {
  const comparable = (value: string) => comparableGeneratedTeaching(value)
    // Only drop sentence/quote marks at the ends. Generic punctuation includes
    // grouping brackets and leading decimal points: (a+b) is NOT a+b, and
    // .5 is NOT 5. Neither should trigger an unnecessary AI regeneration.
    .replace(/\s+/gu, '')
    .replace(/^[?!？!。；;：:，、"'“”‘’「」『』…]+|[.!?。！？；;：:，、"'“”‘’「」『』…]+$/gu, '')
    .toLowerCase();
  return comparable(explanation.question) !== comparable(explanation.answer);
}

// A labeled answer column in a multiline Markdown table also reveals a
// generated answer before a learner attempts it. Only match exact cell values
// for NEW local generation; saved lessons and original source are unchanged.
function hasDisclosedGeneratedAnswerColumn(question: string, answer: string): boolean {
  const parseRow = (line: string): string[] | null => {
    const text = line.trim();
    if (!text.includes('|')) return null;
    // Literal pipes in escaped syntax or inline code are not cell delimiters.
    const cells: string[] = [];
    let cell = '';
    let codeTicks = 0;
    let separators = 0;
    for (let index = 0; index < text.length;) {
      const char = text[index];
      if (char === '\\' && codeTicks === 0 && index + 1 < text.length &&
          (text[index + 1] === '|' || text[index + 1] === '`' || text[index + 1] === '\\')) {
        cell += text.slice(index, index + 2);
        index += 2;
        continue;
      }
      if (char === '`') {
        let after = index + 1;
        while (after < text.length && text[after] === '`') after += 1;
        const ticks = after - index;
        if (codeTicks === 0) codeTicks = ticks;
        else if (codeTicks === ticks) codeTicks = 0;
        cell += text.slice(index, after);
        index = after;
        continue;
      }
      if (char === '|' && codeTicks === 0) {
        cells.push(cell.trim());
        cell = '';
        separators += 1;
      } else {
        cell += char;
      }
      index += 1;
    }
    // Unclosed inline code is ambiguous: do not infer column positions.
    if (codeTicks !== 0 || separators === 0) return null;
    cells.push(cell.trim());
    if (text.startsWith('|')) cells.shift();
    if (text.endsWith('|') && cells.at(-1) === '') cells.pop();
    return cells;
  };
  const normalized = (value: string): string => {
    let cell = value.trim();
    // Remove only matching presentation wrappers; keep minus signs,
    // decimal points and internal identifier punctuation significant.
    for (const marker of ['**', '__', String.fromCharCode(96), '*', '_']) {
      if (cell.startsWith(marker) && cell.endsWith(marker) && cell.length > marker.length * 2)
        cell = cell.slice(marker.length, -marker.length).trim();
    }
    return comparableGeneratedAnswerDisplay(cell).toLowerCase()
      .replace(/\s+/gu, '').replace(/[.!?。！？；;：:，、]+$/gu, '');
  };
  const expected = normalized(answer);
  if (!expected) return false;
  const headerPattern = /^(?:正確答案|標準答案|參考答案|參考回答|參考解答|正確選項|正解|解答|答案|answer|solution|correctanswer|expectedanswer|referenceanswer)$/u;
  const lines = question.split(/\r?\n/u);
  for (let index = 0; index < lines.length - 2; index += 1) {
    const headers = parseRow(lines[index]);
    const separator = parseRow(lines[index + 1]);
    if (!headers || !separator || headers.length !== separator.length ||
        !separator.every((cell) => /^:?-{3,}:?$/u.test(cell))) continue;
    const answerIndices = headers.flatMap((header, column) => headerPattern.test(normalized(header)) ? [column] : []);
    if (answerIndices.length === 0) continue;
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const cells = parseRow(lines[rowIndex]);
      if (!cells || cells.length !== headers.length) break;
      if (answerIndices.some((column) => normalized(cells[column]) === expected)) return true;
    }
  }
  return false;
}

// A self-check cannot test recall if it prints its own reference answer in
// an explicit answer key. Only reject a labelled disclosure that actually
// matches the generated answer; ordinary questions may contain the same
// technical terms or mathematical givens without revealing the answer.
// Validate NEW local generation only; saved v1/v2 lessons remain readable.
function hasUnrevealedGeneratedReview(explanation: TutorExplanation): boolean {
  // A heading such as "## 答案" without a colon is still an explicit
  // answer key. Only rewrite exact standalone Markdown answer headings in
  // this comparison copy; never mutate the learner-facing question or source.
  const question = comparableGeneratedAnswerDisplay(explanation.question, true).toLowerCase()
    // Model responses can use classic Mac CR-only line breaks. Normalize only
    // this temporary answer-disclosure comparison so headings, lists and
    // Markdown answer tables cannot reveal a key before the student tries.
    // Do not alter the generated question, displayed source or saved backups.
    .replace(/\r\n?/gu, '\n')
    .replace(/(^|\r?\n)[ \t]*#{1,6}[ \t]+(?:\*\*|__)?(正確答案|標準答案|參考答案|參考回答|參考解答|正確選項|正解|解答|答案|answer|solution)(?:\*\*|__)?[ \t]*#*[ \t]*(?=\r?\n)/giu, '$1$2：')
    // A model can also place an unpunctuated key on its own line, inside a
    // blockquote/list, or as "**答案** 主鍵". These still display the answer
    // before the student can respond. Match only standalone answer-key labels,
    // then use the same exact-answer boundary check below; a normal mention of
    // "答案" in question prose must remain valid.
    .replace(/(^|\r?\n)[ \t]*(?:>[ \t]*){0,2}(?:(?:[-+*•]|\d{1,2}[.)、])[ \t]+)?(?:\*\*|__)?(正確答案|標準答案|參考答案|參考回答|參考解答|正確選項|正解|解答|答案|answer|solution)(?:\*\*|__)?(?=[ \t]*\r?\n|[ \t]+\S)/giu, '$1$2：');
  const answer = comparableGeneratedAnswerDisplay(explanation.answer)
    .replace(/[.!?。！？；;：:，、]+$/gu, '').trim().toLowerCase().replace(/\s+/gu, '');
  // New Markdown tables may display an explicit answer key as "| 答案 | 主鍵 |".
  // A pipe with a nonblank following cell can disclose the answer without a colon.
  // Compare only NEW generated results; never alter the student's source text.
  // Generated answer keys also use 是／為, 就是, equals signs, or English labels.
  // This is only a conservative disclosure check, not a semantic answer judge.
  const labels = /(?:正確答案|標準答案|參考答案|參考回答|參考解答|正確選項|正解|解答|答案)\s*(?:[:：=＝]|\|(?=[ \t]*\S)|(?:就)?[是為]\s*[:：=＝]?)|\b(?:(?:correct|expected|reference)\s+answer|answer|ans\.?|solution)\s*(?:[:：=＝]|\|(?=[ \t]*\S)|\bis\b\s*[:：=＝]?)/giu;
  let label: RegExpExecArray | null;
  while ((label = labels.exec(question)) !== null) {
    // Generated Markdown may wrap a disclosed key in inline code or emphasis.
    // Strip only opening presentation marks for comparison, never displayed text.
    const rawDisclosed = question.slice(label.index + label[0].length);
    // HTML-escaped display tags are still visible answers to the learner.
    // Decode only angle brackets in this temporary comparison copy, so
    // &lt;strong&gt;SQL&lt;/strong&gt; cannot bypass the answer-key check.
    // Never decode/render the original question or execute arbitrary HTML.
    const decodedDisclosed = rawDisclosed
      .replace(/&(?:lt|#0*60|#x0*3c);/giu, '<')
      .replace(/&(?:gt|#0*62|#x0*3e);/giu, '>');
    // Answer keys may place blank lines or Markdown quote markers before bullets.
    // Only remove markers after a NEW line: "- 1" on the same line remains
    // negative-number notation, not a Markdown answer list.
    const revealedItem = decodedDisclosed.replace(
      /^(?:[ \t]*\r?\n){1,3}[ \t]*(?:>[ \t]*){0,2}(?:[-+*•][ \t]+|\d{1,2}[.)、][ \t]+)?/u, '',
    );
    // A model may put "- SQL", "• 主鍵" or "1. B" on the SAME line as
    // "Answer:". Only strip that list syntax when the expected answer starts
    // with a letter: "- 1" can be a negative numeric answer and must stay distinct.
    // This affects NEW self-check validation only, never the displayed question.
    const sameLineList = /^\p{L}/u.test(answer)
      ? revealedItem.replace(/^[ \t]*(?:>[ \t]*){0,2}(?:[-+*•][ \t]+|\d{1,2}[.)、][ \t]+)/u, '')
      : revealedItem;
    // An opening _ or __ is presentation markup, not part of a leaked answer.
    // Remember its length so a closing underscore is not mistaken for an identifier.
    // Local models sometimes print a literal HTML-formatted answer key.
    // Match up to three short literal style tags with bounded attributes in
    // the comparison copy. Never parse/execute HTML or rewrite displayed text.
    // Local models can display a reference key inside a fenced Markdown
    // code block after "答案：". Ignore ONLY a leading opening fence in this
    // temporary comparison copy; keep the full question unchanged for display.
    // A fence must have a real newline and at most a short language tag.
    // Blockquoted fences also prefix each code line with >. Discard up to two
    // markers on the answer line only in this temporary comparison copy.
    const fencedAnswer = sameLineList.replace(
      /^(?:`{3,}|~{3,})[ \t]*(?:[A-Za-z][A-Za-z0-9_+-]{0,23})?[ \t]*\r?\n[ \t]*(?:>[ \t]*){0,2}/u, '',
    );
    const answerPresentation = fencedAnswer.replace(
      /^([\s"'“”‘’「『（(\[【`*_]*)(?:<(?:strong|em|b|i|code|span)(?:[ \t]+[^<>\r\n]{0,120})?[ \t]*>[\s]*){1,3}/iu, '$1',
    );
    // A Markdown link displays its label (or image alt text for screen readers),
    // not the destination. Inspect only one complete leading link in this
    // comparison copy; do not dereference URLs or modify the shown question.
    const visibleAnswer = answerPresentation.replace(
      /^([\s"'“”‘’「『《〈（(`*_]*)(?:!)?\[([^\]\r\n]{1,200})\]\([^()\s\r\n]{1,300}\)/u,
      '$1$2',
    );
    // GFM strikethrough still visibly discloses an answer. Remove only a
    // complete leading ~~...~~ span in this comparison copy; a single ~
    // (e.g. the bitwise NOT operator) must remain part of the answer.
    const strikeVisibleAnswer = visibleAnswer.replace(
      /^([\s"'“”‘’「『《〈（(\[【`*_]*)(?:~~)([^~\r\n]{1,200})~~/u,
      '$1$2',
    );
    const emphasisPrefix = strikeVisibleAnswer.match(/^[\s"'“”‘’「『《〈（(\[【`*]*(_{1,2})/u)?.[1] ?? '';
    const visibleContent = strikeVisibleAnswer.replace(/^[\s"'“”‘’「『《〈（(\[【`*_]+/gu, '');
    const disclosed = visibleContent.replace(/\s+/gu, '');
    if (!disclosed.startsWith(answer)) continue;
    // Compact matching tolerates spacing within an answer, but it must not
    // turn "SQL is ..." into "SQLis" and mistake a visible answer for SQLis.
    // Preserve only the boundary after the matched answer; Latin identifiers
    // joined WITHOUT a separator (SQLServer, SQL_joins) stay distinct.
    let referenceCursor = 0;
    let visibleCursor = 0;
    while (referenceCursor < answer.length && visibleCursor < visibleContent.length) {
      if (/\s/u.test(visibleContent[visibleCursor])) {
        visibleCursor += 1;
        continue;
      }
      if (visibleContent[visibleCursor] !== answer[referenceCursor]) break;
      visibleCursor += 1;
      referenceCursor += 1;
    }
    const followsWhitespace = referenceCursor === answer.length &&
      /^\s/u.test(visibleContent.slice(visibleCursor));
    // For numeric reference answers, 1 is not the same answer as 12 or 1.2.
    // Keep decimal points and mathematical operators significant.
    const finalAnswerCharacter = Array.from(answer).at(-1) ?? '';
    const followingCharacter = disclosed.slice(answer.length).charAt(0);
    if (/[\p{N}]/u.test(finalAnswerCharacter) && /[\p{N}.]/u.test(followingCharacter))
      continue;
    // SQL is not SQLServer; likewise, option B is not option B2.
    // Avoid rejecting a genuine question for a longer Latin identifier.
    const remaining = disclosed.slice(answer.length);
    const closesEmphasis = emphasisPrefix.length > 0 &&
      remaining.startsWith(emphasisPrefix) &&
      !/^[\p{L}\p{N}_]/u.test(remaining.slice(emphasisPrefix.length));
    // SQL_joins remains distinct from SQL, but _SQL_ and __SQL__ reveal SQL.
    if (/[a-z]/u.test(finalAnswerCharacter) && /[a-z0-9_]/u.test(followingCharacter) &&
      !followsWhitespace && !(followingCharacter === '_' && closesEmphasis)) continue;
    return false;
  }
  return !hasDisclosedGeneratedAnswerColumn(question, answer);
}

// Distinct titles, source lines or whitespace cannot turn the SAME explanation
// into two instructional steps. Keep citations and displayed text untouched.
function hasDistinctGeneratedSteps(explanation: TutorExplanation): boolean {
  if (!explanation.steps) return false;
  const seen = new Set<string>();
  for (const step of explanation.steps) {
    // A new step that only changes the closing punctuation does not give the
    // student another explanation. Leave internal punctuation untouched:
    // operators, decimal points and formula syntax can change the meaning.
    const content = comparableGeneratedTeaching(step.explanation)
      .replace(/[.!?。！？；;：:，、]+$/gu, '').trim();
    if (!content || seen.has(content)) return false;
    seen.add(content);
  }
  return true;
}

// An exact source citation is evidence, not a teaching explanation. A new
// on-device lesson must add information beyond copying its own quote. Keep
// the saved v1/v2 parser unchanged for earlier offline study records.
function hasExplainedGeneratedEvidence(explanation: TutorExplanation): boolean {
  const pairs: Array<[string, string]> = [
    [explanation.explanation, explanation.sourceQuote],
    ...(explanation.steps?.map((step): [string, string] => [step.explanation, step.sourceQuote]) ?? []),
  ];
  const comparable = (text: string) => comparableGeneratedTeaching(text)
    // Ignore closing sentence punctuation, but retain internal operators and
    // decimals: an equation and a changed equation must not compare equal.
    .replace(/[.!?。！？；;：:，、]+$/gu, '').trim();
  return pairs.every(([teaching, quote]) => comparable(teaching) !== comparable(quote));
}

function progressMessage(message: unknown, phase: unknown): string {
  if (phase === 'generating') return '正在依本段原文準備講解與自我檢查題…';
  const download = typeof message === 'string' && message.length <= 300
    ? /已接收 (\d{1,6}) MB/.exec(message) : null;
  return download ? `正在下載講解模型（已接收 ${download[1]} MB）`
    : '正在準備裝置端 AI；已下載的模型會使用本機快取。';
}

/** Only an explicit call starts a worker. Closing the session cancels actual GPU work. */
export async function runStudyTutor({
  passage,
  mode,
  question,
  history,
  signal,
  onProgress,
  onTiming,
}: StudyTutorRequest): Promise<TutorExplanation> {
  if (signal.aborted) throw aborted();
  // Snapshot the source before awaiting the worker so a later selection cannot change validation.
  const source = { ...passage };
  const prompt = buildStudyTutorPrompt(source, mode, question, history);
  if (running) throw new Error('另一段講解正在進行，請先停止或等完成後再試。');
  const availability = getStudyTutorAvailability();
  if (!availability.available) throw new Error(availability.reason);
  running = true;
  try {
    const startedAt = performance.now();
    const reportTiming = (generationStartedAt: number | null, outcome: StudyTutorTiming['outcome']) => {
      const endedAt = performance.now();
      try {
        onTiming?.({
          preparationMs: Math.max(0, (generationStartedAt ?? endedAt) - startedAt),
          generationMs: generationStartedAt === null ? null : Math.max(0, endedAt - generationStartedAt),
          totalMs: Math.max(0, endedAt - startedAt),
          outcome,
        });
      } catch {
        // A timing display failure must never replace the worker outcome.
      }
    };
    let worker: Worker;
    try {
      worker = new Worker(new URL('./personalImportAi.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      // A constructor failure occurs before the Promise and would otherwise skip timing.
      reportTiming(null, 'failed');
      throw new Error('無法啟動裝置端 AI，請重新整理後再試；原文仍可閱讀。');
    }
    return await new Promise<TutorExplanation>((resolve, reject) => {
      const id = ++sequence;
      let settled = false;
      let generating = false;
      let generationStartedAt: number | null = null;
      const finish = (error?: Error, explanation?: TutorExplanation) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        try {
          worker.terminate();
        } catch {
          // Some browsers throw after a worker crash. Still release the UI and settle the request.
        }
        reportTiming(generationStartedAt, error?.name === 'AbortError' ? 'cancelled' : error ? 'failed' : 'success');
        if (error) reject(error);
        else resolve(explanation!);
      };
      const abort = () => finish(aborted());
      const report = (message: string) => {
        try {
          onProgress?.(message);
        } catch {
          finish(new Error('白板無法更新講解進度，工作已停止。請重試。'));
        }
      };
      let timer = setTimeout(
        () => finish(new Error('模型準備逾時，下載與講解已停止。請確認網路後重試。')),
        STUDY_TUTOR_TIMEOUT_MS,
      );
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (settled || signal.aborted) return;
        const value = event.data;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          // This dedicated worker must send an object envelope. Waiting for the
          // preparation timeout would leave the student stuck for ten minutes.
          finish(workerError('invalid_response'));
          return;
        }
        const data = value as Record<string, unknown>;
        if (data.id !== id) {
          // Older numeric requests can finish late. An id from the future
          // cannot belong to this dedicated worker, so fail fast instead of
          // leaving the learner waiting for the preparation timeout.
          if (typeof data.id !== 'number' || !Number.isSafeInteger(data.id) ||
            data.id <= 0 || data.id > id)
            finish(workerError('invalid_response'));
          return;
        }
        if (data.type === 'progress') {
          // A corrupted phase or a return to loading after generation indicates
          // a broken worker protocol, not useful progress. Fail immediately so
          // students can retry instead of waiting for the long model timeout.
          if (
            (data.phase !== undefined && data.phase !== 'loading' && data.phase !== 'generating')
            || (generating && data.phase === 'loading')
          ) {
            finish(workerError('invalid_response'));
            return;
          }
          if (data.phase === 'generating' && !generating) {
            generating = true;
            generationStartedAt = performance.now();
            clearTimeout(timer);
            timer = setTimeout(
              () => finish(new Error('這段講解逾時，工作已停止。可縮短問題後重試。')),
              STUDY_TUTOR_GENERATION_TIMEOUT_MS,
            );
          }
          // Legacy unphased progress remains valid. Once generation has started,
          // do not mistake a late unphased download message for a new loading phase.
          report(progressMessage(data.message, generating ? 'generating' : data.phase));
        } else if (data.type === 'result') {
          try {
            if (typeof data.raw !== 'string') throw workerError('invalid_response');
            const explanation = parseTutorExplanation(data.raw, source);
            // Saved older lessons may omit steps, but every NEW local lesson
            // promises a usable 2–4-step explanation, not just a generic summary.
            if (!explanation.steps)
              throw new Error('這次講解缺少分步步驟，無法完成逐步學習。請重新講解。');
            if (!hasDistinctGeneratedSteps(explanation))
              throw new Error('這次講解有空白或重複相同的教學步驟，請重新講解。');
            if (!hasSubstantiveGeneratedTeaching(explanation))
              throw new Error('這次講解的說明只有標點或符號，無法作為教學內容。請重新講解。');
            if (!hasExplainedGeneratedEvidence(explanation))
              throw new Error('這次講解只是照抄原文引句，沒有額外解釋。請重新講解。');
            if (!hasSubstantiveGeneratedReview(explanation))
              throw new Error('這次講解的複習題或參考回答只有標點或符號，無法用來練習。請重新講解。');
            if (!hasDistinctGeneratedReview(explanation))
              throw new Error('這次講解的複習題和參考回答內容相同，無法進行自我檢查。請重新講解。');
            if (!hasUnrevealedGeneratedReview(explanation))
              throw new Error('這次複習題直接寫出參考答案，無法練習回想。請重新講解。');
            if (!hasSubstantiveGeneratedEvidence(explanation))
              throw new Error('這次講解的原文引句只有標點或符號，無法核對教材依據。請重新講解。');
            if (!hasBoundedGeneratedEvidence(explanation))
              throw new Error('這次講解的原文引句超過 60 字，無法精準核對教材重點。請重新講解。');
            finish(undefined, explanation);
          } catch (error) {
            finish(error instanceof Error ? error : workerError('invalid_response'));
          }
        } else {
          finish(workerError(data.type === 'error' ? data.code : 'invalid_response'));
        }
      };
      worker.onerror = () => finish(workerError('runtime'));
      worker.onmessageerror = () => finish(workerError('invalid_response'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      report('正在準備裝置端 AI；首次使用會下載模型，教材不會上傳。');
      if (settled || signal.aborted) return;
      try {
        worker.postMessage({ type: 'recognize', id, prompt } satisfies PersonalImportAiWorkerRequest);
      } catch {
        finish(new Error('無法把本段交給裝置端 AI，工作已停止。請重試。'));
      }
    });
  } finally {
    running = false;
  }
}
