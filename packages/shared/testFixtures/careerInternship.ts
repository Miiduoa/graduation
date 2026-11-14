/** Test-only fixtures. Never loaded by product screens or handlers. */
import {
  INTERNSHIP_STEPS,
  type InternshipRule,
  type InternshipRecord,
} from '../src/careerInternship';
export const internshipRule: InternshipRule = {
  id: 'rule',
  revision: 1,
  department: '測試系',
  term: '115-1',
  credits: 1,
  hoursPerCredit: 60,
  sourceUrl: 'https://cdif.pu.edu.tw/',
  applicationUrl: 'https://cdif.pu.edu.tw/',
  documents: INTERNSHIP_STEPS.map((title) => ({
    title,
    recipient: '系辦',
    deadline: '2026-12-01T09:00:00.000Z',
  })),
};
export function internshipRecord(): InternshipRecord {
  return {
    id: 'record',
    revision: 1,
    uid: 'student',
    rule: structuredClone(internshipRule),
    organization: '測試用機構',
    teacher: '測試指導老師',
    teacherUid: 'teacher',
    hours: [],
    documents: internshipRule.documents.map(() => ({
      submitted: false,
      url: '',
      verified: false,
      message: '',
    })),
    confirmed: false,
    updatedAt: '2026-11-14T10:00:00.000Z',
  };
}
