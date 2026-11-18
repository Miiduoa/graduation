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
      resolve(root, 'docs/approval/career-workstudy/firestore.rules.fragment'),
      'utf8',
    );
    const marker = '      match /serviceRoles/{uid} {';
    expect(base.split(marker)).toHaveLength(2);
    const [hostname, port] = host.split(':');
    env = await initializeTestEnvironment({
      projectId: 'demo-career-rules',
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
      for (const uid of ['student', 'other', 'staff', 'admin'])
        await setDoc(doc(db, `schools/pu/members/${uid}`), {
          status: 'active',
          role: uid === 'admin' ? 'admin' : 'member',
        });
      await setDoc(doc(db, 'schools/pu/serviceRoles/staff'), {
        status: 'active',
        career_staff: true,
      });
      await setDoc(doc(db, 'schools/pu/careerOpportunities/public'), { published: true });
      await setDoc(doc(db, 'schools/pu/careerOpportunities/draft'), { published: false });
      await setDoc(doc(db, 'schools/pu/careerApplications/application'), { uid: 'student' });
    });
  });
  it('allows public queries but not unpublished reads for visitors', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertSucceeds(
      getDocs(
        query(collection(db, 'schools/pu/careerOpportunities'), where('published', '==', true)),
      ),
    );
    await assertFails(getDoc(doc(db, 'schools/pu/careerOpportunities/draft')));
    await assertFails(getDoc(doc(db, 'schools/pu/careerApplications/application')));
  });
  it('allows students only their own applications and constrained list', async () => {
    const db = env.authenticatedContext('student').firestore();
    await assertSucceeds(
      getDocs(
        query(collection(db, 'schools/pu/careerApplications'), where('uid', '==', 'student')),
      ),
    );
    await assertFails(getDocs(collection(db, 'schools/pu/careerApplications')));
    await assertFails(
      getDoc(
        doc(
          env.authenticatedContext('other').firestore(),
          'schools/pu/careerApplications/application',
        ),
      ),
    );
  });
  it('permits assigned staff and school admins; generic member is not career staff', async () => {
    for (const uid of ['staff', 'admin'])
      await assertSucceeds(
        getDocs(
          collection(env.authenticatedContext(uid).firestore(), 'schools/pu/careerApplications'),
        ),
      );
    await assertFails(
      getDocs(
        collection(env.authenticatedContext('other').firestore(), 'schools/pu/careerApplications'),
      ),
    );
    await assertFails(
      getDocs(
        collection(
          env.authenticatedContext('staff').firestore(),
          'schools/other/careerApplications',
        ),
      ),
    );
  });
  it('blocks revoked staff and all client writes, including administrators', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'schools/pu/serviceRoles/staff'), {
        status: 'inactive',
        career_staff: true,
      });
    });
    await assertFails(
      getDoc(
        doc(
          env.authenticatedContext('staff').firestore(),
          'schools/pu/careerApplications/application',
        ),
      ),
    );
    for (const uid of ['student', 'staff', 'admin']) {
      const db = env.authenticatedContext(uid).firestore();
      await assertFails(setDoc(doc(db, 'schools/pu/careerApplications/forged'), { uid }));
      await assertFails(
        setDoc(doc(db, 'schools/pu/careerOpportunities/forged'), { published: true }),
      );
    }
  });
});
