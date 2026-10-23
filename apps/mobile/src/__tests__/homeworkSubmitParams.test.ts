import { homeworkSubmitParams } from '../screens/CoursesHomeScreen';

test('pending and submitted homework both open the assignment with its id and due date', () => {
  expect(
    homeworkSubmitParams({
      id: 88,
      course_id: 12,
      title: '期末報告',
      end_time: '2026-10-20T16:00:00.000Z',
      description: '請交摘要',
    }),
  ).toEqual({
    courseId: '12',
    hwId: '88',
    hwTitle: '期末報告',
    dueAt: '2026-10-20T16:00:00.000Z',
    description: '請交摘要',
  });
});
