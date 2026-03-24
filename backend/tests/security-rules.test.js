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
  test("deny reading another user's private profile", async () => {
    await seedFirestore(async (db) => {
      await db.collection("users").doc("alice").set({
        displayName: "Alice",
        phone: "0900000000",
      });
    });

    const db = testEnv.authenticatedContext("mallory").firestore();
    await assertFails(db.collection("users").doc("alice").get());
  });

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

  test("deny reading another school member document without elevated role", async () => {
    await seedFirestore(async (db) => {
      await db.collection("schools").doc("tw-demo-uni").collection("members").doc("alice").set({
        role: "member",
        status: "active",
      });
      await db.collection("schools").doc("tw-demo-uni").collection("members").doc("bob").set({
        role: "member",
        status: "active",
      });
    });

    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(
      db.collection("schools").doc("tw-demo-uni").collection("members").doc("bob").get()
    );
  });

  test("deny ordinary members from writing school announcements", async () => {
    await seedFirestore(async (db) => {
      await db.collection("schools").doc("tw-demo-uni").collection("members").doc("alice").set({
        role: "member",
        status: "active",
      });
    });

    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(
      db.collection("schools").doc("tw-demo-uni").collection("announcements").doc("announcement-1").set({
        title: "Private admin announcement",
        body: "Only callable functions should write this",
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

  test("deny client-created school orders", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();

    await assertFails(
      db.collection("schools").doc("tw-demo-uni").collection("orders").doc("order-1").set({
        userId: "alice",
        schoolId: "tw-demo-uni",
        cafeteriaId: "cafeteria-1",
        status: "pending",
      })
    );
  });

  test("allow matching cafeteria operator to read and update that cafeteria's orders", async () => {
    await seedFirestore(async (db) => {
      await db.collection("schools").doc("tw-demo-uni").collection("cafeterias").doc("cafeteria-1").set({
        name: "第一餐廳",
        orderingEnabled: true,
        pilotStatus: "live",
      });
      await db
        .collection("schools")
        .doc("tw-demo-uni")
        .collection("cafeterias")
        .doc("cafeteria-1")
        .collection("operators")
        .doc("merchant-1")
        .set({
          status: "active",
          role: "manager",
        });
      await db.collection("schools").doc("tw-demo-uni").collection("orders").doc("order-1").set({
        userId: "alice",
        schoolId: "tw-demo-uni",
        cafeteriaId: "cafeteria-1",
        status: "pending",
      });
    });

    const db = testEnv.authenticatedContext("merchant-1").firestore();
    await assertSucceeds(
      db.collection("schools").doc("tw-demo-uni").collection("orders").doc("order-1").get()
    );
    await assertSucceeds(
      db.collection("schools").doc("tw-demo-uni").collection("orders").doc("order-1").update({
        status: "ready",
      })
    );
  });

  test("deny cafeteria operators from accessing another cafeteria's orders while admin override still works", async () => {
    await seedFirestore(async (db) => {
      await db.collection("schools").doc("tw-demo-uni").collection("members").doc("admin-1").set({
        role: "admin",
        status: "active",
      });
      await db.collection("schools").doc("tw-demo-uni").collection("cafeterias").doc("cafeteria-1").set({
        name: "第一餐廳",
        orderingEnabled: true,
        pilotStatus: "live",
      });
      await db.collection("schools").doc("tw-demo-uni").collection("cafeterias").doc("cafeteria-2").set({
        name: "第二餐廳",
        orderingEnabled: true,
        pilotStatus: "pilot",
      });
      await db
        .collection("schools")
        .doc("tw-demo-uni")
        .collection("cafeterias")
        .doc("cafeteria-2")
        .collection("operators")
        .doc("merchant-2")
        .set({
          status: "active",
          role: "staff",
        });
      await db.collection("schools").doc("tw-demo-uni").collection("orders").doc("order-2").set({
        userId: "alice",
        schoolId: "tw-demo-uni",
        cafeteriaId: "cafeteria-1",
        status: "pending",
      });
    });

    const operatorDb = testEnv.authenticatedContext("merchant-2").firestore();
    await assertFails(
      operatorDb.collection("schools").doc("tw-demo-uni").collection("orders").doc("order-2").get()
    );

    const adminDb = testEnv.authenticatedContext("admin-1").firestore();
    await assertSucceeds(
      adminDb.collection("schools").doc("tw-demo-uni").collection("orders").doc("order-2").update({
        status: "confirmed",
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

  test("deny conversation creation when schoolId is missing", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();

    await assertFails(
      db.collection("conversations").doc("conversation-2").set({
        memberIds: ["alice", "bob"],
        createdAt: "2026-03-20T00:00:00.000Z",
      })
    );
  });

  test("allow conversation members to update nested message readBy only", async () => {
    await seedFirestore(async (db) => {
      await db.collection("schools").doc("tw-demo-uni").collection("members").doc("alice").set({
        role: "student",
        status: "active",
      });
      await db.collection("schools").doc("tw-demo-uni").collection("members").doc("bob").set({
        role: "student",
        status: "active",
      });
      await db.collection("conversations").doc("conversation-2").set({
        schoolId: "tw-demo-uni",
        memberIds: ["alice", "bob"],
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      });
      await db
        .collection("conversations")
        .doc("conversation-2")
        .collection("messages")
        .doc("message-2")
        .set({
          conversationId: "conversation-2",
          senderId: "alice",
          content: "hello",
          readBy: ["alice"],
          createdAt: "2026-03-20T00:00:00.000Z",
        });
    });

    const db = testEnv.authenticatedContext("bob").firestore();
    await assertSucceeds(
      db
        .collection("conversations")
        .doc("conversation-2")
        .collection("messages")
        .doc("message-2")
        .update({
          readBy: ["alice", "bob"],
        })
    );
  });

  test("deny students from reading classmates' gradebook rows", async () => {
    await seedFirestore(async (db) => {
      await db.collection("groups").doc("group-1").set({
        schoolId: "tw-demo-uni",
        name: "Secure Systems",
      });
      await db.collection("groups").doc("group-1").collection("members").doc("alice").set({
        role: "member",
        status: "active",
      });
      await db.collection("groups").doc("group-1").collection("members").doc("bob").set({
        role: "member",
        status: "active",
      });
      await db.collection("groups").doc("group-1").collection("gradebook").doc("bob").set({
        userId: "bob",
        finalScore: 92,
      });
    });

    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(
      db.collection("groups").doc("group-1").collection("gradebook").doc("bob").get()
    );
  });

  test("deny students from reading classmates' submissions", async () => {
    await seedFirestore(async (db) => {
      await db.collection("groups").doc("group-1").set({
        schoolId: "tw-demo-uni",
        name: "Secure Systems",
      });
      await db.collection("groups").doc("group-1").collection("members").doc("alice").set({
        role: "member",
        status: "active",
      });
      await db.collection("groups").doc("group-1").collection("members").doc("bob").set({
        role: "member",
        status: "active",
      });
      await db.collection("groups").doc("group-1").collection("assignments").doc("assignment-1").set({
        title: "Lab 1",
        createdBy: "teacher-1",
      });
      await db.collection("groups").doc("group-1").collection("assignments").doc("assignment-1").collection("submissions").doc("bob").set({
        userId: "bob",
        text: "Bob submission",
      });
    });

    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(
      db.collection("groups").doc("group-1").collection("assignments").doc("assignment-1").collection("submissions").doc("bob").get()
    );
  });

  test("allow only the assigned reviewer to read a peer-reviewed submission", async () => {
    await seedFirestore(async (db) => {
      await db.collection("groups").doc("group-1").set({
        schoolId: "tw-demo-uni",
        name: "Secure Systems",
      });
      for (const uid of ["alice", "bob", "charlie"]) {
        await db.collection("groups").doc("group-1").collection("members").doc(uid).set({
          role: "member",
          status: "active",
        });
      }
      await db.collection("groups").doc("group-1").collection("assignments").doc("assignment-1").set({
        title: "Lab 1",
        createdBy: "teacher-1",
      });
      await db.collection("groups").doc("group-1").collection("assignments").doc("assignment-1").collection("submissions").doc("bob").set({
        userId: "bob",
        text: "Bob submission",
      });
      await db.collection("groups").doc("group-1").collection("assignments").doc("assignment-1").collection("peerReviews").doc("alice").set({
        reviewerId: "alice",
        submissionOwnerId: "bob",
        comment: "",
        scores: {},
        submittedAt: null,
      });
    });

    const reviewerDb = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(
      reviewerDb.collection("groups").doc("group-1").collection("assignments").doc("assignment-1").collection("submissions").doc("bob").get()
    );

    const unrelatedDb = testEnv.authenticatedContext("charlie").firestore();
    await assertFails(
      unrelatedDb.collection("groups").doc("group-1").collection("assignments").doc("assignment-1").collection("submissions").doc("bob").get()
    );
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
