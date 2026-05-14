'use strict';

const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
  aggregateCompanionEvents,
} = require('../../../packages/shared/dist-cjs/companion/signalAggregator');
const {
  evaluateAchievements,
} = require('../../../packages/shared/dist-cjs/companion/achievements');

/**
 * aggregateCompanionSignals — 每晚 cron，每位使用者跑一次。
 *
 * 1. 讀 users/{uid}/companionEvents（最近 24h）
 * 2. 跑 aggregateCompanionEvents → daily signal + lifetime counters
 * 3. 寫 users/{uid}/companionSignals/{date}
 * 4. 累加 users/{uid}/companionLifetime（累積計數，給 achievements 用）
 * 5. 跑 evaluateAchievements → 寫新解鎖到 users/{uid}/companion/unlocks
 * 6. 已處理的 events 標記 processed=true（避免重跑）
 */

async function aggregateForUser(uid) {
  const db = getFirestore();
  const userRef = db.collection('users').doc(uid);
  const eventsRef = userRef.collection('companionEvents');
  const sinceMs = Date.now() - 36 * 60 * 60 * 1000; // 36h 緩衝

  const eventsSnap = await eventsRef
    .where('processed', '!=', true)
    .get()
    .catch(async () => {
      // 若 index 不存在，fallback to 全部
      return eventsRef.get();
    });

  const events = [];
  const eventDocs = [];
  for (const docSnap of eventsSnap.docs) {
    const data = docSnap.data();
    const atIso = String(data.at ?? '');
    const atMs = atIso ? Date.parse(atIso) : 0;
    if (atMs && atMs < sinceMs) continue;
    events.push({
      eventId: docSnap.id,
      kind: data.kind,
      at: atIso,
      payload: data.payload ?? {},
    });
    eventDocs.push(docSnap.ref);
  }

  if (events.length === 0) return { processed: 0, unlocked: 0 };

  const aggregate = aggregateCompanionEvents(events);

  // 寫 daily signals
  const dailyWrites = aggregate.days.map((day) =>
    userRef
      .collection('companionSignals')
      .doc(day.date)
      .set(
        {
          ...day,
          dateMs: Date.parse(`${day.date}T00:00:00Z`),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
  );
  await Promise.all(dailyWrites);

  // 累加 lifetime counters
  const lifetimeRef = userRef.collection('companion').doc('lifetime');
  const lifetimeSnap = await lifetimeRef.get();
  const currentLifetime = lifetimeSnap.exists ? lifetimeSnap.data() : {};
  const mergedLifetime = { ...(currentLifetime || {}) };
  for (const [k, v] of Object.entries(aggregate.lifetimeCounters)) {
    mergedLifetime[k] = (Number(currentLifetime?.[k]) || 0) + v;
  }
  await lifetimeRef.set(
    { ...mergedLifetime, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  // 評估成就
  const unlocksRef = userRef.collection('companion').doc('unlocks');
  const unlocksSnap = await unlocksRef.get();
  const unlocked = new Set(
    Array.isArray(unlocksSnap.data()?.ids) ? unlocksSnap.data().ids : [],
  );
  const evalResult = evaluateAchievements({
    progress: mergedLifetime,
    alreadyUnlocked: unlocked,
  });

  if (evalResult.newlyUnlocked.length > 0) {
    const newIds = evalResult.newlyUnlocked.map((u) => u.id);
    await unlocksRef.set(
      {
        ids: Array.from(new Set([...Array.from(unlocked), ...newIds])),
        latest: evalResult.newlyUnlocked,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    // 寫到 inbox 作為通知卡片（精靈用關心語氣）
    const inboxBatch = db.batch();
    for (const u of evalResult.newlyUnlocked) {
      const inboxRef = userRef.collection('inbox').doc(`achievement_${u.id}`);
      inboxBatch.set(inboxRef, {
        kind: 'achievement_unlock',
        title: `精靈說：解鎖了 ${u.label} ${u.emoji}`,
        subtitle: u.description,
        priority: 2,
        actionTarget: 'companion',
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await inboxBatch.commit();
  }

  // 標記 events 已處理
  const batch = db.batch();
  for (const docRef of eventDocs) {
    batch.set(docRef, { processed: true, processedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  await batch.commit();

  return { processed: events.length, unlocked: evalResult.newlyUnlocked.length };
}

/**
 * 入口 1：給 onSchedule cron 用
 */
async function runNightlyAggregation() {
  const db = getFirestore();
  // 活躍使用者：最近 24h 內有 companionEvents 的
  const recentMs = Date.now() - 24 * 60 * 60 * 1000;
  const activeUidsSet = new Set();
  const groupSnap = await db
    .collectionGroup('companionEvents')
    .where('createdAt', '>=', new Date(recentMs))
    .select('kind')
    .limit(2000)
    .get()
    .catch(() => ({ docs: [] }));
  for (const docSnap of groupSnap.docs ?? []) {
    const parent = docSnap.ref.parent.parent; // users/{uid}
    if (parent) activeUidsSet.add(parent.id);
  }

  const results = [];
  for (const uid of activeUidsSet) {
    try {
      const r = await aggregateForUser(uid);
      results.push({ uid, ...r });
    } catch (e) {
      results.push({ uid, error: String(e?.message || e) });
    }
  }
  return { users: activeUidsSet.size, results };
}

module.exports = {
  aggregateForUser,
  runNightlyAggregation,
};
