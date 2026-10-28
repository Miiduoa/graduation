const {
  publicCampusDataResult,
  persistOwnedMypuCookies,
  linkOwnedTronClassSession,
  deleteOwnedPuSessions,
} = require('./puSessionStore');

function memoryDb(seed = {}, extra = {}) {
  const byCollection = {
    _puSessions: new Map(Object.entries(seed).map(([id, data]) => [id, { ...data }])),
    _puTronClassSessions: new Map(
      Object.entries(extra._puTronClassSessions || {}).map(([id, data]) => [id, { ...data }]),
    ),
  };
  function ref(collectionName, id) {
    const docs = byCollection[collectionName];
    return {
      id,
      path: `${collectionName}/${id}`,
      get: async () => ({
        exists: docs.has(id),
        data: () => docs.get(id),
      }),
      set: async (data, options) => {
        const current = docs.get(id);
        docs.set(id, options?.merge ? { ...(current || {}), ...data } : { ...data });
      },
      delete: async () => {
        docs.delete(id);
      },
    };
  }
  return {
    docs: byCollection._puSessions,
    tronDocs: byCollection._puTronClassSessions,
    collection: (name) => {
      expect(['_puSessions', '_puTronClassSessions']).toContain(name);
      const docs = byCollection[name];
      const filters = [];
      let maximum = Infinity;
      const query = {
        doc: (id) => ref(name, id),
        where: (field, op, value) => {
          filters.push({ field, op, value });
          return query;
        },
        limit: (count) => {
          maximum = count;
          return query;
        },
        get: async () => {
          const rows = [...docs.entries()]
            .filter(([, data]) =>
              filters.every(({ field, op, value }) =>
                op === '==' ? data[field] === value : false,
              ),
            )
            .slice(0, maximum)
            .map(([id, data]) => ({
              id,
              data: () => data,
              ref: ref(name, id),
            }));
          return { docs: rows, empty: rows.length === 0 };
        },
      };
      return query;
    },
    runTransaction: async (fn) => {
      const writes = [];
      const result = await fn({
        get: async (sessionRef) => sessionRef.get(),
        set: (sessionRef, data, options) => writes.push({ sessionRef, data, options }),
      });
      for (const write of writes) {
        await write.sessionRef.set(write.data, write.options);
      }
      return result;
    },
  };
}

describe('publicCampusDataResult', () => {
  test.each(['courses', 'grades', 'announcements', 'studentInfo'])(
    'never returns cookies or mypuCookies for %s',
    (kind) => {
      const result = publicCampusDataResult(kind, {
        success: true,
        cookies: { SID: 'secret' },
        mypuCookies: { PHPSESSID: 'mypu-secret' },
        error: 'internal html',
        courses: [{ code: 'CS1' }],
        grades: [{ score: 88 }],
        announcements: ['note'],
        studentInfo: { name: '陳同學' },
      });
      expect(result.success).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/secret|mypu-secret|SID|PHPSESSID|internal html|cookies/);
    },
  );

  test('keeps only the grade fields the page needs', () => {
    expect(
      publicCampusDataResult('grades', {
        grades: [{ score: 90 }],
        summary: { average: 90 },
        allSemesters: ['1151'],
        creditSummary: { totalEarned: 3 },
        coverage: 'all',
        cookies: { SID: 'nope' },
      }),
    ).toEqual({
      success: true,
      grades: [{ score: 90 }],
      summary: { average: 90 },
      allSemesters: ['1151'],
      creditSummary: { totalEarned: 3 },
      coverage: 'all',
    });
  });
});

