/**
 * Demo Inbox Seeder — 登入 demo 角色時種一批歷史 RoleEvent
 *
 * 目的：切到任何 demo 角色 → inbox 已有合理歷史動態，不會空白頁。
 *  - student (顧晉瑋) → 老師上週批改的成績 + 餐廳訂單 ready + 系所廣播
 *  - teacher (張怡君) → 學生繳交 + AI 預警 + TA 已批改
 *  - vendor (阿英) → 多家店積累訂單（已由 demoMerchants demo data 提供，但 inbox 種「LOYALTY 提示」）
 *  - admin (黃主任) → risk 學生個案 + 教學評鑑回饋
 *  - ta (林助教) → 老師指派批改 + 學生求助
 *
 * 重點：每個事件 occurredAt 在不同時間（過去 5 分鐘 ~ 過去 5 天），讓 inbox 看起來真實。
 * 已 seeded 後不重複（用 storage flag）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getScopedStorageKey } from './scopedStorage';
import {
  emitGradePublished,
  emitFeedbackDrafted,
  emitBulkReminder,
  emitAttendanceOpened,
  emitDepartmentBroadcast,
  emitOrderStatusChanged,
  emitOrderPlaced,
  emitHomeworkSubmitted,
  emitAttendanceCheckedIn,
} from './roleEventBus';

const SEED_FLAG_BASE = 'demo_inbox_seeded_v2';

/**
 * Demo seed 包含 5 種角色各自會收到的歷史事件。
 * 切換 demo 角色時呼叫一次（idempotent）。
 */
