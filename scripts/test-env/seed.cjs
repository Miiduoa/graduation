// 在模擬器裡建立測試帳號。只會連 demo- 專案的模擬器。
'use strict';

const projectId = process.env.TEST_PROJECT_ID || 'demo-campus-one';
if (!projectId.startsWith('demo-')) {
  console.error('只能對 demo- 專案的模擬器建立測試資料');
  process.exit(1);
}
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('沒有設定模擬器位址，請用 pnpm test-env:start 或先 source scripts/test-env/env.sh');
  process.exit(1);
}

const admin = require('firebase-admin');

admin.initializeApp({ projectId });
const db = admin.firestore();
const auth = admin.auth();

const PASSWORD = 'campus-test-1234'; // gitleaks:allow 只在本機模擬器用的公開測試密碼
const SCHOOL_ID = 'pu';
const users = [
  { uid: 'test-student-a', login: 'S0000001', name: '測試學生甲', username: 'test_a', role: 'student' },
  { uid: 'test-student-b', login: 'S0000002', name: '測試學生乙', username: 'test_b', role: 'student' },
  { uid: 'test-student-c', login: 'S0000003', name: '測試學生丙', username: 'test_c', role: 'student' },
  { uid: 'test-teacher', login: 'T0000001', name: '測試老師', username: 'test_teacher', role: 'teacher' },
  { uid: 'test-merchant', login: 'M0000001', name: '測試店家', username: 'test_shop', role: 'vendor' },
];

async function main() {
  await db.doc(`schools/${SCHOOL_ID}`).set({ name: '靜宜大學', code: SCHOOL_ID, shortName: '靜宜' }, { merge: true });
  for (const user of users) {
    const email = `${user.login.toLowerCase()}@test.campus-one.local`;
    try {
      await auth.getUser(user.uid);
      await auth.updateUser(user.uid, { email, password: PASSWORD, displayName: user.name });
    } catch {
      await auth.createUser({ uid: user.uid, email, password: PASSWORD, displayName: user.name });
    }
    await db.doc(`users/${user.uid}`).set(
      {
        displayName: user.name,
        username: user.username,
        email,
        role: user.role,
        schoolId: SCHOOL_ID,
        primarySchoolId: SCHOOL_ID,
      },
      { merge: true },
    );
    await db
      .doc(`schools/${SCHOOL_ID}/members/${user.uid}`)
      .set({ status: 'active', role: user.role, displayName: user.name }, { merge: true });
  }
  // T0000001 教「資料庫」：老師工作台只看得到這門課的申訴（「英文」沒有對應老師）
  await db
    .doc(`schools/${SCHOOL_ID}/courseTeachers/資料庫`)
    .set({ courseName: '資料庫', teacherUids: ['test-teacher'] }, { merge: true });
  console.log('測試帳號（密碼都是 %s）：', PASSWORD);
  for (const user of users) console.log(`  ${user.login}  ${user.name}（${user.role}）`);
  console.log('課程對應：T0000001 教「資料庫」');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
