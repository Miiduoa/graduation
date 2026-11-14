// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
const suite = /^(127\.0\.0\.1|localhost):\d+$/.test(host) ? describe : describe.skip;
suite('approval-only rules fragment (production rules remain untouched)', () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => {
    const root = resolve(process.cwd(), '../..');
    const base = readFileSync(resolve(root, 'backend/firestore/firestore.rules'), 'utf8');
    const fragment = readFileSync(
      resolve(root, 'docs/approval/career-internship/firestore.rules.fragment'),
      'utf8',
    );
    const marker = '      match /serviceRoles/{uid} {';
    expect(base.split(marker)).toHaveLength(2);
    const [hostname, port] = host.split(':');
    env = await initializeTestEnvironment({
      projectId: 'demo-internship-rules',
      firestore: {
        host: hostname,
        port: Number(port),
        rules: base.replace(marker, fragment + '\n' + marker),
      },
    });
  });
  afterAll(async () => {
    await env?.cleanup();
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const uid of ['student', 'other', 'teacher', 'staff', 'admin', 'dept', 'wrongDept'])
        await setDoc(doc(db, `schools/pu/members/${uid}`), {
          status: 'active',
          role: uid === 'admin' ? 'admin' : uid === 'teacher' ? 'teacher' : 'member',
        });
      await setDoc(doc(db, 'schools/pu/serviceRoles/staff'), {
        status: 'active',
        career_staff: true,
      });
      await setDoc(doc(db, 'schools/pu/serviceRoles/dept'), {
        status: 'active',
        internship_departments: ['測試系'],
      });
      await setDoc(doc(db, 'schools/pu/serviceRoles/wrongDept'), {
        status: 'active',
        internship_departments: ['其他系'],
      });
      await setDoc(doc(db, 'schools/pu/internshipRecords/record'), {
        uid: 'student',
        teacherUid: 'teacher',
        rule: { department: '測試系' },
      });
    });
  });
  it('allows own and assigned-teacher queries, isolates department readers and blocks client writes', async () => {
    for (const uid of ['student', 'teacher', 'staff', 'admin', 'dept']) {
      const db = env.authenticatedContext(uid).firestore();
      await assertSucceeds(getDoc(doc(db, 'schools/pu/internshipRecords/record')));
      await assertFails(setDoc(doc(db, 'schools/pu/internshipRecords/record'), { uid }));
      await assertFails(setDoc(doc(db, 'schools/pu/internshipRules/rule'), { credits: 1 }));
    }
    const db = env.authenticatedContext('student').firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'schools/pu/internshipRecords'), where('uid', '==', 'student'))),
    );
    await assertFails(getDocs(collection(db, 'schools/pu/internshipRecords')));
    for (const uid of ['other', 'wrongDept'])
      await assertFails(
        getDoc(
          doc(env.authenticatedContext(uid).firestore(), 'schools/pu/internshipRecords/record'),
        ),
      );
    await assertFails(
      getDoc(doc(env.unauthenticatedContext().firestore(), 'schools/pu/internshipRecords/record')),
    );
    await assertFails(
      getDoc(
        doc(
          env.authenticatedContext('staff').firestore(),
          'schools/other/internshipRecords/record',
        ),
      ),
    );
  });
  it('revokes assigned reads and queries after teacher demotion while keeping own reads', async () => {
    const db = env.authenticatedContext('teacher').firestore();
    const assigned = () =>
      getDocs(
        query(collection(db, 'schools/pu/internshipRecords'), where('teacherUid', '==', 'teacher')),
      );
    await assertSucceeds(assigned());
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'schools/pu/members/teacher'), {
        status: 'active',
        role: 'member',
      });
      await setDoc(doc(c.firestore(), 'schools/pu/internshipRecords/own'), {
        uid: 'teacher',
        teacherUid: 'other',
        rule: { department: '測試系' },
      });
    });
    await assertFails(getDoc(doc(db, 'schools/pu/internshipRecords/record')));
    await assertFails(assigned());
    await assertSucceeds(getDoc(doc(db, 'schools/pu/internshipRecords/own')));
    await assertSucceeds(
      getDocs(query(collection(db, 'schools/pu/internshipRecords'), where('uid', '==', 'teacher'))),
    );
  });
  it('revokes access when department assignment or membership is removed', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'schools/pu/serviceRoles/dept'), {
        status: 'inactive',
        internship_departments: ['測試系'],
      });
      await setDoc(doc(c.firestore(), 'schools/pu/members/teacher'), { status: 'inactive' });
    });
    for (const uid of ['dept', 'teacher'])
      await assertFails(
        getDoc(
          doc(env.authenticatedContext(uid).firestore(), 'schools/pu/internshipRecords/record'),
        ),
      );
  });
});
