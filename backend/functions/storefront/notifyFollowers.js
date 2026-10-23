'use strict';

function createCafeteriaStorefrontPostHandler({ db, sendPushToUser, log = console }) {
  return async function onCafeteriaStorefrontPostCreated(event) {
    const { schoolId, cafeteriaId, postId } = event.params || {};
    const post = event.data?.data?.() || event.data?.data();
    if (!post || post.kind === 'draft') return;
    const cafeteriaSnap = await db
      .collection('schools')
      .doc(schoolId)
      .collection('cafeterias')
      .doc(cafeteriaId)
      .get();
    const cafeteriaName = cafeteriaSnap.exists ? cafeteriaSnap.data().name || '店家' : '店家';
    const followers = await db
      .collection('schools')
      .doc(schoolId)
      .collection('cafeterias')
      .doc(cafeteriaId)
      .collection('followers')
      .get();
    const title = typeof post.title === 'string' && post.title.trim() ? post.title.trim() : '店家有新貼文';
    const body = `${cafeteriaName} 發了一則新消息。`;
    for (const doc of followers.docs || []) {
      try {
        await sendPushToUser(
          doc.id,
          { title, body },
          {
            type: 'storefront_post',
            schoolId,
            cafeteriaId,
            postId,
            channel: 'announcements',
          },
          'announcements',
        );
      } catch (error) {
        log.error('storefront follower notify failed', error);
      }
    }
  };
}

module.exports = { createCafeteriaStorefrontPostHandler };
