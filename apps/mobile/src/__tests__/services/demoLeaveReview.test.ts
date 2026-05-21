import AsyncStorage from '@react-native-async-storage/async-storage';

import { autonomousQuery } from '../../services/aiLocalAgent';
import {
  clearRoleEventInbox,
  emitLeaveRequested,
  loadVisibleRoleEventInbox,
} from '../../services/roleEventBus';
import { resetDemoStore } from '../../services/demoStore';
import {
  isLeaveReviewIntent,
  reviewDemoLeaveRequest,
} from '../../services/demoLeaveReview';

describe('demoLeaveReview', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await resetDemoStore();
    await clearRoleEventInbox('demo_student_kuchih');
    await clearRoleEventInbox('demo_teacher_chang');
    await clearRoleEventInbox('demo_admin_huang');
  });

  async function seedLeave() {
    await emitLeaveRequested({
      actorUid: 'demo_student_kuchih',
      actorName: '顧晉瑋',
      targetUids: ['demo_teacher_chang', 'demo_admin_huang'],
      courseId: 71378,
      courseName: '機器學習',
      payload: {
        leaveId: 'lv-review-1',
        studentName: '顧晉瑋',
        category: 'sick',
        fromDate: '2026-05-20',
        toDate: '2026-05-20',
        reason: '發燒',
      },
    });
  }

  it('routes leave review wording to review intent instead of student leave application', () => {
    expect(isLeaveReviewIntent('核准這張請假單')).toBe(true);
    expect(isLeaveReviewIntent('我要請假')).toBe(false);
  });

  it('teacher can approve a pending leave and the student receives the decision', async () => {
    await seedLeave();

    const result = await reviewDemoLeaveRequest({
      reviewerUid: 'demo_teacher_chang',
      reviewerRole: 'teacher',
      reviewerName: '張怡君',
      message: '核准這張請假單',
    });

    expect(result.success).toBe(true);
    expect(result.isWrite).toBe(true);
    expect(result.summary).toContain('已核准');

    const studentInbox = await loadVisibleRoleEventInbox({
      uid: 'demo_student_kuchih',
      role: 'student',
    });
    expect(studentInbox.some((event) => event.kind === 'leave_decision')).toBe(true);
  });

  it('supports ordinal approval from quick suggestions', async () => {
    await seedLeave();

    const result = await reviewDemoLeaveRequest({
      reviewerUid: 'demo_teacher_chang',
      reviewerRole: 'teacher',
      reviewerName: '張怡君',
      message: '核准第 1 張請假單',
    });

    expect(result.success).toBe(true);
    expect(result.isWrite).toBe(true);
    expect(result.summary).toContain('已核准');
  });

  it('lists choices when the teacher asks to review without a decision', async () => {
    await seedLeave();

    const result = await reviewDemoLeaveRequest({
      reviewerUid: 'demo_teacher_chang',
      reviewerRole: 'teacher',
      reviewerName: '張怡君',
      message: '我要審核請假單',
    });

    expect(result.success).toBe(true);
    expect(result.isWrite).toBe(false);
    expect(result.summary).toContain('待審請假單');
    expect(result.choiceMenu?.producedByTool).toBe('review_leave');
  });

  it('TA and non-review roles do not get leave approval permission', async () => {
    await seedLeave();

    const result = await reviewDemoLeaveRequest({
      reviewerUid: 'demo_ta_lin',
      reviewerRole: 'ta',
      reviewerName: '林助教',
      message: '核准這張請假單',
    });

    expect(result.success).toBe(false);
    expect(result.summary).toContain('沒有請假審核權限');
  });

  it('autonomous agent executes review_leave for teacher approval wording', async () => {
    await seedLeave();

    const result = await autonomousQuery('核准這張請假單', {
      userId: 'demo_teacher_chang',
      schoolId: 'pu',
      role: 'teacher',
      isOnline: true,
    });

    expect(result.executedActions.some((action) => action.tool === 'review_leave' && action.result.success)).toBe(true);
    expect(result.executedActions.map((action) => action.tool)).not.toContain('request_leave');
  });
});