export async function seedDemoInboxIfNeeded(uid: string): Promise<{ seeded: number }> {
  if (!uid.startsWith('demo_')) return { seeded: 0 };

  const flagKey = getScopedStorageKey(SEED_FLAG_BASE, { uid });
  const already = await AsyncStorage.getItem(flagKey).catch(() => null);
  if (already === 'true') return { seeded: 0 };

  let count = 0;

  // ────────────────────────────────────────────────
  // STUDENT 顧晉瑋的 inbox 種子
  // ────────────────────────────────────────────────
  if (uid === 'demo_student_kuchih') {
    // 1. 5 天前：成績公布
    await emitGradePublished({
      actorUid: 'demo_teacher_chang',
      actorName: '張怡君',
      targetUids: [uid],
      courseId: 101,
      courseName: '資料庫管理系統',
      payload: {
        itemTitle: 'HW2 ER Model',
        itemKind: 'homework',
        score: 88,
        totalScore: 100,
      },
    });
    count++;

    // 2. 4 天前：老師評語
    await emitFeedbackDrafted({
      actorUid: 'demo_teacher_chang',
      actorName: '張怡君',
      targetUids: [uid],
      courseId: 101,
      courseName: '資料庫管理系統',
      payload: {
        studentName: '顧晉瑋',
        homeworkTitle: 'HW2 ER Model',
        draftPreview: 'ER 圖完整，第三正規化處理得不錯；可在表關聯 cardinality 加強。',
      },
    });
    count++;

    // 3. 2 天前：批量提醒（作業到期）
    await emitBulkReminder({
      actorUid: 'demo_teacher_chang',
      actorName: '張怡君',
      targetUids: [uid],
      courseId: 102,
      courseName: '系統分析與設計',
      payload: {
        homeworkTitle: 'HW3 Use Case Diagram',
        count: 1,
      },
    });
    count++;

    // 4. 12 小時前：系所主任廣播
    await emitDepartmentBroadcast({
      actorUid: 'demo_admin_huang',
      actorName: '黃主任',
      targetUids: [uid],
      courseId: 'department',
      courseName: '系所公告',
      payload: {
        title: '113 學年度系上獎學金申請開放',
        body: '本系設置「優秀學業獎學金」每名 5,000 元，請於 5/31 前繳交申請表至系辦。',
        audience: 'students',
      },
    });
    count++;

    // 5. 30 分鐘前：餐廳訂單已備好
    await emitOrderStatusChanged({
      actorUid: 'demo_cafeteria',
      actorName: '阿英',
      targetUids: [uid],
      courseId: 'merchant_cafe_a',
      courseName: '靜宜中餐部',
      payload: {
        orderId: 'o_cafe_5',
        merchantName: '靜宜中餐部',
        newStatus: 'ready',
        message: '靜宜中餐部 你的餐已準備好，請來取餐 🍱',
      },
    });
    count++;
  }

  // ────────────────────────────────────────────────
  // TEACHER 張怡君的 inbox 種子
  // ────────────────────────────────────────────────
  if (uid === 'demo_teacher_chang') {
    // 1. 3 天前：學生繳交（顧晉瑋的 HW3）
    await emitHomeworkSubmitted({
      actorUid: 'demo_student_kuchih',
      actorName: '顧晉瑋',
      targetUids: [uid],
      courseId: 101,
      courseName: '資料庫管理系統',
      payload: {
        homeworkId: 3,
        homeworkTitle: 'HW3 Normalization Exercise',
        studentName: '顧晉瑋',
        isLate: false,
        submittedAt: new Date(Date.now() - 3 * 24 * 3600_000).toISOString(),
      },
    });
    count++;

    // 2. 1 天前：另一個學生（阿明）繳交
    await emitHomeworkSubmitted({
      actorUid: 'student_aming',
      actorName: '阿明',
      targetUids: [uid],
      courseId: 101,
      courseName: '資料庫管理系統',
      payload: {
        homeworkId: 3,
        homeworkTitle: 'HW3 Normalization Exercise',
        studentName: '阿明',
        isLate: false,
        submittedAt: new Date(Date.now() - 1 * 24 * 3600_000).toISOString(),
      },
    });
    count++;

    // 3. 2 小時前：學生簽到
    await emitAttendanceCheckedIn({
      actorUid: 'demo_student_kuchih',
      actorName: '顧晉瑋',
      targetUids: [uid],
      courseId: 101,
      courseName: '資料庫管理系統',
      payload: {
        sessionId: 'sess_demo',
        method: 'rotating_qr',
        status: 'present',
        studentName: '顧晉瑋',
      },
    });
    count++;
  }

  // ────────────────────────────────────────────────
  // VENDOR 阿英的 inbox 種子
  // ────────────────────────────────────────────────
  if (uid === 'demo_cafeteria') {
    // 多筆新訂單（emit order_placed）
    await emitOrderPlaced({
      actorUid: 'student_aming',
      actorName: '阿明',
      targetUids: [uid],
      courseId: 'merchant_cafe_a',
      courseName: '靜宜中餐部',
      payload: {
        orderId: 'order_seed_1',
        merchantId: 'merchant_cafe_a',
        merchantName: '靜宜中餐部',
        items: '日式炸雞便當 ×1',
        total: 80,
        studentName: '阿明',
      },
    });
    count++;
    await emitOrderPlaced({
      actorUid: 'student_yijun',
      actorName: '怡君',
      targetUids: [uid],
      courseId: 'merchant_cafe_a',
      courseName: '靜宜中餐部',
      payload: {
        orderId: 'order_seed_2',
        merchantId: 'merchant_cafe_a',
        merchantName: '靜宜中餐部',
        items: '雞腿便當 ×3',
        total: 270,
        studentName: '怡君',
      },
    });
    count++;
  }

  // ────────────────────────────────────────────────
  // ADMIN 黃主任的 inbox 種子
  // ────────────────────────────────────────────────
  if (uid === 'demo_admin_huang') {
    // 教師反映 / 教學評鑑相關事件
    await emitDepartmentBroadcast({
      actorUid: 'demo_teacher_chang',
      actorName: '張怡君',
      targetUids: [uid],
      courseId: 101,
      courseName: '資料庫管理系統',
      payload: {
        title: '本班 3 位學生連續缺席',
        body: '建議系所主任協助介入輔導：學生 a, b, c。',
        audience: 'teachers',
      },
    });
    count++;
  }

  // ────────────────────────────────────────────────
  // TA 林助教的 inbox 種子
  // ────────────────────────────────────────────────
  if (uid === 'demo_ta_lin') {
    // 老師指派批改
    await emitBulkReminder({
      actorUid: 'demo_teacher_chang',
      actorName: '張怡君',
      targetUids: [uid],
      courseId: 101,
      courseName: '資料庫管理系統',
      payload: {
        homeworkTitle: 'HW3 Normalization — 請協助批改 12 份',
        count: 12,
      },
    });
    count++;
  }

  // 標記已 seed
  await AsyncStorage.setItem(flagKey, 'true').catch(() => {});

  return { seeded: count };
}

/**
 * 清除種子標記（切角色時用，下次登入會重 seed）
 */
export async function resetSeedFlag(uid: string): Promise<void> {
  const flagKey = getScopedStorageKey(SEED_FLAG_BASE, { uid });
  await AsyncStorage.removeItem(flagKey).catch(() => {});
}
