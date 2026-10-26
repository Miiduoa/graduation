export const COURSE_V2_ROUTES = {
  materials: 'CourseMaterialsV2',
  assignments: 'CourseAssignmentsV2',
  assignmentDetail: 'CourseAssignmentDetailV2',
  quizzes: 'CourseQuizzesV2',
  announcements: 'CourseAnnouncementsV2',
} as const;

export const COURSE_V2_SHORTCUT_GROUPS = [
  {
    title: '學習內容',
    description: '從教材開始，接著完成作業與測驗。',
    shortcuts: [
      { key: 'materials', label: '教材', detail: '課程檔案與閱讀內容', route: COURSE_V2_ROUTES.materials },
      { key: 'assignments', label: '作業', detail: '查看要求與繳交紀錄', route: COURSE_V2_ROUTES.assignments },
      { key: 'quizzes', label: '測驗', detail: '查看小考與作答次數', route: COURSE_V2_ROUTES.quizzes },
      { key: 'announcements', label: '公告', detail: '掌握老師發布的消息', route: COURSE_V2_ROUTES.announcements },
    ],
  },
  {
    title: '互動與回饋',
    description: '討論課程、查看學習成果與課堂活動。',
    shortcuts: [
      { key: 'forum', label: '討論', detail: '參與課程討論串', route: 'CourseDiscussion' },
      { key: 'grades', label: '成績', detail: '查看課內評分紀錄', route: 'CourseScores' },
      { key: 'assistant', label: '校園助理', detail: '提問與安排學習', route: 'AIAgentConsole' },
      { key: 'live', label: '課堂與點名', detail: '查看課堂活動', route: 'Attendance' },
    ],
  },
] as const;
