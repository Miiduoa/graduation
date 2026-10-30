'use strict';

const { parseFragment } = require('parse5');

const MAX_DOCUMENT_LENGTH = 4 * 1024 * 1024;
const OMITTED = new Set(['script', 'style', 'template', 'input', 'select', 'button', '#comment']);

function nodeText(node, skipTables = false) {
  if (OMITTED.has(node.nodeName) || (skipTables && node.nodeName === 'table')) return '';
  if (node.nodeName === '#text') return node.value || '';
  if (node.nodeName === 'br') return ' ';
  return (node.childNodes || []).map(child => nodeText(child, skipTables)).join(' ');
}

function cleanText(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedLabel(value) {
  return cleanText(value).replace(/[\s（()）：:]/g, '').toLowerCase();
}

const TERM_DIGIT = { 一: '1', 二: '2', 三: '3', 上: '1', 下: '2', 暑: '3' };

function termDigit(value) {
  return TERM_DIGIT[value] || (/^[123]$/.test(value) ? value : '');
}

function semesterCodesInText(value) {
  const codes = [];
  const pattern = /(?:學期別\s*(?:[（(]\s*Semester\s*[）)])?\s*[：:]?\s*(\d{2,3})\s*\[\s*([123])\s*\]|(\d{2,3})\s*學年(?:度)?\s*第?\s*([123一二三上下暑])\s*學期?)/gi;
  for (const match of value.matchAll(pattern)) {
    const term = match[2] || termDigit(match[4]);
    if (term) codes.push((match[1] || match[3]) + term);
  }
  return codes;
}

function semesterCell(value) {
  const text = cleanText(value);
  const heading = semesterCodesInText(text);
  if (heading.length === 1) return heading[0];
  const match = text.match(/^(\d{2,3})\s*(?:[-/]\s*([123])|\[\s*([123])\s*\]|([123上下暑]))$/);
  if (!match) return '';
  const term = match[2] || match[3] || termDigit(match[4]);
  return term ? match[1] + term : '';
}

function parseCredits(value) {
  const text = cleanText(value)
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 48))
    .replace(/\uFF0E/g, '.')
    .replace(/學分(?:數)?$/u, '')
    .trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const credits = Number(text);
  return Number.isFinite(credits) ? credits : null;
}

