import { createRequire } from 'node:module';
import { URL } from 'node:url';
import console from 'node:console';
import { emulatorEnvironment } from './emulator-env.mjs';

const { project } = emulatorEnvironment();
const require = createRequire(new URL('../../backend/functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: project });
const db = getFirestore();
const now = new Date();
await db.doc('schools/pu/announcements/maestro-course-selection').set({
  schoolId: 'pu', title: 'Maestro 選課測試公告', body: '本機模擬器選課公告內容。',
  publishedAt: now.toISOString(), category: 'academic', visible: true,
  studentFeed: true, pinned: false, source: '教務處',
});
await db.doc('schools/pu/clubEvents/maestro-campus-event').set({
  schoolId: 'pu', title: 'Maestro 校園測試活動', description: '本機模擬器活動內容。',
  startsAt: new Date(now.getTime() + 86400000).toISOString(),
  endsAt: new Date(now.getTime() + 90000000).toISOString(),
  location: '測試教室', organizer: '測試主辦單位',
});
console.log('Seeded isolated Maestro announcement and event fixtures.');
