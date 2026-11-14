/** Test-only records. Never imported by application code. */
import type {
  CareerOpportunity,
  WorkstudySnapshot,
  CareerApplication,
} from '../src/careerWorkstudy';
export const opportunity: CareerOpportunity = {
  id: 'test-opening',
  revision: 1,
  type: 'workstudy',
  title: '測試用工讀',
  unit: '測試單位',
  pay: '測試待遇欄位',
  slots: [{ day: 1, start: '08:30', end: '10:00' }],
  places: 2,
  deadline: '2099-12-01T09:00:00.000Z',
  credit: false,
  courseCode: '',
  published: true,
  sourceUrl: 'https://cdif.pu.edu.tw/',
  rightsTitle: '測試用權益公告',
  rightsText: '測試確認文字，不是實際校方公告。',
  rightsUrl: 'https://cdif.pu.edu.tw/rights',
};
export const application: CareerApplication = {
  id: 'test-application',
  opportunityId: opportunity.id,
  opportunityTitle: opportunity.title,
  unit: opportunity.unit,
  uid: 'student',
  contact: 'test@example.test',
  introduction: '測試補充',
  state: 'submitted',
  revision: 1,
  submittedAt: '2026-11-14T10:00:00.000Z',
  updatedAt: '2026-11-14T10:00:00.000Z',
  message: '',
  rights: {
    revision: 1,
    title: opportunity.rightsTitle,
    text: opportunity.rightsText,
    url: opportunity.rightsUrl,
    confirmedAt: '2026-11-14T10:00:00.000Z',
  },
};
export function snapshot(): WorkstudySnapshot {
  return {
    events: [],
    opportunities: [{ ...opportunity }],
    applications: [],
    canReview: false,
    canOperate: false,
    audit: [],
    sources: null,
  };
}
export const courses = [
  {
    id: 'course',
    name: '測試課程',
    day: 1,
    start: 1,
    end: 1,
    teacher: '',
    room: '',
    color: 'blue' as const,
  },
];
