const { after, before, beforeEach, describe, test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");

const projectId = "demo-campus-security";
const firestoreRules = fs.readFileSync(
  path.resolve(__dirname, "../firestore/firestore.rules"),
  "utf8"
);
const storageRules = fs.readFileSync(
  path.resolve(__dirname, "../storage/storage.rules"),
  "utf8"
);

let testEnv;

async function seedFirestore(writeFn) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await writeFn(context.firestore());
  });
}

function uploadString(ref, value, contentType) {
  return ref.putString(value, "raw", { contentType });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: firestoreRules },
    storage: { rules: storageRules },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe("firestore security rules", () => {
  test("deny unauthenticated writes to root announcements", async () => {
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(
      db.collection("announcements").doc("announcement-1").set({
        title: "Security notice",
        schoolId: "tw-demo-uni",
        createdAt: "2026-03-20T00:00:00.000Z",
      })
    );
  });

  test("deny client-created school membership documents", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();

    await assertFails(
      db.collection("schools")
        .doc("tw-demo-uni")
        .collection("members")
        .doc("mallory")
        .set({
          role: "admin",
          status: "active",
        })
    );
  });

  test("deny client-created orders", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();

    await assertFails(
      db.collection("orders").doc("order-1").set({
        userId: "alice",
        amount: 500,
        status: "paid",
      })
    );
  });

  test("deny client-created wallet transactions", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();

    await assertFails(
      db.collection("transactions").doc("txn-1").set({
        userId: "alice",
        amount: 500,
        type: "topup",
      })
    );
  });

  test("deny message reads for users outside the conversation", async () => {
    await seedFirestore(async (db) => {
      await db.collection("conversations").doc("conversation-1").set({
        schoolId: "tw-demo-uni",
        memberIds: ["alice", "bob"],
      });

      await db.collection("messages").doc("message-1").set({
        conversationId: "conversation-1",
        senderId: "alice",
        text: "private message",
        createdAt: "2026-03-20T00:00:00.000Z",
      });
    });

    const db = testEnv.authenticatedContext("mallory").firestore();
    await assertFails(db.collection("messages").doc("message-1").get());
  });
});

describe("storage security rules", () => {
  test("deny print uploads for another user", async () => {
    const storage = testEnv.authenticatedContext("alice").storage();

    await assertFails(
      uploadString(
        storage.ref("printjobs/bob/job-1/report.pdf"),
        "fake document",
        "application/pdf"
      )
    );
  });

  test("deny group post attachments for non-members", async () => {
    await seedFirestore(async (db) => {
      await db.collection("groups").doc("group-1").set({
        schoolId: "tw-demo-uni",
        name: "Secure Systems",
      });

      await db.collection("groups").doc("group-1").collection("members").doc("alice").set({
        role: "owner",
        status: "active",
      });
    });

    const storage = testEnv.authenticatedContext("mallory").storage();

    await assertFails(
      uploadString(
        storage.ref("groups/group-1/posts/post-1/notes.pdf"),
        "private notes",
        "application/pdf"
      )
    );
  });

  test("allow avatar uploads for the file owner", async () => {
    const storage = testEnv.authenticatedContext("alice").storage();

    await assertSucceeds(
      uploadString(storage.ref("avatars/alice.jpg"), "fake image", "image/jpeg")
    );
  });
});
