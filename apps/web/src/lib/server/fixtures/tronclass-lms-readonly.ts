/** 假資料，不含真實學號或個資。 */
export const LMS_FIXTURE_COURSE = {
  id: 10001,
  name: '資料庫系統',
  course_code: 'CS2001',
  teachers: [{ name: '林老師' }],
  status: 'ongoing',
  semester: '1142',
};

export const LMS_FIXTURE_HOMEWORK_OPEN = {
  id: 20001,
  title: '期末專題提案',
  type: 'homework',
  submitted: false,
  deadline: '2026-05-29T15:59:00Z',
  end_time: '2026-05-29T15:59:00Z',
  data: { description: '<p>請上傳提案 PDF</p>' },
};

export const LMS_FIXTURE_HOMEWORK_DONE = {
  id: 20002,
  title: '週次練習',
  type: 'homework',
  submitted: true,
  deadline: '2026-05-29T15:59:00Z',
  end_time: '2026-05-29T15:59:00Z',
  data: { description: '已交的作業' },
};

export const LMS_FIXTURE_HOMEWORK_WEEK = {
  id: 20003,
  title: '閱讀心得',
  type: 'homework',
  submitted: false,
  deadline: '2026-06-03T15:59:00Z',
  data: { description: '七天內截止' },
};

export const LMS_FIXTURE_MATERIAL = {
  id: 30001,
  course_id: 10001,
  title: '簡樸生活講義',
  type: 'material',
  uploads: [
    { id: 1, name: 'notes.pdf', key: 'upload-key-notes', allow_download: true },
    { id: 2, name: 'restricted.pdf', key: 'upload-key-restricted', allow_download: false },
  ],
};

export const LMS_FIXTURE_ANNOUNCEMENT = {
  id: 40001,
  title: '停課通知',
  content: '下週演習停課一次',
  created_at: '2026-05-20T02:00:00Z',
};

export const LMS_FIXTURE_NOW = new Date('2026-05-29T04:00:00Z');
