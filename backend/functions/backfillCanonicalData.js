const { getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();
const dryRun = process.argv.includes("--dry-run");
const limitArgIndex = process.argv.indexOf("--limit");
const docLimit = limitArgIndex >= 0 ? Number(process.argv[limitArgIndex + 1] || 0) : 0;

const counters = {
  written: 0,
  skipped: 0,
  missingSchool: 0,
  missingGroup: 0,
  errors: 0,
};

const assignmentGroupCache = new Map();
const postGroupCache = new Map();
const userSchoolCache = new Map();

function withLimit(ref) {
  return docLimit > 0 ? ref.limit(docLimit) : ref;
}

async function resolveUserSchoolId(uid, userData = null) {
  if (userSchoolCache.has(uid)) {
    return userSchoolCache.get(uid);
  }

  let data = userData;
  if (!data) {
    const userDoc = await db.collection("users").doc(uid).get();
    data = userDoc.exists ? userDoc.data() : null;
  }

  const schoolId = data?.primarySchoolId || data?.schoolId || null;
  userSchoolCache.set(uid, schoolId);
  return schoolId;
}

function getUserSchoolDoc(uid, schoolId, collectionName, docId) {
  return db.collection("users").doc(uid).collection("schools").doc(schoolId).collection(collectionName).doc(docId);
}

function getGroupDoc(groupId, ...segments) {
  let ref = db.collection("groups").doc(groupId);
  for (let index = 0; index < segments.length; index += 2) {
    ref = ref.collection(segments[index]).doc(segments[index + 1]);
  }
  return ref;
}

async function upsertDoc(targetRef, data, sourcePath) {
  const existing = await targetRef.get();
  if (existing.exists && existing.data()?.sourcePath === sourcePath) {
    counters.skipped += 1;
    return false;
  }

  if (dryRun) {
    counters.written += 1;
    console.log(`[dry-run] ${sourcePath} -> ${targetRef.path}`);
    return true;
  }

  await targetRef.set(
    {
      ...data,
      sourcePath,
      migratedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  counters.written += 1;
  return true;
}

async function migrateRootEvents() {
  for (const collectionName of ["events", "clubEvents"]) {
    const snapshot = await withLimit(db.collection(collectionName)).get();
    for (const row of snapshot.docs) {
      const data = row.data();
      const schoolId = data.schoolId;
      if (!schoolId) {
        counters.missingSchool += 1;
        continue;
      }

      await upsertDoc(
        db.collection("schools").doc(schoolId).collection("events").doc(row.id),
        { ...data, schoolId },
        row.ref.path
      );
    }
  }

  const schoolsSnapshot = await withLimit(db.collection("schools")).get();
  for (const schoolDoc of schoolsSnapshot.docs) {
    const schoolId = schoolDoc.id;
    const snapshot = await withLimit(schoolDoc.ref.collection("clubEvents")).get();
    for (const row of snapshot.docs) {
      await upsertDoc(
        schoolDoc.ref.collection("events").doc(row.id),
        { ...row.data(), schoolId },
        row.ref.path
      );
    }
  }
}

async function migrateUserCollections() {
  const usersSnapshot = await withLimit(db.collection("users")).get();
  const collectionMap = new Map([
    ["achievements", "achievements"],
    ["weeklyReports", "weeklyReports"],
    ["dailyBriefs", "dailyBriefs"],
    ["grades", "grades"],
    ["enrollments", "enrollments"],
    ["favorites", "favorites"],
  ]);

  for (const userDoc of usersSnapshot.docs) {
    const uid = userDoc.id;
    const schoolId = await resolveUserSchoolId(uid, userDoc.data());
    if (!schoolId) {
      counters.missingSchool += 1;
      continue;
    }

    for (const [sourceCollection, targetCollection] of collectionMap.entries()) {
      const snapshot = await withLimit(userDoc.ref.collection(sourceCollection)).get();
      for (const row of snapshot.docs) {
        await upsertDoc(
          getUserSchoolDoc(uid, schoolId, targetCollection, row.id),
          { ...row.data(), schoolId },
          row.ref.path
        );
      }
    }
  }
}

async function getAssignmentGroupId(assignmentId) {
  if (assignmentGroupCache.has(assignmentId)) {
    return assignmentGroupCache.get(assignmentId);
  }

  const assignmentDoc = await db.collection("assignments").doc(assignmentId).get().catch(() => null);
  const groupId = assignmentDoc?.exists ? assignmentDoc.data()?.groupId || null : null;
  assignmentGroupCache.set(assignmentId, groupId);
  return groupId;
}

async function getPostGroupId(postId) {
  if (postGroupCache.has(postId)) {
    return postGroupCache.get(postId);
  }

  const postDoc = await db.collection("groupPosts").doc(postId).get().catch(() => null);
  const groupId = postDoc?.exists ? postDoc.data()?.groupId || null : null;
  postGroupCache.set(postId, groupId);
  return groupId;
}

async function migrateGroupData() {
  const membersSnap = await withLimit(db.collection("groupMembers")).get().catch(() => null);
  for (const row of membersSnap?.docs || []) {
    const data = row.data();
    const groupId = data.groupId;
    const memberUid = data.userId || data.uid;
    if (!groupId || !memberUid) {
      counters.missingGroup += 1;
      continue;
    }

    await upsertDoc(
      getGroupDoc(groupId, "members", memberUid),
      { ...data, uid: memberUid, userId: memberUid },
      row.ref.path
    );
    await upsertDoc(
      db.collection("users").doc(memberUid).collection("groups").doc(groupId),
      { ...data, groupId, uid: memberUid, userId: memberUid },
      row.ref.path
    );
  }

  const postsSnap = await withLimit(db.collection("groupPosts")).get().catch(() => null);
  for (const row of postsSnap?.docs || []) {
    const data = row.data();
    if (!data.groupId) {
      counters.missingGroup += 1;
      continue;
    }
    postGroupCache.set(row.id, data.groupId);
    await upsertDoc(
      getGroupDoc(data.groupId, "posts", row.id),
      { ...data, groupId: data.groupId },
      row.ref.path
    );
  }

  const commentsSnap = await withLimit(db.collection("comments")).get().catch(() => null);
  for (const row of commentsSnap?.docs || []) {
    const data = row.data();
    const groupId = data.groupId || await getPostGroupId(data.postId);
    if (!groupId || !data.postId) {
      counters.missingGroup += 1;
      continue;
    }
    await upsertDoc(
      getGroupDoc(groupId, "posts", data.postId, "comments", row.id),
      { ...data, groupId, postId: data.postId },
      row.ref.path
    );
  }

  const assignmentsSnap = await withLimit(db.collection("assignments")).get().catch(() => null);
  for (const row of assignmentsSnap?.docs || []) {
    const data = row.data();
    if (!data.groupId) {
      counters.missingGroup += 1;
      continue;
    }
    assignmentGroupCache.set(row.id, data.groupId);
    await upsertDoc(
      getGroupDoc(data.groupId, "assignments", row.id),
      { ...data, groupId: data.groupId },
      row.ref.path
    );
  }

  const submissionsSnap = await withLimit(db.collection("submissions")).get().catch(() => null);
  for (const row of submissionsSnap?.docs || []) {
    const data = row.data();
    const assignmentId = data.assignmentId;
    const groupId = data.groupId || await getAssignmentGroupId(assignmentId);
    const submissionUid = data.userId || data.uid || row.id;
    if (!groupId || !assignmentId || !submissionUid) {
      counters.missingGroup += 1;
      continue;
    }
    await upsertDoc(
      getGroupDoc(groupId, "assignments", assignmentId, "submissions", submissionUid),
      { ...data, groupId, assignmentId, userId: submissionUid, uid: submissionUid },
      row.ref.path
    );
  }
}

async function migrateWalletAndOrders() {
  const walletsSnap = await withLimit(db.collection("wallets")).get().catch(() => null);
  for (const row of walletsSnap?.docs || []) {
    const uid = row.id;
    const schoolId = await resolveUserSchoolId(uid);
    if (!schoolId) {
      counters.missingSchool += 1;
      continue;
    }

    await upsertDoc(
      getUserSchoolDoc(uid, schoolId, "wallet", "balance"),
      { ...row.data(), schoolId },
      row.ref.path
    );
  }

  const transactionCollections = ["transactions", "ledgerEntries"];
  for (const collectionName of transactionCollections) {
    const snapshot = await withLimit(db.collection(collectionName)).get().catch(() => null);
    for (const row of snapshot?.docs || []) {
      const data = row.data();
      const uid = data.userId;
      if (!uid) continue;
      const schoolId = data.schoolId || await resolveUserSchoolId(uid);
      if (!schoolId) {
        counters.missingSchool += 1;
        continue;
      }

      await upsertDoc(
        getUserSchoolDoc(uid, schoolId, "transactions", row.id),
        { ...data, schoolId },
        row.ref.path
      );
    }
  }

  const rootOrdersSnap = await withLimit(db.collection("orders")).get().catch(() => null);
  for (const row of rootOrdersSnap?.docs || []) {
    const data = row.data();
    const uid = data.userId;
    const schoolId = data.schoolId || (uid ? await resolveUserSchoolId(uid) : null);
    if (!uid || !schoolId) {
      counters.missingSchool += 1;
      continue;
    }

    await upsertDoc(
      db.collection("schools").doc(schoolId).collection("orders").doc(row.id),
      { ...data, schoolId },
      row.ref.path
    );
    await upsertDoc(
      getUserSchoolDoc(uid, schoolId, "orders", row.id),
      { ...data, schoolId },
      row.ref.path
    );
  }

  const schoolsSnapshot = await withLimit(db.collection("schools")).get();
  for (const schoolDoc of schoolsSnapshot.docs) {
    const schoolId = schoolDoc.id;
    const ordersSnap = await withLimit(schoolDoc.ref.collection("orders")).get().catch(() => null);
    for (const row of ordersSnap?.docs || []) {
      const data = row.data();
      if (!data.userId) continue;
      await upsertDoc(
        getUserSchoolDoc(data.userId, schoolId, "orders", row.id),
        { ...data, schoolId },
        row.ref.path
      );
    }
  }
}

async function main() {
  console.log(`[backfillCanonicalData] starting${dryRun ? " (dry-run)" : ""}`);
  await migrateRootEvents();
  await migrateUserCollections();
  await migrateGroupData();
  await migrateWalletAndOrders();
  console.log("[backfillCanonicalData] completed", counters);
}

main().catch((error) => {
  counters.errors += 1;
  console.error("[backfillCanonicalData] failed", error);
  process.exitCode = 1;
});
