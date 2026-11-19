'use strict';

const QUOTES = new Map([['「', '」'], ['『', '』'], ['“', '”'], ['‘', '’'], ['"', '"'], ["'", "'"]]);
const QUOTE_MARK = /[「」『』“”‘’"']/u;
const PREFIX = '(?:(?:請(?:你)?|麻煩(?:你)?)\\s*)?(?:幫我\\s*)?';
const DIRECT_PLAN = new RegExp(`^${PREFIX}(?:拆解|分解|安排|規劃)\\s*(.+)$`, 'u');
const SPLIT_PLAN = new RegExp(`^${PREFIX}把\\s*(.+?)\\s*(?:拆解|分解|拆)成\\s*(?:待辦(?:事項)?|步驟|讀書計畫|計畫)$`, 'u');
const GENERIC_TARGETS = new Set(['作業', '我的作業', '待繳作業', '我的待繳作業', '這週作業', '本週作業']);
const GENERIC_PLANS = new Set(['讀書計畫', '一般讀書計畫']);

function normalize(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/[A-Z]/g, (letter) => letter.toLowerCase()).replace(/\s+/gu, ' ').trim()
    : '';
}

function nameOf(value) {
  const text = value.trim();
  const closing = QUOTES.get(text[0]);
  if (closing) {
    if (!text.endsWith(closing)) return null;
    const inner = text.slice(1, -1).trim();
    return inner && !QUOTE_MARK.test(inner) ? inner : null;
  }
  return text && !QUOTE_MARK.test(text) ? text : null;
}

function titleNamesOf(text, allowNoun) {
  const names = [];
  const fullName = nameOf(text);
  if (fullName) names.push(fullName);
  if (allowNoun) {
    const quotedName = /^作業\s*(.+)$/u.exec(text);
    if (quotedName && QUOTES.has(quotedName[1][0])) {
      const name = nameOf(quotedName[1]);
      if (name) names.push(name);
    }
    const suffixedName = /^(.+?)\s*作業$/u.exec(text);
    if (suffixedName) {
      const name = nameOf(suffixedName[1]);
      if (name) names.push(name);
    }
  }
  return names;
}

function referencesOf(text, allowNoun) {
  const references = [];
  for (const title of titleNamesOf(text, allowNoun)) references.push({ title });
  // A split inside a quoted name is rejected by nameOf; do not strip arbitrary prefixes.
  for (const match of text.matchAll(/的|\s+/gu)) {
    const course = nameOf(text.slice(0, match.index));
    const titles = titleNamesOf(text.slice(match.index + match[0].length).trim(), allowNoun);
    if (course) for (const title of titles) references.push({ title, course });
  }
  return references;
}

function outsideQuotedNames(text) {
  let closing;
  let outside = '';
  for (const character of text) {
    if (closing) {
      if (character === closing) closing = null;
    } else if (QUOTES.has(character)) {
      closing = QUOTES.get(character);
    } else {
      outside += character;
    }
  }
  return outside;
}

/** Resolve only complete names from the already authorized assignment source. */
function resolveAssignmentPlanningTarget(message, assignments) {
  if (!Array.isArray(assignments) || assignments.length === 0) return { target: null, reason: 'empty' };
  const clarify = { target: null, reason: 'clarify' };
  const text = normalize(message);
  const commandText = outsideQuotedNames(text);
  if (!text || /不|別|勿|無需|毋須|取消|排除|除了|除外|而非|改成|改為|改用|\b(?:no|not|never|don't|dont|without|except)\b/u.test(commandText)) {
    return clarify;
  }
  if (/[、,;]|以及|還有|並且|和|與|或|跟|一起|\b(?:and|or)\b/u.test(commandText)) return clarify;

  // A final punctuation mark can belong to the title or the sentence. Preserve
  // every boundary (e.g. Report?! / Report? / Report), including generic readings.
  const readings = [text];
  for (let reading = text; /[。.!?]$/u.test(reading);) {
    reading = reading.slice(0, -1).trimEnd();
    if (reading) readings.push(reading);
  }
  const matches = new Map();
  for (const reading of readings) {
    const command = SPLIT_PLAN.exec(reading) || DIRECT_PLAN.exec(reading);
    const targetText = command ? command[1].trim() : reading;
    const generic = GENERIC_PLANS.has(reading) ||
      (command && (GENERIC_TARGETS.has(targetText) || GENERIC_PLANS.has(targetText)));
    if (generic) {
      if (!normalize(assignments[0]?.title)) return clarify;
      if (!matches.has(0)) matches.set(0, 'generic');
      continue;
    }
    const references = referencesOf(targetText, Boolean(command));
    assignments.forEach((assignment, index) => {
      const title = normalize(assignment?.title);
      if (!title) return;
      const courses = [normalize(assignment.groupName), normalize(assignment.groupId)].filter(Boolean);
      if (references.some((reference) => reference.title === title &&
        (reference.course === undefined || courses.includes(reference.course)))) {
        matches.set(index, 'exact');
      }
    });
  }
  if (matches.size !== 1) return clarify;
  const [[index, reason]] = matches;
  return { target: assignments[index], reason };
}

module.exports = { resolveAssignmentPlanningTarget };
