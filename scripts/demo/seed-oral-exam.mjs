#!/usr/bin/env node
/**
 * 口試示範租戶種子。預設 --dry-run，只印出將寫入的路徑。
 *
 *   node scripts/demo/seed-oral-exam.mjs
 *   node scripts/demo/seed-oral-exam.mjs --dry-run
 *   ORAL_EXAM_SEED_CONFIRM=nuni-oral-exam node scripts/demo/seed-oral-exam.mjs --apply
 *   ORAL_EXAM_SEED_CONFIRM=nuni-oral-exam node scripts/demo/seed-oral-exam.mjs --remove
 *
 * 只處理 demo:true 且 oralExamTag=2026-11-12、tenantId=nuni-oral-exam 的文件。
 * 不建立 Auth 帳號、不含密碼、不開啟學號登入或線上點餐。
 * 請勿在未確認的情況下對正式專案執行 --apply。
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const TENANT_ID = 'nuni-oral-exam';
const TAG = '2026-11-12';
const CONFIRM = 'nuni-oral-exam';

function parseArgs(argv) {
  const flags = new Set(argv.filter((item) => item.startsWith('--')));
  const apply = flags.has('--apply');
  const remove = flags.has('--remove');
  if (apply && remove) {
    throw new Error('不能同時使用 --apply 與 --remove');
  }
  return {
    apply,
    remove,
    dryRun: !apply && !remove,
  };
}

function stamp(extra = {}) {
  return {
    demo: true,
    oralExamTag: TAG,
    tenantId: TENANT_ID,
    schoolId: TENANT_ID,
    ...extra,
  };
}

function buildDocumentsFromSource() {
  return [
    {
      path: `schools/${TENANT_ID}`,
      data: stamp({
        id: TENANT_ID,
        name: '示範大學（口試專用）',
        shortName: '示範大學',
        directoryVisible: false,
        placeholder: true,
      }),
    },
    {
      path: `schools/${TENANT_ID}/announcements/oral-exam-ann-1`,
      data: stamp({
        id: 'oral-exam-ann-1',
        title: '【教務處】期中考週教室異動與補考申請',
      }),
    },
    {
      path: `schools/${TENANT_ID}/announcements/oral-exam-ann-2`,
      data: stamp({
        id: 'oral-exam-ann-2',
        title: '【資管系】專題期中發表時程',
      }),
    },
    {
      path: `schools/${TENANT_ID}/events/oral-exam-cal-midterm`,
      data: stamp({ id: 'oral-exam-cal-midterm', title: '114-1 期中考週' }),
    },
    {
      path: `schools/${TENANT_ID}/events/oral-exam-cal-clubfair`,
      data: stamp({ id: 'oral-exam-cal-clubfair', title: '社團博覽會' }),
    },
    {
      path: `schools/${TENANT_ID}/events/oral-exam-cal-network`,
      data: stamp({ id: 'oral-exam-cal-network', title: '校園網路維護' }),
    },
    {
      path: 'cafeterias/oral-exam-cafe-1',
      data: stamp({
        id: 'oral-exam-cafe-1',
        name: '示範中餐部',
        merchantMode: 'info_only',
        orderingEnabled: false,
      }),
    },
    {
      path: 'cafeteriaMenus/oral-exam-menu-curry',
      data: stamp({ id: 'oral-exam-menu-curry', name: '咖哩雞腿飯', cafeteriaId: 'oral-exam-cafe-1' }),
    },
    {
      path: 'cafeteriaMenus/oral-exam-menu-veg',
      data: stamp({ id: 'oral-exam-menu-veg', name: '什錦蔬菜飯', cafeteriaId: 'oral-exam-cafe-1' }),
    },
    {
      path: 'cafeteriaMenus/oral-exam-menu-tea',
      data: stamp({ id: 'oral-exam-menu-tea', name: '無糖紅茶', cafeteriaId: 'oral-exam-cafe-1' }),
    },
    {
      path: 'demoOrders/oral-exam-order-1',
      data: stamp({ id: 'oral-exam-order-1', status: '備餐中' }),
    },
    {
      path: 'demoOrders/oral-exam-order-2',
      data: stamp({ id: 'oral-exam-order-2', status: '可取餐' }),
    },
    {
      path: 'lostFoundItems/oral-exam-lf-1',
      data: stamp({ id: 'oral-exam-lf-1', title: '黑色無線耳機盒' }),
    },
    {
      path: 'lostFoundItems/oral-exam-lf-2',
      data: stamp({ id: 'oral-exam-lf-2', title: '資管系識別證套' }),
    },
    {
      path: 'groups/oral-exam-club-coding',
      data: stamp({ id: 'oral-exam-club-coding', name: '程式設計社', type: 'club' }),
    },
    {
      path: `schools/${TENANT_ID}/courses/oral-exam-course-ds`,
      data: stamp({ id: 'oral-exam-course-ds', name: '資料結構' }),
    },
    {
      path: `schools/${TENANT_ID}/courses/oral-exam-course-db`,
      data: stamp({ id: 'oral-exam-course-db', name: '資料庫系統' }),
    },
    {
      path: `schools/${TENANT_ID}/courses/oral-exam-course-os`,
      data: stamp({ id: 'oral-exam-course-os', name: '作業系統' }),
    },
    {
      path: `schools/${TENANT_ID}/assignments/oral-exam-hw-list`,
      data: stamp({ id: 'oral-exam-hw-list', title: '作業三：鏈結串列反轉' }),
    },
    {
      path: `schools/${TENANT_ID}/assignments/oral-exam-hw-er`,
      data: stamp({ id: 'oral-exam-hw-er', title: '作業二：ER 圖與正規化' }),
    },
    {
      path: `schools/${TENANT_ID}/attendance/2026-11-12-第-1–2-節點名`,
      data: stamp({ sessionTitle: '2026-11-12 第 1–2 節點名' }),
    },
    {
      path: `schools/${TENANT_ID}/leaveRequests/oral-exam-leave-1`,
      data: stamp({ id: 'oral-exam-leave-1', studentName: '示範學生王小明' }),
    },
    {
      path: `schools/${TENANT_ID}/demoDirectory/oral-exam-student-wang`,
      data: stamp({ uid: 'oral-exam-student-wang', displayName: '示範學生王小明' }),
    },
    {
      path: `schools/${TENANT_ID}/demoDirectory/oral-exam-teacher-lin`,
      data: stamp({ uid: 'oral-exam-teacher-lin', displayName: '示範教師林佳蓉' }),
    },
    {
      path: `schools/${TENANT_ID}/demoDirectory/oral-exam-school-admin-chen`,
      data: stamp({ uid: 'oral-exam-school-admin-chen', displayName: '示範校務陳志明' }),
    },
    {
      path: `schools/${TENANT_ID}/demoDirectory/oral-exam-merchant-huang`,
      data: stamp({ uid: 'oral-exam-merchant-huang', displayName: '示範店長黃阿英' }),
    },
    {
      path: `schools/${TENANT_ID}/demoDirectory/oral-exam-ops-wu`,
      data: stamp({ uid: 'oral-exam-ops-wu', displayName: '示範營運吳平台' }),
    },
  ];
}

export function listSeedDocuments() {
  return buildDocumentsFromSource();
}

function printPlan(documents, mode) {
  console.log(`口試示範種子（${mode}）`);
  console.log(`租戶 ${TENANT_ID}　標籤 ${TAG}　共 ${documents.length} 筆`);
  console.log('正式線上點餐、學號登入、校務連線都不會被這支腳本打開。');
  console.log('Supabase：不寫入。課業示範走 client-side 工作區。');
  console.log('');
  for (const doc of documents) {
    const tagged = doc.data.demo === true && doc.data.oralExamTag === TAG;
    if (!tagged) throw new Error(`未標記的文件：${doc.path}`);
    console.log(`${mode === 'remove' ? 'DELETE' : 'SET '} ${doc.path}`);
  }
}

function assertConfirm(mode) {
  if (process.env.ORAL_EXAM_SEED_CONFIRM !== CONFIRM) {
    throw new Error(
      `${mode} 需要環境變數 ORAL_EXAM_SEED_CONFIRM=${CONFIRM}。未設定時只允許 --dry-run。`,
    );
  }
}

async function withFirestore(run) {
  const { initializeApp, getApps, cert } = await import('firebase-admin/app').catch(() => {
    throw new Error('找不到 firebase-admin。dry-run 不需要它；--apply / --remove 請在已安裝後端依賴的環境執行。');
  });
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-campus' });
    } else if (keyPath) {
      initializeApp({ credential: cert(require(keyPath)) });
    } else {
      initializeApp();
    }
  }
  return run(getFirestore());
}

function isOralExamDocument(data) {
  return (
    data &&
    data.demo === true &&
    data.oralExamTag === TAG &&
    data.tenantId === TENANT_ID
  );
}

async function applyDocuments(documents) {
  assertConfirm('apply');
  await withFirestore(async (db) => {
    for (const doc of documents) {
      if (!isOralExamDocument(doc.data)) {
        throw new Error(`拒絕寫入未標記文件：${doc.path}`);
      }
      await db.doc(doc.path).set(doc.data, { merge: true });
    }
  });
  console.log(`已寫入 ${documents.length} 筆示範文件。`);
}

async function removeDocuments(documents) {
  assertConfirm('remove');
  await withFirestore(async (db) => {
    let deleted = 0;
    for (const doc of documents) {
      const snap = await db.doc(doc.path).get();
      if (!snap.exists) continue;
      const data = snap.data();
      if (!isOralExamDocument(data)) {
        console.log(`略過（不是口試示範文件）：${doc.path}`);
        continue;
      }
      await db.doc(doc.path).delete();
      deleted += 1;
    }
    console.log(`已刪除 ${deleted} 筆示範文件。`);
  });
}

export async function runOralExamSeed(argv = process.argv.slice(2)) {
  const mode = parseArgs(argv);
  const documents = listSeedDocuments();
  if (mode.dryRun) {
    printPlan(documents, 'dry-run');
    return { mode: 'dry-run', documents };
  }
  if (mode.remove) {
    printPlan(documents, 'remove');
    await removeDocuments(documents);
    return { mode: 'remove', documents };
  }
  printPlan(documents, 'apply');
  await applyDocuments(documents);
  return { mode: 'apply', documents };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  runOralExamSeed().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