describe('persistOwnedMypuCookies', () => {
  const cookies = { PHPSESSID: 'mypu-live' };

  test('writes mypu cookies only when the document exists and owner matches', async () => {
    const db = memoryDb({
      own: { ownerUid: 'alice', cookies: { SID: 'alcat' } },
    });
    await expect(
      persistOwnedMypuCookies(db, db.collection('_puSessions').doc('own'), 'alice', cookies),
    ).resolves.toBe(true);
    expect(db.docs.get('own')).toMatchObject({
      ownerUid: 'alice',
      cookies: { SID: 'alcat' },
      mypuCookies: cookies,
    });
  });

  test('does not recreate a missing session after account deletion', async () => {
    const db = memoryDb();
    await expect(
      persistOwnedMypuCookies(db, db.collection('_puSessions').doc('gone'), 'alice', cookies),
    ).resolves.toBe(false);
    expect(db.docs.has('gone')).toBe(false);
  });

  test('does not write when ownerUid belongs to another account', async () => {
    const db = memoryDb({
      other: { ownerUid: 'bob', cookies: { SID: 'private' } },
    });
    await expect(
      persistOwnedMypuCookies(db, db.collection('_puSessions').doc('other'), 'alice', cookies),
    ).resolves.toBe(false);
    expect(db.docs.get('other').mypuCookies).toBeUndefined();
  });
});

describe('linkOwnedTronClassSession', () => {
  const tronData = { ownerUid: 'alice', cookies: { session: 'tc' } };

  test('writes TronClass session and portal merge only when portal exists and owner matches', async () => {
    const db = memoryDb({
      own: { ownerUid: 'alice', cookies: { SID: 'alcat' } },
    });
    const portal = db.collection('_puSessions').doc('own');
    const tron = db.collection('_puTronClassSessions').doc('tc1');
    await expect(
      linkOwnedTronClassSession(db, portal, 'alice', tron, tronData, { tronClassSessionId: 'tc1' }),
    ).resolves.toBe(true);
    expect(db.tronDocs.get('tc1')).toMatchObject(tronData);
    expect(db.docs.get('own')).toMatchObject({
      ownerUid: 'alice',
      tronClassSessionId: 'tc1',
    });
  });

  test('does not create a TronClass session when the portal document is gone', async () => {
    const db = memoryDb();
    const portal = db.collection('_puSessions').doc('gone');
    const tron = db.collection('_puTronClassSessions').doc('tc1');
    await expect(
      linkOwnedTronClassSession(db, portal, 'alice', tron, tronData, { tronClassSessionId: 'tc1' }),
    ).resolves.toBe(false);
    expect(db.tronDocs.has('tc1')).toBe(false);
    expect(db.docs.has('gone')).toBe(false);
  });

  test('does not create a TronClass session when ownerUid belongs to another account', async () => {
    const db = memoryDb({
      other: { ownerUid: 'bob', cookies: { SID: 'private' } },
    });
    const portal = db.collection('_puSessions').doc('other');
    const tron = db.collection('_puTronClassSessions').doc('tc1');
    await expect(
      linkOwnedTronClassSession(db, portal, 'alice', tron, tronData, { tronClassSessionId: 'tc1' }),
    ).resolves.toBe(false);
    expect(db.tronDocs.has('tc1')).toBe(false);
    expect(db.docs.get('other').tronClassSessionId).toBeUndefined();
  });
});

describe('deleteOwnedPuSessions', () => {
  test('deletes portal and TronClass sessions owned by the caller', async () => {
    const db = memoryDb(
      {
        a: { ownerUid: 'alice', cookies: { SID: 'one' }, mypuCookies: { PHPSESSID: 'mypu' } },
        b: { ownerUid: 'alice', cookies: { SID: 'two' } },
        c: { ownerUid: 'bob', cookies: { SID: 'keep' }, mypuCookies: { PHPSESSID: 'other' } },
      },
      {
        _puTronClassSessions: {
          t1: { ownerUid: 'alice', cookies: { session: 'tc-alice' } },
          t2: { ownerUid: 'bob', cookies: { session: 'tc-bob' } },
        },
      },
    );
    await expect(deleteOwnedPuSessions(db, 'alice')).resolves.toBe(3);
    expect([...db.docs.keys()]).toEqual(['c']);
    expect([...db.tronDocs.keys()]).toEqual(['t2']);
    expect(db.docs.get('c')).toMatchObject({
      ownerUid: 'bob',
      cookies: { SID: 'keep' },
      mypuCookies: { PHPSESSID: 'other' },
    });
    expect(db.tronDocs.get('t2')).toMatchObject({
      ownerUid: 'bob',
      cookies: { session: 'tc-bob' },
    });
  });
});
