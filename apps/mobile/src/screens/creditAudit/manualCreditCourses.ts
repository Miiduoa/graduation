import type { CreditCategory } from '@campus/shared/src/creditAudit';
import type { SavedCourse } from '../../features/academics';

export function mayOfferPuCsie115Reference(schoolId: string, department?: string | null): boolean {
  const canonical = schoolId.trim().toLowerCase();
  return (canonical === 'pu' || canonical === 'tw-pu') &&
    /資訊工程|computer science/i.test(department ?? '');
}

export const MAX_CREDIT_IMPORT_BYTES = 600_000;
export const MAX_CREDIT_IMPORT_COURSES = 300;

export function manualCreditAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!/^(?:\d{1,2}|30)(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) && amount > 0 && amount <= 30 ? amount : null;
}

export function validCourseName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 80;
}

function escapeCsvCell(value: string | number): string {
  const source = String(value);
  // CSV 欄位會加引號以處理逗號與換行；前綴用來避免試算表把內容當公式執行。
  const safe = /^[\s]*[=+\-@]/.test(source) ? "'" + source : source;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function exportManualCreditCsv(courses: readonly SavedCourse[]): string {
  const lines: Array<Array<string | number>> = [
    ['課程名稱', '學分', '分類', '成績', '學期', '通過'],
    ...courses.map((course) => [
      course.name,
      course.credits,
      course.category,
      course.grade ?? '',
      course.semester ?? '',
      course.passed ? '是' : '否',
    ]),
  ];
  return '\ufeff' + lines.map((cells) => cells.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n';
}

export function parseCreditCsvRows(input: string): string[][] {
  if (input.length > MAX_CREDIT_IMPORT_BYTES) throw new Error('檔案太大，請分批匯入。');
  const rows: string[][] = [];
  let cells: string[] = [];
  let value = '';
  let quoted = false;
  let closed = false;
  let started = false;

  const pushCell = () => {
    if (value.length > 2_000) throw new Error('CSV 欄位內容過長。');
    cells.push(value);
    value = '';
    started = false;
    closed = false;
  };
  const pushRow = () => {
    pushCell();
    if (cells.some((item) => item.trim())) {
      rows.push(cells);
      if (rows.length > MAX_CREDIT_IMPORT_COURSES + 1) {
        throw new Error('每次最多匯入 300 門課，請分批匯入。');
      }
    }
    cells = [];
  };

  const text = input.replace(/^\ufeff/, '');
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        value += char;
      }
      continue;
    }
    if (char === ',' || char === '\n' || char === '\r') {
      if (char === ',') pushCell();
      else {
        pushRow();
        if (char === '\r' && text[i + 1] === '\n') i += 1;
      }
      continue;
    }
    if (closed) {
      if (char === ' ' || char === '\t') continue;
      throw new Error('CSV 引號格式錯誤。');
    }
    if (char === '"') {
      if (started || value.trim()) throw new Error('CSV 引號格式錯誤。');
      value = '';
      quoted = true;
      started = true;
    } else {
      value += char;
      started = true;
    }
  }
  if (quoted) throw new Error('CSV 有未結束的引號。');
  if (value || cells.length || started || closed) pushRow();
  return rows;
}

export type ImportedCreditCourse = Pick<
  SavedCourse,
  'name' | 'credits' | 'category' | 'grade' | 'semester' | 'passed'
>;

export type CreditCsvImportResult = {
  courses: ImportedCreditCourse[];
  skipped: number;
  missingPassEvidence: number;
};

function mapCategory(raw: string): CreditCategory {
  const value = raw.trim().toLowerCase();
  if (value.includes('必修') || value === 'required') return 'required';
  if (value.includes('通識') || value === 'general') return 'general';
  if (value.includes('英文') || value === 'english') return 'english';
  if (value.includes('其他') || value === 'other') return 'other';
  return 'elective';
}

function headerIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.some((word) => header.includes(word)));
}

/**
 * 沒有明確及格標記的成績只算未核可，不能當成已取得學分。
 * 同時支援舊版手機 CSV 與網頁規劃器的預修課程 CSV。
 */
export function parseManualCreditCsv(input: string): CreditCsvImportResult {
  const rows = parseCreditCsvRows(input);
  if (rows.length < 2) throw new Error('CSV 必須包含標題列和至少一門課。');
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const nameAt = headerIndex(headers, ['課程名稱', '課程', '名稱', 'name']);
  const creditsAt = headerIndex(headers, ['學分', 'credit']);
  const categoryAt = headerIndex(headers, ['分類', '類別', 'category']);
  const gradeAt = headerIndex(headers, ['成績', 'grade']);
  const semesterAt = headerIndex(headers, ['學期', 'semester']);
  const passedAt = headerIndex(headers, ['通過', 'passed']);
  const statusAt = headerIndex(headers, ['狀態', 'status']);
  if (nameAt < 0 || creditsAt < 0) throw new Error('CSV 需要「課程名稱」與「學分」欄位。');

  const courses: ImportedCreditCourse[] = [];
  let skipped = 0;
  let missingPassEvidence = 0;
  for (const cells of rows.slice(1)) {
    const name = (cells[nameAt] ?? '').trim();
    const credits = manualCreditAmount(cells[creditsAt] ?? '');
    const term = (cells[semesterAt] ?? '').trim();
    // 略過網頁規劃器的合計／表尾列，不要當成真實課程加入。
    if (statusAt >= 0 && semesterAt >= 0 && !/^未來第\s*\d+\s*學期$/.test(term)) {
      skipped += 1;
      continue;
    }
    if (!validCourseName(name) || credits === null) {
      skipped += 1;
      continue;
    }
    const rawPass = (passedAt >= 0 ? cells[passedAt] ?? '' : '').trim().toLowerCase();
    const passed = ['是', 'yes', 'true', '1', 'pass', 'passed', '通過'].includes(rawPass);
    if (!passed) missingPassEvidence += 1;
    const grade = gradeAt < 0 ? '' : (cells[gradeAt] ?? '').trim().slice(0, 32);
    courses.push({
      name,
      credits,
      category: categoryAt < 0 ? 'elective' : mapCategory(cells[categoryAt] ?? ''),
      grade: grade || undefined,
      semester: term || undefined,
      passed,
    });
  }
  if (courses.length === 0) throw new Error('沒有可匯入的有效課程，請檢查欄位與學分。');
  return { courses, skipped, missingPassEvidence };
}

export function manualCreditProgress(courses: readonly SavedCourse[]) {
  const passed = courses.filter((course) => course.passed && Number.isFinite(course.credits) && course.credits > 0);
  const selfReportedCredits = Number(passed.reduce((sum, course) => sum + course.credits, 0).toFixed(2));
  return {
    selfReportedCredits,
    reportedPassedCourses: passed.length,
    totalCourses: courses.length,
    pendingCourses: courses.length - passed.length,
  };
}
