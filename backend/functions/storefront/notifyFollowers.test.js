'use strict';

const { createCafeteriaStorefrontPostHandler } = require('./notifyFollowers');

test('new storefront posts notify followers and skip drafts', async () => {
  const sent = [];
  const db = {
    collection: () => ({
      doc: () => ({
        collection: (name) => ({
          doc: () => ({
            get: async () => ({ exists: true, data: () => ({ name: '校園咖啡' }) }),
            collection: () => ({
              get: async () => ({
                docs: name === 'ignored' ? [] : [{ id: 'student-a' }, { id: 'student-b' }],
              }),
            }),
          }),
        }),
      }),
    }),
  };
  const handler = createCafeteriaStorefrontPostHandler({
    db,
    sendPushToUser: async (uid, notification, data) => {
      sent.push({ uid, notification, data });
    },
  });
  await handler({
    params: { schoolId: 'pu', cafeteriaId: 'cafe', postId: 'p1' },
    data: { data: () => ({ title: '週四折抵', kind: 'promo' }) },
  });
  expect(sent).toHaveLength(2);
  expect(sent[0].notification.title).toBe('週四折抵');
  expect(sent[0].data.channel).toBe('announcements');
  sent.length = 0;
  await handler({
    params: { schoolId: 'pu', cafeteriaId: 'cafe', postId: 'draft' },
    data: { data: () => ({ title: '還沒發', kind: 'draft' }) },
  });
  expect(sent).toEqual([]);
});