function isLatinTitle(value) {
  return /^[A-Za-z][A-Za-z0-9 .,&'()/\-]*$/.test(value);
}

// Only a standalone heading cell may change the surrounding semester context.
// A malformed heading clears that context rather than borrowing the prior term.
function tableSemesterHeading(cells) {
  if (cells.length !== 1) return null;
  const label = cleanText(nodeText(cells[0], true));
  if (!/^(?:學期別|\d{2,3}\s*學年(?:度)?)/.test(label)) return null;
  const match = label.match(/^(?:學期別\s*(?:[（(]\s*Semester\s*[）)])?\s*[：:]?\s*(\d{2,3})\s*\[\s*([123])\s*\]|(\d{2,3})\s*學年(?:度)?\s*第?\s*([123一二三上下暑])\s*學期?)$/i);
  if (!match) return '';
  const term = match[2] || termDigit(match[4]);
  return (match[1] || match[3]) + term;
}

function tableRows(table) {
  const rows = [];
  const groupSizes = new Map();
  function visit(node, group = table) {
    if (node !== table && node.nodeName === 'table') return;
    if (['thead', 'tbody', 'tfoot'].includes(node.nodeName)) group = node;
    if (node.nodeName === 'tr') {
      rows.push({
        group,
        cells: (node.childNodes || []).filter(child => child.nodeName === 'td' || child.nodeName === 'th'),
      });
      groupSizes.set(group, (groupSizes.get(group) || 0) + 1);
      return;
    }
    for (const child of node.childNodes || []) visit(child, group);
  }
  visit(table);
  const spans = new Map();
  let previousGroup = null;
  return rows.map(({ cells, group }) => {
    // HTML rowspans do not cross row-group boundaries; zero means the rest of this group.
    const startsRowGroup = previousGroup !== group;
    if (startsRowGroup) spans.clear();
    previousGroup = group;
    const remainingRows = groupSizes.get(group);
    groupSizes.set(group, remainingRows - 1);
    const values = [];
    for (const [column, span] of spans) {
      values[column] = span.text;
      if (--span.remaining <= 0) spans.delete(column);
    }
    let column = 0;
    for (const cell of cells) {
      while (values[column] !== undefined) column += 1;
      const attrs = Object.fromEntries((cell.attrs || []).map(attr => [attr.name, attr.value]));
      const colspan = Math.min(40, Math.max(1, Number.parseInt(attrs.colspan, 10) || 1));
      const rawRowspan = Number.parseInt(attrs.rowspan, 10);
      const rowspan = Math.min(1000, remainingRows, Math.max(1, rawRowspan === 0 ? remainingRows : rawRowspan || 1));
      const text = cleanText(nodeText(cell, true));
      for (let offset = 0; offset < colspan; offset++) {
        values[column + offset] = offset === 0 ? text : '';
        if (rowspan > 1) spans.set(column + offset, { text: offset === 0 ? text : '', remaining: rowspan - 1 });
      }
      column += colspan;
    }
    return { values, semesterHeading: tableSemesterHeading(cells), startsRowGroup };
  });
}

function headerColumns(cells) {
  const fields = {};
  cells.forEach((value, index) => {
    const label = normalizedLabel(value);
    if (/^(?:學期別|學期|semester)/.test(label)) fields.semester = index;
    else if (/^(?:選課代號|課程代碼|科目代碼|課號|科目編號|課程編號|coursecode|courseid)/.test(label)) fields.code = index;
    else if (/^(?:修別|類別|課程類別|coursetype|type)/.test(label)) fields.courseType = index;
    else if (/^(?:科目名稱|課程名稱|科目|課程|coursename|coursetitle|course$)/.test(label)) fields.title = index;
    else if (/^(?:修課班級|開課班級|上課班級|班級|class)/.test(label)) fields.class = index;
    else if (/^(?:學分數|學分|credits?)/.test(label)) fields.credits = index;
    else if (/^(?:成績|分數|score|grade)/.test(label)) fields.score = index;
  });
  return fields.title !== undefined && fields.credits !== undefined && fields.score !== undefined ? fields : null;
}

function isSummaryLabel(label) {
  return /^(?:學期(?:學業)?平均(?:成績|分數)?|平均(?:成績|分數)?|(?:學期)?操行(?:成績)?|系排名|班排名|(?:semester\s+)?average(?:\s+(?:score|grade))?|behavior(?:\s+score)?|(?:department|class)\s+rank(?:ing)?)(?:\s*[（(]|\s*$)/i.test(label);
}

function appendSummary(summary, semester, label, score) {
  if (!summary[semester]) summary[semester] = {};
  const entry = summary[semester];
  if (/系排名|department/i.test(label)) entry.departmentRanking = score;
  else if (/班排名|class\s*rank/i.test(label)) entry.classRanking = score;
  else if (/操行|behavior/i.test(label)) entry.behaviorScore = score;
  else if (/平均|average/i.test(label)) entry.semesterAverage = score;
}

function parseGradeValue(value) {
  if (/^(?:通過|pass)(?:\s*[（(]pass[）)])?$/i.test(value)) return 'Pass';
  if (/^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function readDocument(html) {
  const document = parseFragment(html);
  const grades = [];
  const summary = {};
  const allSemesters = [];
  const seen = new Set();
  let semester = '';
  let precedingText = '';
  let recognizedTable = false;
  let skippedRows = 0;
  function rememberSemester(code) {
    if (code && !allSemesters.includes(code)) allSemesters.push(code);
    return code;
  }
  function consumeHeadings(text) {
    for (const code of semesterCodesInText(cleanText(text))) semester = rememberSemester(code);
  }
  function consumeTable(table) {
    const rows = tableRows(table);
    const headerIndex = rows.findIndex(row => headerColumns(row.values));
    if (headerIndex < 0) return false;
    recognizedTable = true;
    consumeHeadings(precedingText);
    const caption = (table.childNodes || []).find(node => node.nodeName === 'caption');
    if (caption) {
      const captionSemester = tableSemesterHeading([caption]);
      if (captionSemester !== null) semester = rememberSemester(captionSemester);
      else consumeHeadings(nodeText(caption));
    }
    for (const row of rows.slice(0, headerIndex)) {
      if (row.semesterHeading !== null) semester = rememberSemester(row.semesterHeading);
      else consumeHeadings(row.values.join(' '));
    }
    let columns = headerColumns(rows[headerIndex].values);
    let lastRecord = null;
    for (const { values: cells, semesterHeading, startsRowGroup } of rows.slice(headerIndex + 1)) {
      if (startsRowGroup) lastRecord = null;
      if (semesterHeading !== null) {
        semester = rememberSemester(semesterHeading);
        lastRecord = null;
        continue;
      }
      const repeatedHeader = headerColumns(cells);
      if (repeatedHeader) {
        columns = repeatedHeader;
        lastRecord = null;
        continue;
      }
      const title = cleanText(cells[columns.title]);
      const semesterText = columns.semester === undefined ? '' : cleanText(cells[columns.semester]);
      const parsedSemester = semesterText ? semesterCell(semesterText) : '';
      const inheritedSemester = parsedSemester || (semesterText ? '' : semester);
      // An explicit semester column is evidence: a blank cell is not permission
      // to borrow a previous row/group. Summary and continuation rows are
      // handled separately because they may legitimately omit that cell.
      const ownSemester = columns.semester === undefined ? semester : parsedSemester;
      const score = cleanText(cells[columns.score]);
      const summaryLabel = [title, semesterText].find((label) => label && isSummaryLabel(label));
      if (summaryLabel) {
        if (inheritedSemester && score) appendSummary(summary, rememberSemester(inheritedSemester), summaryLabel, score);
        if (inheritedSemester) semester = inheritedSemester;
        continue;
      }
      if (!title) continue;
      const credits = parseCredits(cells[columns.credits]);
      if (isLatinTitle(title) && credits === null && lastRecord && inheritedSemester === lastRecord.semester) {
        if (!lastRecord.courseNameEn) lastRecord.courseNameEn = title;
        continue;
      }
      if (!ownSemester) { skippedRows += 1; continue; }
      semester = rememberSemester(ownSemester);
      if (credits === null) { skippedRows += 1; continue; }
      const boundary = title.search(/[A-Z]/);
      const record = {
        semester: ownSemester,
        courseName: boundary > 0 ? title.slice(0, boundary).trim() : title,
        courseNameEn: boundary > 0 ? title.slice(boundary).trim() : '',
        class: cleanText(cells[columns.class]),
        courseType: cleanText(cells[columns.courseType]),
        credits,
        score: parseGradeValue(score),
      };
      const courseCode = cleanText(cells[columns.code]);
      if (courseCode) record.courseCode = courseCode;
      const key = JSON.stringify(record);
      if (seen.has(key)) continue;
      seen.add(key);
      grades.push(record);
      lastRecord = record;
    }
    precedingText = '';
    return true;
  }
  function visit(node) {
    if (OMITTED.has(node.nodeName)) return;
    if (node.nodeName === 'table' && consumeTable(node)) return;
    if (node.nodeName === '#text') precedingText = (precedingText + ' ' + node.value).slice(-4000);
    for (const child of node.childNodes || []) visit(child);
  }
  visit(document);
  consumeHeadings(precedingText);
  return { grades, allSemesters, summary, recognizedTable, skippedRows };
}

function parseGradeSemesterCodes(html) {
  if (typeof html !== 'string' || html.length > MAX_DOCUMENT_LENGTH) return [];
  return readDocument(html).allSemesters;
}

function parsePuGradeDocument(html, semesterFilter = '') {
  if (typeof html !== 'string' || !html.trim() || html.length > MAX_DOCUMENT_LENGTH) {
    return { success: false, grades: [], allSemesters: [], summary: {}, error: 'Empty or oversized grade document' };
  }
  const { grades, allSemesters, summary, recognizedTable, skippedRows } = readDocument(html);
  if (!allSemesters.length) {
    return { success: false, grades: [], allSemesters, summary, error: 'Unrecognized semester headings or columns' };
  }
  if (!recognizedTable || !grades.length) {
    return { success: false, grades: [], allSemesters, summary, error: 'No recognizable grade rows; document may have changed' };
  }
  return {
    success: true,
    grades: semesterFilter ? grades.filter(item => item.semester === semesterFilter) : grades,
    allSemesters,
    summary,
    coverage: { status: skippedRows > 0 ? 'partial' : 'unknown', skippedRows },
  };
}

module.exports = { parseGradeSemesterCodes, parsePuGradeDocument };