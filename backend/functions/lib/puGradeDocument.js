'use strict';

// Parse the grade table shape documented by the PU integration.
// This parser is intentionally pure: no HTTP, cookies, or Firebase dependencies.
function stripCell(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseGradeSemesterCodes(html) {
  if (typeof html !== 'string') return [];
  const found = [];
  const regex = /學期別\(Semester\)[：:]\s*(\d{2,3})\s*\[\s*(\d+)\s*\]/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const code = match[1] + match[2];
    if (!found.includes(code)) found.push(code);
  }
  return found;
}

function rowsInTable(tableHtml) {
  const rows = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRegex.exec(tableHtml)) !== null) {
    const cells = [];
    const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cell;
    while ((cell = cellRegex.exec(row[1])) !== null) cells.push(stripCell(cell[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function isSummaryLabel(label) {
  return /平均|average|操行|behavior|排名|ranking/i.test(label);
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
  if (/^(?:通過|pass)(?:\(pass\))?$/i.test(value)) return 'Pass';
  const text = String(value || '').trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function parsePuGradeDocument(html, semesterFilter = '') {
  if (typeof html !== 'string' || !html.trim()) {
    return { success: false, grades: [], allSemesters: [], summary: {}, error: 'Empty grade document' };
  }
  const headers = /學期別\(Semester\)[：:]\s*(\d{2,3})\s*\[\s*(\d+)\s*\]/gi;
  const matches = [...html.matchAll(headers)];
  const allSemesters = parseGradeSemesterCodes(html);
  if (!matches.length) {
    return { success: false, grades: [], allSemesters: [], summary: {}, error: 'Unrecognized semester headings' };
  }

  const grades = [];
  const summary = {};
  const seen = new Set();
  for (let i = 0; i < matches.length; i++) {
    const header = matches[i];
    const semester = header[1] + header[2];
    const start = header.index + header[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : html.length;
    const section = html.slice(start, end);
    const tables = section.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) || [];
    for (const table of tables) {
      if (!/(?:科目|Course)/i.test(table) || !/(?:成績|Score)/i.test(table)) continue;
      for (const cells of rowsInTable(table)) {
        if (cells.length < 5) continue;
        const title = cells[0];
        if (!title || /^(?:科目名稱|Course\b)/i.test(title)) continue;
        const score = cells[cells.length - 1];
        if (isSummaryLabel(title)) {
          appendSummary(summary, semester, title, score);
          continue;
        }
        const className = cells[cells.length - 4];
        const courseType = cells[cells.length - 3];
        const creditsText = cells[cells.length - 2];
        const credits = Number(creditsText);
        if (!Number.isFinite(credits) || credits < 0 || !score) continue;
        const boundary = title.search(/[A-Z]/);
        const courseName = boundary > 0 ? title.slice(0, boundary).trim() : title.trim();
        const courseNameEn = boundary > 0 ? title.slice(boundary).trim() : '';
        const record = {
          semester, courseName, courseNameEn, class: className, courseType,
          credits, score: parseGradeValue(score)
        };
        const key = JSON.stringify(record);
        if (seen.has(key)) continue;
        seen.add(key);
        grades.push(record);
      }
    }
  }
  if (!grades.length) {
    return {
      success: false, grades: [], allSemesters, summary,
      error: 'No recognizable grade rows; document may have changed'
    };
  }
  return {
    success: true,
    grades: semesterFilter ? grades.filter(item => item.semester === semesterFilter) : grades,
    allSemesters, summary
  };
}

module.exports = { parseGradeSemesterCodes, parsePuGradeDocument };
