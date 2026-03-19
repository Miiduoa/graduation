const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, FieldPath, Timestamp } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const https = require("https");
const http = require("http");

// TDX API 金鑰（透過 firebase functions:secrets:set 設定）
const TDX_CLIENT_ID = defineSecret("TDX_CLIENT_ID");
const TDX_CLIENT_SECRET = defineSecret("TDX_CLIENT_SECRET");

// TDX OAuth2 取得 Access Token
async function getTdxAccessToken(clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const body = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
    const options = {
      hostname: "tdx.transportdata.tw",
      path: "/auth/realms/TDXConnect/protocol/openid-connect/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error(`TDX token error: ${data}`));
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// 呼叫 TDX API
async function fetchTdxApi(path, accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "tdx.transportdata.tw",
      path,
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

initializeApp();

const db = getFirestore();
const messaging = getMessaging();

const REGION = "asia-east1";

// =====================================================
// 工具函數
// =====================================================

function normalizeSsoConfig(rawConfig = {}) {
  return {
    ...rawConfig,
    authorizationEndpoint: rawConfig.authorizationEndpoint || rawConfig.authUrl,
    authUrl: rawConfig.authUrl || rawConfig.authorizationEndpoint,
    tokenEndpoint: rawConfig.tokenEndpoint || rawConfig.tokenUrl,
    tokenUrl: rawConfig.tokenUrl || rawConfig.tokenEndpoint,
    userInfoEndpoint: rawConfig.userInfoEndpoint || rawConfig.userInfoUrl,
    userInfoUrl: rawConfig.userInfoUrl || rawConfig.userInfoEndpoint,
    samlEntryPoint: rawConfig.samlEntryPoint || rawConfig.idpSsoUrl,
    idpSsoUrl: rawConfig.idpSsoUrl || rawConfig.samlEntryPoint,
  };
}

function toSchoolMemberRole(role) {
  if (role === "admin") return "admin";
  if (role === "teacher" || role === "staff") return "editor";
  return "member";
}

async function getUserPushTokens(uid) {
  const tokensSnap = await db.collection("users").doc(uid).collection("pushTokens").get();
  return tokensSnap.docs.map((doc) => doc.data().token).filter(Boolean);
}

async function getUserNotificationPrefs(uid) {
  const prefsDoc = await db.collection("users").doc(uid).collection("settings").doc("notifications").get();
  if (!prefsDoc.exists) {
    return {
      enabled: true,
      announcements: true,
      events: true,
      groups: true,
      assignments: true,
      grades: true,
      messages: true,
      quietHoursEnabled: false,
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
    };
  }
  return prefsDoc.data();
}

function isInQuietHours(prefs) {
  if (!prefs.quietHoursEnabled) return false;

  const now = new Date();
  const [startH, startM] = prefs.quietHoursStart.split(":").map(Number);
  const [endH, endM] = prefs.quietHoursEnd.split(":").map(Number);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

async function sendPushToUser(uid, notification, data = {}) {
  const prefs = await getUserNotificationPrefs(uid);

  if (!prefs.enabled) {
    console.log(`User ${uid} has notifications disabled`);
    return { success: false, reason: "disabled" };
  }

  if (isInQuietHours(prefs)) {
    console.log(`User ${uid} is in quiet hours`);
    return { success: false, reason: "quiet_hours" };
  }

  const tokens = await getUserPushTokens(uid);
  if (tokens.length === 0) {
    console.log(`User ${uid} has no push tokens`);
    return { success: false, reason: "no_tokens" };
  }

  const messages = tokens.map((token) => ({
    token,
    notification: {
      title: notification.title,
      body: notification.body,
    },
    data: {
      ...data,
      click_action: "FLUTTER_NOTIFICATION_CLICK",
    },
    android: {
      notification: {
        channelId: data.channel || "default",
        priority: "high",
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          badge: 1,
        },
      },
    },
  }));

  const results = await Promise.allSettled(
    messages.map((msg) => messaging.send(msg))
  );

  const successCount = results.filter((r) => r.status === "fulfilled").length;
  console.log(`Sent ${successCount}/${tokens.length} notifications to user ${uid}`);

  return { success: successCount > 0, sent: successCount, total: tokens.length };
}

async function sendPushToMultipleUsers(uids, notification, data = {}, categoryPref = null) {
  const results = await Promise.allSettled(
    uids.map(async (uid) => {
      if (categoryPref) {
        const prefs = await getUserNotificationPrefs(uid);
        if (!prefs[categoryPref]) {
          return { uid, success: false, reason: "category_disabled" };
        }
      }
      return { uid, ...(await sendPushToUser(uid, notification, data)) };
    })
  );

  return results.map((r) => (r.status === "fulfilled" ? r.value : { success: false, error: r.reason }));
}

async function getSchoolMemberUids(schoolId) {
  const membersSnap = await db
    .collection("schools")
    .doc(schoolId)
    .collection("members")
    .where("status", "==", "active")
    .get();
  return membersSnap.docs.map((doc) => doc.id);
}

async function getGroupMemberUids(groupId) {
  const membersSnap = await db
    .collection("groups")
    .doc(groupId)
    .collection("members")
    .where("status", "==", "active")
    .get();
  return membersSnap.docs.map((doc) => doc.id);
}

// =====================================================
// 公告通知
// =====================================================

exports.onAnnouncementCreated = onDocumentCreated(
  {
    document: "schools/{schoolId}/announcements/{announcementId}",
    region: REGION,
  },
  async (event) => {
    const { schoolId, announcementId } = event.params;
    const announcement = event.data?.data();

    if (!announcement) return;

    console.log(`New announcement in school ${schoolId}: ${announcement.title}`);

    const memberUids = await getSchoolMemberUids(schoolId);
    if (memberUids.length === 0) {
      console.log("No members to notify");
      return;
    }

    const notification = {
      title: `📢 ${announcement.source || "校園公告"}`,
      body: announcement.title || "(無標題)",
    };

    const data = {
      type: "announcement",
      announcementId,
      schoolId,
      channel: "announcements",
    };

    const results = await sendPushToMultipleUsers(memberUids, notification, data, "announcements");
    console.log(`Announcement notification results:`, results.length);

    await db.collection("schools").doc(schoolId).collection("announcements").doc(announcementId).update({
      notificationSentAt: FieldValue.serverTimestamp(),
    });
  }
);

// =====================================================
// 活動通知
// =====================================================

exports.onEventCreated = onDocumentCreated(
  {
    document: "schools/{schoolId}/clubEvents/{eventId}",
    region: REGION,
  },
  async (event) => {
    const { schoolId, eventId } = event.params;
    const eventData = event.data?.data();

    if (!eventData) return;

    console.log(`New event in school ${schoolId}: ${eventData.title}`);

    const memberUids = await getSchoolMemberUids(schoolId);
    if (memberUids.length === 0) return;

    const notification = {
      title: "🎉 新活動",
      body: eventData.title || "(無標題)",
    };

    const data = {
      type: "event",
      eventId,
      schoolId,
      channel: "events",
    };

    await sendPushToMultipleUsers(memberUids, notification, data, "events");
  }
);

exports.eventReminder = onSchedule(
  {
    schedule: "every 15 minutes",
    region: REGION,
    timeZone: "Asia/Taipei",
  },
  async () => {
    const now = Timestamp.now();
    const oneDayLater = Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000);

    const schoolsSnap = await db.collection("schools").get();

    for (const schoolDoc of schoolsSnap.docs) {
      const schoolId = schoolDoc.id;

      const eventsSnap = await db
        .collection("schools")
        .doc(schoolId)
        .collection("clubEvents")
        .where("startsAt", ">=", now)
        .where("startsAt", "<=", oneDayLater)
        .get();

      for (const eventDoc of eventsSnap.docs) {
        const eventData = eventDoc.data();
        const eventId = eventDoc.id;
        const startsAt = eventData.startsAt?.toMillis();

        if (!startsAt) continue;

        const diffMs = startsAt - now.toMillis();
        const diffHours = diffMs / (1000 * 60 * 60);

        let reminderType = null;
        if (diffHours <= 1 && diffHours > 0.75 && !eventData.reminder1hSent) {
          reminderType = "1h";
        } else if (diffHours <= 24 && diffHours > 23.75 && !eventData.reminder1dSent) {
          reminderType = "1d";
        }

        if (!reminderType) continue;

        const registrationsSnap = await db
          .collection("schools")
          .doc(schoolId)
          .collection("registrations")
          .where("eventId", "==", eventId)
          .get();

        const registeredUids = registrationsSnap.docs.map((d) => d.data().userId).filter(Boolean);
        if (registeredUids.length === 0) continue;

        const notification = {
          title: reminderType === "1h" ? "⏰ 活動即將開始" : "📅 活動提醒",
          body: `${eventData.title} ${reminderType === "1h" ? "將在 1 小時後開始" : "明天將舉行"}`,
        };

        const data = {
          type: "event_reminder",
          eventId,
          schoolId,
          reminderType,
          channel: "events",
        };

        await sendPushToMultipleUsers(registeredUids, notification, data, "events");

        await eventDoc.ref.update({
          [`reminder${reminderType === "1h" ? "1h" : "1d"}Sent`]: true,
        });

        console.log(`Sent ${reminderType} reminder for event ${eventId} to ${registeredUids.length} users`);
      }
    }
  }
);

// =====================================================
// 群組通知
// =====================================================

exports.onGroupPostCreated = onDocumentCreated(
  {
    document: "groups/{groupId}/posts/{postId}",
    region: REGION,
  },
  async (event) => {
    const { groupId, postId } = event.params;
    const post = event.data?.data();

    if (!post) return;

    const authorId = post.authorId;
    const memberUids = await getGroupMemberUids(groupId);
    const targetUids = memberUids.filter((uid) => uid !== authorId);

    if (targetUids.length === 0) return;

    const groupDoc = await db.collection("groups").doc(groupId).get();
    const groupName = groupDoc.data()?.name || "群組";

    let title = "";
    let categoryPref = "groups";

    switch (post.kind) {
      case "announcement":
        title = `📢 ${groupName}`;
        break;
      case "question":
        title = `❓ ${groupName}`;
        break;
      default:
        title = `💬 ${groupName}`;
    }

    const notification = {
      title,
      body: post.title || post.body?.slice(0, 50) || "(新貼文)",
    };

    const data = {
      type: "group_post",
      groupId,
      postId,
      channel: "groups",
    };

    await sendPushToMultipleUsers(targetUids, notification, data, categoryPref);
  }
);

exports.onAssignmentCreated = onDocumentCreated(
  {
    document: "groups/{groupId}/assignments/{assignmentId}",
    region: REGION,
  },
  async (event) => {
    const { groupId, assignmentId } = event.params;
    const assignment = event.data?.data();

    if (!assignment) return;

    const memberUids = await getGroupMemberUids(groupId);
    const teacherId = assignment.createdBy;
    const studentUids = memberUids.filter((uid) => uid !== teacherId);

    if (studentUids.length === 0) return;

    const groupDoc = await db.collection("groups").doc(groupId).get();
    const groupName = groupDoc.data()?.name || "課程";

    const dueAt = assignment.dueAt?.toDate();
    const dueStr = dueAt
      ? `${dueAt.getMonth() + 1}/${dueAt.getDate()} ${dueAt.getHours()}:${String(dueAt.getMinutes()).padStart(2, "0")}`
      : "";

    const notification = {
      title: `📝 ${groupName} 新作業`,
      body: `${assignment.title || "(無標題)"} ${dueStr ? `| 截止：${dueStr}` : ""}`,
    };

    const data = {
      type: "assignment",
      groupId,
      assignmentId,
      channel: "groups",
    };

    await sendPushToMultipleUsers(studentUids, notification, data, "assignments");
  }
);

exports.onGradePublished = onDocumentUpdated(
  {
    document: "groups/{groupId}/assignments/{assignmentId}/submissions/{submissionId}",
    region: REGION,
  },
  async (event) => {
    const { groupId, assignmentId } = event.params;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    if (!before || !after) return;

    if (before.score === undefined && after.score !== undefined) {
      const studentId = after.studentId;
      if (!studentId) return;

      const assignmentDoc = await db
        .collection("groups")
        .doc(groupId)
        .collection("assignments")
        .doc(assignmentId)
        .get();
      const assignmentTitle = assignmentDoc.data()?.title || "作業";

      const groupDoc = await db.collection("groups").doc(groupId).get();
      const groupName = groupDoc.data()?.name || "課程";

      const notification = {
        title: `📊 ${groupName} 成績公布`,
        body: `${assignmentTitle} 成績已公布：${after.score} 分`,
      };

      const data = {
        type: "grade",
        groupId,
        assignmentId,
        channel: "groups",
      };

      await sendPushToUser(studentId, notification, data);
    }
  }
);

// =====================================================
// 私訊通知
// =====================================================

exports.onMessageCreated = onDocumentCreated(
  {
    document: "conversations/{conversationId}/messages/{messageId}",
    region: REGION,
  },
  async (event) => {
    const { conversationId, messageId } = event.params;
    const message = event.data?.data();

    if (!message) return;

    const conversationDoc = await db.collection("conversations").doc(conversationId).get();
    const conversation = conversationDoc.data();

    if (!conversation || !conversation.participants) return;

    const senderId = message.senderId;
    const recipientIds = conversation.participants.filter((uid) => uid !== senderId);

    if (recipientIds.length === 0) return;

    const senderDoc = await db.collection("users").doc(senderId).get();
    const senderName = senderDoc.data()?.displayName || "某人";

    const notification = {
      title: `💬 ${senderName}`,
      body: message.text?.slice(0, 100) || "(訊息)",
    };

    const data = {
      type: "message",
      conversationId,
      messageId,
      peerId: senderId,
      channel: "messages",
    };

    await sendPushToMultipleUsers(recipientIds, notification, data, "messages");
  }
);

// =====================================================
// 失物招領通知
// =====================================================

exports.onLostFoundMatch = onDocumentCreated(
  {
    document: "schools/{schoolId}/lostFound/{itemId}",
    region: REGION,
  },
  async (event) => {
    const { schoolId, itemId } = event.params;
    const newItem = event.data?.data();

    if (!newItem) return;

    const oppositeType = newItem.type === "lost" ? "found" : "lost";

    const potentialMatchesSnap = await db
      .collection("schools")
      .doc(schoolId)
      .collection("lostFound")
      .where("type", "==", oppositeType)
      .where("status", "==", "active")
      .where("category", "==", newItem.category)
      .limit(5)
      .get();

    for (const matchDoc of potentialMatchesSnap.docs) {
      const matchData = matchDoc.data();
      const matchOwnerId = matchData.userId;

      if (matchOwnerId && matchOwnerId !== newItem.userId) {
        const notification = {
          title: newItem.type === "lost" ? "🔍 可能的遺失物品配對" : "🎁 可能的拾獲物品配對",
          body: `有人${newItem.type === "lost" ? "遺失了" : "拾獲了"}與您的物品相似的東西：${newItem.name}`,
        };

        const data = {
          type: "lost_found_match",
          itemId,
          matchItemId: matchDoc.id,
          schoolId,
          channel: "default",
        };

        await sendPushToUser(matchOwnerId, notification, data);
      }
    }
  }
);

// =====================================================
// HTTP Callable Functions
// =====================================================

exports.sendTestNotification = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const result = await sendPushToUser(uid, {
      title: "🧪 測試通知",
      body: "這是一則測試推播通知，如果你看到這則訊息，表示推播設定正確！",
    });

    return result;
  }
);

exports.sendCustomNotification = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const adminCheck = await db.collection("admins").doc(uid).get();
    if (!adminCheck.exists) {
      throw new HttpsError("permission-denied", "Admin access required");
    }

    const { targetUids, title, body, data } = request.data;

    if (!targetUids || !Array.isArray(targetUids) || !title || !body) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const results = await sendPushToMultipleUsers(targetUids, { title, body }, data || {});

    return {
      success: true,
      results,
    };
  }
);

// =====================================================
// 作業截止提醒 (Scheduled)
// =====================================================

exports.assignmentDueReminder = onSchedule(
  {
    schedule: "every 1 hours",
    region: REGION,
    timeZone: "Asia/Taipei",
  },
  async () => {
    const now = Timestamp.now();
    const oneDayLater = Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000);

    const groupsSnap = await db.collection("groups").get();

    for (const groupDoc of groupsSnap.docs) {
      const groupId = groupDoc.id;
      const groupName = groupDoc.data().name || "課程";

      const assignmentsSnap = await db
        .collection("groups")
        .doc(groupId)
        .collection("assignments")
        .where("dueAt", ">=", now)
        .where("dueAt", "<=", oneDayLater)
        .where("dueReminderSent", "!=", true)
        .get();

      for (const assignmentDoc of assignmentsSnap.docs) {
        const assignment = assignmentDoc.data();
        const assignmentId = assignmentDoc.id;

        const submissionsSnap = await db
          .collection("groups")
          .doc(groupId)
          .collection("assignments")
          .doc(assignmentId)
          .collection("submissions")
          .get();

        const submittedUids = new Set(submissionsSnap.docs.map((d) => d.data().studentId));

        const memberUids = await getGroupMemberUids(groupId);
        const teacherId = assignment.createdBy;
        const unsubmittedUids = memberUids.filter(
          (uid) => uid !== teacherId && !submittedUids.has(uid)
        );

        if (unsubmittedUids.length > 0) {
          const dueAt = assignment.dueAt?.toDate();
          const diffHours = dueAt ? Math.round((dueAt.getTime() - Date.now()) / (1000 * 60 * 60)) : 24;

          const notification = {
            title: `⏰ ${groupName} 作業即將截止`,
            body: `${assignment.title || "作業"} 還有約 ${diffHours} 小時截止，請盡快繳交！`,
          };

          const data = {
            type: "assignment_due",
            groupId,
            assignmentId,
            channel: "groups",
          };

          await sendPushToMultipleUsers(unsubmittedUids, notification, data, "assignments");

          await assignmentDoc.ref.update({ dueReminderSent: true });

          console.log(
            `Sent due reminder for assignment ${assignmentId} to ${unsubmittedUids.length} students`
          );
        }
      }
    }
  }
);

// =====================================================
// iCal 訂閱 API
// =====================================================

const { onRequest } = require("firebase-functions/v2/https");

function formatICalDate(date, allDay = false) {
  const d = date instanceof Date ? date : date.toDate();
  if (allDay) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeICalText(text) {
  if (!text) return "";
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function generateICalFeed(events, calendarName = "校園行事曆") {
  let ical = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Campus App//TW",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeICalText(calendarName)}`,
    "X-WR-TIMEZONE:Asia/Taipei",
    "",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Taipei",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0800",
    "TZOFFSETTO:+0800",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  for (const event of events) {
    const uid = `${event.id}@campus-app.tw`;
    const dtstamp = formatICalDate(new Date());

    ical.push("BEGIN:VEVENT");
    ical.push(`UID:${uid}`);
    ical.push(`DTSTAMP:${dtstamp}`);

    if (event.allDay) {
      ical.push(`DTSTART;VALUE=DATE:${formatICalDate(event.startsAt, true)}`);
      if (event.endsAt) {
        ical.push(`DTEND;VALUE=DATE:${formatICalDate(event.endsAt, true)}`);
      }
    } else {
      ical.push(`DTSTART;TZID=Asia/Taipei:${formatICalDate(event.startsAt)}`);
      if (event.endsAt) {
        ical.push(`DTEND;TZID=Asia/Taipei:${formatICalDate(event.endsAt)}`);
      }
    }

    ical.push(`SUMMARY:${escapeICalText(event.title)}`);

    if (event.description) {
      ical.push(`DESCRIPTION:${escapeICalText(event.description)}`);
    }
    if (event.location) {
      ical.push(`LOCATION:${escapeICalText(event.location)}`);
    }
    if (event.url) {
      ical.push(`URL:${event.url}`);
    }
    if (event.categories && event.categories.length > 0) {
      ical.push(`CATEGORIES:${event.categories.map(escapeICalText).join(",")}`);
    }

    ical.push("END:VEVENT");
  }

  ical.push("END:VCALENDAR");
  return ical.join("\r\n");
}

exports.calendarSubscribe = onRequest(
  {
    region: REGION,
    cors: true,
  },
  async (req, res) => {
    const { schoolId, userId, type } = req.query;

    if (!schoolId) {
      res.status(400).send("Missing schoolId parameter");
      return;
    }

    try {
      const events = [];

      const schoolDoc = await db.collection("schools").doc(schoolId).get();
      const schoolName = schoolDoc.data()?.name || schoolId;

      if (!type || type === "all" || type === "events") {
        const eventsSnap = await db
          .collection("schools")
          .doc(schoolId)
          .collection("clubEvents")
          .orderBy("startsAt", "desc")
          .limit(100)
          .get();

        for (const doc of eventsSnap.docs) {
          const data = doc.data();
          events.push({
            id: `event-${doc.id}`,
            title: data.title || "(無標題)",
            description: data.description,
            location: data.location,
            startsAt: data.startsAt?.toDate() || new Date(),
            endsAt: data.endsAt?.toDate(),
            categories: ["活動"],
            url: data.link,
          });
        }
      }

      if (userId && (!type || type === "all" || type === "assignments")) {
        const userGroupsSnap = await db
          .collection("users")
          .doc(userId)
          .collection("groups")
          .where("schoolId", "==", schoolId)
          .where("status", "==", "active")
          .get();

        for (const groupRef of userGroupsSnap.docs) {
          const groupId = groupRef.data().groupId;
          if (!groupId) continue;

          const groupDoc = await db.collection("groups").doc(groupId).get();
          const groupName = groupDoc.data()?.name || "課程";

          const assignmentsSnap = await db
            .collection("groups")
            .doc(groupId)
            .collection("assignments")
            .orderBy("dueAt", "desc")
            .limit(50)
            .get();

          for (const doc of assignmentsSnap.docs) {
            const data = doc.data();
            if (!data.dueAt) continue;

            events.push({
              id: `assignment-${groupId}-${doc.id}`,
              title: `[作業] ${data.title || "(無標題)"} - ${groupName}`,
              description: data.description,
              startsAt: data.dueAt.toDate(),
              allDay: true,
              categories: ["作業", groupName],
            });
          }
        }
      }

      if (userId && (!type || type === "all" || type === "registered")) {
        const registrationsSnap = await db
          .collection("schools")
          .doc(schoolId)
          .collection("registrations")
          .where("userId", "==", userId)
          .get();

        const registeredEventIds = new Set(
          registrationsSnap.docs.map((d) => d.data().eventId)
        );

        for (const eventId of registeredEventIds) {
          const eventDoc = await db
            .collection("schools")
            .doc(schoolId)
            .collection("clubEvents")
            .doc(eventId)
            .get();

          if (eventDoc.exists) {
            const existingEvent = events.find((e) => e.id === `event-${eventId}`);
            if (existingEvent) {
              existingEvent.categories = [...(existingEvent.categories || []), "已報名"];
            }
          }
        }
      }

      events.sort((a, b) => {
        const aTime = a.startsAt instanceof Date ? a.startsAt.getTime() : 0;
        const bTime = b.startsAt instanceof Date ? b.startsAt.getTime() : 0;
        return aTime - bTime;
      });

      let calendarName = `${schoolName} 行事曆`;
      if (type === "events") calendarName = `${schoolName} 活動`;
      if (type === "assignments") calendarName = `${schoolName} 作業`;

      const icalContent = generateICalFeed(events, calendarName);

      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${schoolId}-calendar.ics"`);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.send(icalContent);
    } catch (error) {
      console.error("Calendar subscribe error:", error);
      res.status(500).send("Internal server error");
    }
  }
);

exports.calendarWebhook = onRequest(
  {
    region: REGION,
    cors: true,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const { schoolId, eventId, action } = req.body;

    if (!schoolId || !eventId || !action) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    console.log(`Calendar webhook: ${action} for event ${eventId} in school ${schoolId}`);

    res.json({ success: true, message: "Webhook received" });
  }
);

// =====================================================
// SSO 認證相關
// =====================================================

exports.createCustomToken = onRequest(
  {
    region: REGION,
    cors: true,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { schoolId, ssoSub, existingUid } = req.body;

    if (!schoolId || !ssoSub) {
      res.status(400).json({ error: "Missing required fields: schoolId and ssoSub" });
      return;
    }

    try {
      const ssoLinkRef = db.collection("ssoLinks").doc(`${schoolId}_${ssoSub}`);
      const ssoLinkDoc = await ssoLinkRef.get();

      if (!ssoLinkDoc.exists) {
        res.status(403).json({ error: "SSO link not verified. Use verifySSOCallback instead." });
        return;
      }

      const uid = ssoLinkDoc.data().firebaseUid;
      const role = ssoLinkDoc.data().role || "student";

      if (existingUid && existingUid !== uid) {
        res.status(403).json({ error: "SSO link does not match the requested user." });
        return;
      }

      const { getAuth } = require("firebase-admin/auth");
      const auth = getAuth();
      const customToken = await auth.createCustomToken(uid, {
        schoolId,
        ssoSub,
        role,
      });

      res.json({
        customToken,
        uid,
        isNewUser: false,
      });
    } catch (error) {
      console.error("Create custom token error:", error);
      res.status(500).json({ error: "Failed to create custom token" });
    }
  }
);

exports.verifySSOCallback = onRequest(
  {
    region: REGION,
    cors: true,
  },
  async (req, res) => {
    const { provider, schoolId, code, ticket, SAMLResponse, redirectUri } = req.query;

    if (!provider || !schoolId) {
      res.status(400).json({ error: "Missing provider or schoolId" });
      return;
    }

    try {
      const configDoc = await db
        .collection("schools")
        .doc(schoolId)
        .collection("settings")
        .doc("sso")
        .get();

      if (!configDoc.exists || !configDoc.data().ssoConfig?.enabled) {
        res.status(400).json({ error: "SSO not configured for this school" });
        return;
      }

      const ssoConfig = normalizeSsoConfig(configDoc.data().ssoConfig);
      let userInfo = null;

      switch (provider) {
        case "oidc":
          if (!code) {
            res.status(400).json({ error: "Missing authorization code" });
            return;
          }
          userInfo = await verifyOIDC(code, ssoConfig, redirectUri);
          break;

        case "cas":
          if (!ticket) {
            res.status(400).json({ error: "Missing CAS ticket" });
            return;
          }
          userInfo = await verifyCAS(ticket, ssoConfig, redirectUri);
          break;

        case "saml":
          if (!SAMLResponse) {
            res.status(400).json({ error: "Missing SAML response" });
            return;
          }
          userInfo = await verifySAML(SAMLResponse, ssoConfig);
          break;

        default:
          res.status(400).json({ error: `Unsupported provider: ${provider}` });
          return;
      }

      if (!userInfo || !userInfo.sub) {
        res.status(401).json({ error: "Failed to verify SSO credentials" });
        return;
      }

      const { getAuth } = require("firebase-admin/auth");
      const auth = getAuth();

      const ssoLinkRef = db.collection("ssoLinks").doc(`${schoolId}_${userInfo.sub}`);
      const ssoLinkDoc = await ssoLinkRef.get();

      let uid;
      let isNewUser = false;

      if (ssoLinkDoc.exists) {
        uid = ssoLinkDoc.data().firebaseUid;
        const resolvedRole = determineRole(userInfo);
        
        const userRef = db.collection("users").doc(uid);
        await userRef.update({
          lastLoginAt: FieldValue.serverTimestamp(),
          displayName: userInfo.name || userInfo.displayName,
          email: userInfo.email,
          role: resolvedRole,
        });

        await db.collection("schools").doc(schoolId).collection("members").doc(uid).set(
          {
            status: "active",
            role: toSchoolMemberRole(resolvedRole),
          },
          { merge: true }
        );
      } else {
        const resolvedRole = determineRole(userInfo);
        const userRecord = await auth.createUser({
          email: userInfo.email || `${userInfo.sub}@${schoolId}.sso.local`,
          displayName: userInfo.name || userInfo.displayName,
          emailVerified: true,
        });

        uid = userRecord.uid;
        isNewUser = true;

        await ssoLinkRef.set({
          schoolId,
          ssoSub: userInfo.sub,
          firebaseUid: uid,
          email: userInfo.email,
          name: userInfo.name || userInfo.displayName,
          studentId: userInfo.studentId || userInfo.employee_id,
          department: userInfo.department || userInfo.ou,
          role: resolvedRole,
          createdAt: FieldValue.serverTimestamp(),
        });

        await db.collection("users").doc(uid).set({
          email: userInfo.email,
          displayName: userInfo.name || userInfo.displayName,
          studentId: userInfo.studentId || userInfo.employee_id,
          department: userInfo.department || userInfo.ou,
          role: resolvedRole,
          schoolId,
          createdAt: FieldValue.serverTimestamp(),
          lastLoginAt: FieldValue.serverTimestamp(),
        });

        await db.collection("schools").doc(schoolId).collection("members").doc(uid).set(
          {
            status: "active",
            role: toSchoolMemberRole(resolvedRole),
            joinedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      const customToken = await auth.createCustomToken(uid, {
        schoolId,
        ssoSub: userInfo.sub,
        role: determineRole(userInfo),
      });

      res.json({
        success: true,
        customToken,
        uid,
        isNewUser,
        userInfo: {
          email: userInfo.email,
          name: userInfo.name || userInfo.displayName,
          studentId: userInfo.studentId,
          department: userInfo.department,
        },
      });
    } catch (error) {
      console.error("SSO callback error:", error);
      res.status(500).json({ 
        error: "SSO verification failed", 
        details: error.message 
      });
    }
  }
);

async function verifyOIDC(code, ssoConfig, redirectUri) {
  const fetch = (await import("node-fetch")).default;
  
  const tokenResponse = await fetch(ssoConfig.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: ssoConfig.clientId,
      client_secret: ssoConfig.clientSecret,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error("OIDC token error:", errorText);
    throw new Error("Failed to exchange authorization code");
  }

  const tokens = await tokenResponse.json();
  
  if (tokens.id_token) {
    const decoded = decodeJWT(tokens.id_token);
    return {
      sub: decoded.sub,
      email: decoded.email,
      name: decoded.name || decoded.preferred_username,
      displayName: decoded.name || decoded.preferred_username,
      studentId: decoded.student_id || decoded.employee_id,
      department: decoded.department || decoded.ou,
      accessToken: tokens.access_token,
    };
  }

  const userInfoResponse = await fetch(ssoConfig.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
    },
  });

  if (!userInfoResponse.ok) {
    throw new Error("Failed to fetch user info");
  }

  const userInfo = await userInfoResponse.json();
  return {
    sub: userInfo.sub,
    email: userInfo.email,
    name: userInfo.name || userInfo.preferred_username,
    displayName: userInfo.name || userInfo.preferred_username,
    studentId: userInfo.student_id || userInfo.employee_id,
    department: userInfo.department || userInfo.ou,
    accessToken: tokens.access_token,
  };
}

async function verifyCAS(ticket, ssoConfig, serviceUrl) {
  const fetch = (await import("node-fetch")).default;
  const xml2js = require("xml2js");
  
  const validateUrl = `${ssoConfig.casServerUrl}/serviceValidate?ticket=${ticket}&service=${encodeURIComponent(serviceUrl)}`;
  
  const response = await fetch(validateUrl);
  if (!response.ok) {
    throw new Error("CAS ticket validation failed");
  }

  const xmlText = await response.text();
  const parser = new xml2js.Parser({ explicitArray: false });
  const result = await parser.parseStringPromise(xmlText);

  const serviceResponse = result["cas:serviceResponse"];
  
  if (serviceResponse["cas:authenticationFailure"]) {
    throw new Error(serviceResponse["cas:authenticationFailure"]._ || "CAS authentication failed");
  }

  const success = serviceResponse["cas:authenticationSuccess"];
  if (!success) {
    throw new Error("Unexpected CAS response format");
  }

  const attributes = success["cas:attributes"] || {};
  
  return {
    sub: success["cas:user"],
    email: attributes["cas:email"] || attributes["cas:mail"],
    name: attributes["cas:displayName"] || attributes["cas:cn"] || success["cas:user"],
    displayName: attributes["cas:displayName"] || attributes["cas:cn"],
    studentId: attributes["cas:studentId"] || attributes["cas:employeeNumber"],
    department: attributes["cas:department"] || attributes["cas:ou"],
  };
}

async function verifySAML(samlResponse, ssoConfig) {
  const saml2 = require("saml2-js");
  
  const sp = new saml2.ServiceProvider({
    entity_id: ssoConfig.spEntityId,
    private_key: ssoConfig.spPrivateKey,
    certificate: ssoConfig.spCertificate,
    assert_endpoint: ssoConfig.assertConsumerUrl,
  });

  const idp = new saml2.IdentityProvider({
    sso_login_url: ssoConfig.idpSsoUrl,
    sso_logout_url: ssoConfig.idpSloUrl,
    certificates: [ssoConfig.idpCertificate],
  });

  return new Promise((resolve, reject) => {
    sp.post_assert(idp, { request_body: { SAMLResponse: samlResponse } }, (err, samlResponse) => {
      if (err) {
        reject(err);
        return;
      }

      const user = samlResponse.user;
      resolve({
        sub: user.name_id,
        email: user.attributes?.email?.[0],
        name: user.attributes?.displayName?.[0] || user.attributes?.cn?.[0],
        displayName: user.attributes?.displayName?.[0],
        studentId: user.attributes?.studentId?.[0] || user.attributes?.employeeNumber?.[0],
        department: user.attributes?.department?.[0] || user.attributes?.ou?.[0],
      });
    });
  });
}

function decodeJWT(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }
  
  const payload = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payload);
}

function determineRole(userInfo) {
  const email = (userInfo.email || "").toLowerCase();
  const dept = (userInfo.department || userInfo.ou || "").toLowerCase();
  const type = (userInfo.userType || userInfo.affiliation || "").toLowerCase();
  
  if (type.includes("faculty") || type.includes("staff") || type.includes("employee")) {
    if (dept.includes("admin") || dept.includes("行政")) {
      return "admin";
    }
    return type.includes("staff") || type.includes("employee") ? "staff" : "teacher";
  }
  
  if (type.includes("student") || email.includes("student")) {
    return "student";
  }
  
  if (email.includes("teacher") || email.includes("prof")) {
    return "teacher";
  }
  
  return "student";
}

exports.getSSOConfig = onRequest(
  {
    region: REGION,
    cors: true,
  },
  async (req, res) => {
    const { schoolId } = req.query;

    if (!schoolId) {
      res.status(400).json({ error: "Missing schoolId" });
      return;
    }

    try {
      const configDoc = await db
        .collection("schools")
        .doc(schoolId)
        .collection("settings")
        .doc("sso")
        .get();

      if (!configDoc.exists) {
        res.json({
          schoolId,
          ssoConfig: null,
          allowEmailLogin: true,
        });
        return;
      }

      const config = configDoc.data();
      const ssoConfig = config.ssoConfig ? normalizeSsoConfig(config.ssoConfig) : null;
      
      const safeConfig = {
        schoolId: config.schoolId,
        schoolName: config.schoolName,
        ssoConfig: ssoConfig
          ? {
              provider: ssoConfig.provider,
              name: ssoConfig.name,
              enabled: ssoConfig.enabled,
              clientId: ssoConfig.clientId,
              authUrl: ssoConfig.authUrl,
              authorizationEndpoint: ssoConfig.authorizationEndpoint,
              tokenEndpoint: ssoConfig.tokenEndpoint,
              userInfoEndpoint: ssoConfig.userInfoEndpoint,
              casServerUrl: ssoConfig.casServerUrl,
              samlEntryPoint: ssoConfig.samlEntryPoint,
              scopes: ssoConfig.scopes,
            }
          : null,
        emailDomain: config.emailDomain,
        allowEmailLogin: config.allowEmailLogin ?? true,
      };

      res.json(safeConfig);
    } catch (error) {
      console.error("Get SSO config error:", error);
      res.status(500).json({ error: "Failed to get SSO configuration" });
    }
  }
);

exports.updateSSOConfig = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, config } = request.data;

    if (!schoolId || !config) {
      throw new HttpsError("invalid-argument", "Missing schoolId or config");
    }

    const memberDoc = await db
      .collection("schools")
      .doc(schoolId)
      .collection("members")
      .doc(uid)
      .get();

    if (!memberDoc.exists || memberDoc.data().role !== "admin") {
      throw new HttpsError("permission-denied", "Only admins can update SSO config");
    }

    await db
      .collection("schools")
      .doc(schoolId)
      .collection("settings")
      .doc("sso")
      .set(
        {
          ...config,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: uid,
        },
        { merge: true }
      );

    return { success: true };
  }
);

// =====================================================
// 使用者相關 API
// =====================================================

exports.getUserProfile = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    try {
      const userDoc = await db.collection("users").doc(uid).get();
      
      if (!userDoc.exists) {
        throw new HttpsError("not-found", "User profile not found");
      }

      const userData = userDoc.data();
      
      // 取得使用者統計
      const [groupsCount, favoriteCount] = await Promise.all([
        db.collection("users").doc(uid).collection("groups").count().get(),
        db.collection("users").doc(uid).collection("favorites").count().get(),
      ]);

      return {
        ...userData,
        stats: {
          groupsCount: groupsCount.data().count,
          favoriteCount: favoriteCount.data().count,
        },
      };
    } catch (error) {
      console.error("Get user profile error:", error);
      throw new HttpsError("internal", "Failed to get user profile");
    }
  }
);

exports.updateUserProfile = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { displayName, photoURL, department, studentId } = request.data;

    const updateData = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (displayName !== undefined) updateData.displayName = displayName;
    if (photoURL !== undefined) updateData.photoURL = photoURL;
    if (department !== undefined) updateData.department = department;
    if (studentId !== undefined) updateData.studentId = studentId;

    await db.collection("users").doc(uid).update(updateData);

    return { success: true };
  }
);

// =====================================================
// 群組管理 API
// =====================================================

exports.createGroup = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { name, description, type, schoolId, isPrivate } = request.data;

    if (!name || !type || !schoolId) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const joinCode = isPrivate ? Math.random().toString(36).substring(2, 8).toUpperCase() : null;

    const groupRef = await db.collection("groups").add({
      name,
      description: description || "",
      type,
      schoolId,
      isPrivate: !!isPrivate,
      joinCode,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      memberCount: 1,
    });

    // 創建者自動成為管理員
    await db.collection("groups").doc(groupRef.id).collection("members").doc(uid).set({
      role: "owner",
      status: "active",
      joinedAt: FieldValue.serverTimestamp(),
    });

    // 記錄到使用者的群組列表
    await db.collection("users").doc(uid).collection("groups").doc(groupRef.id).set({
      groupId: groupRef.id,
      schoolId,
      status: "active",
      role: "owner",
      joinedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      groupId: groupRef.id,
      joinCode,
    };
  }
);

exports.joinGroupByCode = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { joinCode } = request.data;

    if (!joinCode) {
      throw new HttpsError("invalid-argument", "Missing join code");
    }

    const groupsSnap = await db.collection("groups")
      .where("joinCode", "==", joinCode.toUpperCase())
      .limit(1)
      .get();

    if (groupsSnap.empty) {
      throw new HttpsError("not-found", "Invalid join code");
    }

    const groupDoc = groupsSnap.docs[0];
    const groupId = groupDoc.id;
    const groupData = groupDoc.data();

    // 檢查是否已經是成員
    const memberDoc = await db.collection("groups").doc(groupId).collection("members").doc(uid).get();
    if (memberDoc.exists && memberDoc.data().status === "active") {
      throw new HttpsError("already-exists", "Already a member of this group");
    }

    const batch = db.batch();

    // 加入群組
    batch.set(db.collection("groups").doc(groupId).collection("members").doc(uid), {
      role: "member",
      status: "active",
      joinedAt: FieldValue.serverTimestamp(),
    });

    // 更新成員數
    batch.update(db.collection("groups").doc(groupId), {
      memberCount: FieldValue.increment(1),
    });

    // 記錄到使用者的群組列表
    batch.set(db.collection("users").doc(uid).collection("groups").doc(groupId), {
      groupId,
      schoolId: groupData.schoolId,
      status: "active",
      role: "member",
      joinedAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return {
      success: true,
      groupId,
      groupName: groupData.name,
    };
  }
);

exports.leaveGroup = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { groupId } = request.data;

    if (!groupId) {
      throw new HttpsError("invalid-argument", "Missing groupId");
    }

    const memberDoc = await db.collection("groups").doc(groupId).collection("members").doc(uid).get();
    
    if (!memberDoc.exists || memberDoc.data().status !== "active") {
      throw new HttpsError("not-found", "Not a member of this group");
    }

    if (memberDoc.data().role === "owner") {
      throw new HttpsError("failed-precondition", "Owner cannot leave the group. Transfer ownership first.");
    }

    const batch = db.batch();

    batch.update(db.collection("groups").doc(groupId).collection("members").doc(uid), {
      status: "left",
      leftAt: FieldValue.serverTimestamp(),
    });

    batch.update(db.collection("groups").doc(groupId), {
      memberCount: FieldValue.increment(-1),
    });

    batch.update(db.collection("users").doc(uid).collection("groups").doc(groupId), {
      status: "left",
      leftAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return { success: true };
  }
);

// =====================================================
// 圖書館 API
// =====================================================

exports.searchBooks = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const { schoolId, query, limit = 20 } = request.data;

    if (!schoolId) {
      throw new HttpsError("invalid-argument", "Missing schoolId");
    }

    let booksRef = db.collection("schools").doc(schoolId).collection("libraryBooks");

    if (query) {
      // 簡單的標題搜尋
      booksRef = booksRef
        .where("titleLower", ">=", query.toLowerCase())
        .where("titleLower", "<=", query.toLowerCase() + "\uf8ff");
    }

    const booksSnap = await booksRef.limit(limit).get();

    return {
      books: booksSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
      total: booksSnap.size,
    };
  }
);

exports.borrowBook = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, bookId } = request.data;

    if (!schoolId || !bookId) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const bookRef = db.collection("schools").doc(schoolId).collection("libraryBooks").doc(bookId);
    const bookDoc = await bookRef.get();

    if (!bookDoc.exists) {
      throw new HttpsError("not-found", "Book not found");
    }

    const bookData = bookDoc.data();
    if (bookData.availableCopies <= 0) {
      throw new HttpsError("failed-precondition", "No copies available");
    }

    // 檢查借閱數量限制
    const userLoansSnap = await db.collection("schools").doc(schoolId)
      .collection("libraryLoans")
      .where("userId", "==", uid)
      .where("status", "==", "active")
      .get();

    if (userLoansSnap.size >= 10) {
      throw new HttpsError("failed-precondition", "Maximum loan limit reached");
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14);

    const batch = db.batch();

    const loanRef = db.collection("schools").doc(schoolId).collection("libraryLoans").doc();
    batch.set(loanRef, {
      userId: uid,
      bookId,
      bookTitle: bookData.title,
      borrowedAt: FieldValue.serverTimestamp(),
      dueAt: Timestamp.fromDate(dueDate),
      status: "active",
      renewCount: 0,
    });

    batch.update(bookRef, {
      availableCopies: FieldValue.increment(-1),
    });

    await batch.commit();

    return {
      success: true,
      loanId: loanRef.id,
      dueAt: dueDate.toISOString(),
    };
  }
);

exports.returnBook = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, loanId } = request.data;

    if (!schoolId || !loanId) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const loanRef = db.collection("schools").doc(schoolId).collection("libraryLoans").doc(loanId);
    const loanDoc = await loanRef.get();

    if (!loanDoc.exists) {
      throw new HttpsError("not-found", "Loan not found");
    }

    const loanData = loanDoc.data();
    if (loanData.userId !== uid) {
      throw new HttpsError("permission-denied", "This is not your loan");
    }

    if (loanData.status !== "active") {
      throw new HttpsError("failed-precondition", "Loan is not active");
    }

    const batch = db.batch();

    batch.update(loanRef, {
      status: "returned",
      returnedAt: FieldValue.serverTimestamp(),
    });

    batch.update(
      db.collection("schools").doc(schoolId).collection("libraryBooks").doc(loanData.bookId),
      {
        availableCopies: FieldValue.increment(1),
      }
    );

    await batch.commit();

    return { success: true };
  }
);

exports.renewBook = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, loanId } = request.data;

    if (!schoolId || !loanId) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const loanRef = db.collection("schools").doc(schoolId).collection("libraryLoans").doc(loanId);
    const loanDoc = await loanRef.get();

    if (!loanDoc.exists) {
      throw new HttpsError("not-found", "Loan not found");
    }

    const loanData = loanDoc.data();
    if (loanData.userId !== uid) {
      throw new HttpsError("permission-denied", "This is not your loan");
    }

    if (loanData.renewCount >= 2) {
      throw new HttpsError("failed-precondition", "Maximum renewal limit reached");
    }

    const newDueDate = loanData.dueAt.toDate();
    newDueDate.setDate(newDueDate.getDate() + 7);

    await loanRef.update({
      dueAt: Timestamp.fromDate(newDueDate),
      renewCount: FieldValue.increment(1),
      lastRenewedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      newDueAt: newDueDate.toISOString(),
      renewCount: loanData.renewCount + 1,
    };
  }
);

// =====================================================
// 座位預約 API
// =====================================================

exports.reserveSeat = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, seatId, date, startTime, endTime } = request.data;

    if (!schoolId || !seatId || !date || !startTime || !endTime) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    // 檢查是否有衝突預約
    const conflictsSnap = await db.collection("schools").doc(schoolId)
      .collection("seatReservations")
      .where("seatId", "==", seatId)
      .where("date", "==", date)
      .where("status", "==", "active")
      .get();

    for (const doc of conflictsSnap.docs) {
      const existing = doc.data();
      // 時間重疊檢查
      if (
        (startTime >= existing.startTime && startTime < existing.endTime) ||
        (endTime > existing.startTime && endTime <= existing.endTime) ||
        (startTime <= existing.startTime && endTime >= existing.endTime)
      ) {
        throw new HttpsError("failed-precondition", "Time slot already reserved");
      }
    }

    // 檢查用戶當日預約數量
    const userReservationsSnap = await db.collection("schools").doc(schoolId)
      .collection("seatReservations")
      .where("userId", "==", uid)
      .where("date", "==", date)
      .where("status", "==", "active")
      .get();

    if (userReservationsSnap.size >= 2) {
      throw new HttpsError("failed-precondition", "Maximum daily reservations reached");
    }

    const reservationRef = await db.collection("schools").doc(schoolId)
      .collection("seatReservations")
      .add({
        userId: uid,
        seatId,
        date,
        startTime,
        endTime,
        status: "active",
        createdAt: FieldValue.serverTimestamp(),
      });

    return {
      success: true,
      reservationId: reservationRef.id,
    };
  }
);

exports.cancelSeatReservation = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, reservationId } = request.data;

    if (!schoolId || !reservationId) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const reservationRef = db.collection("schools").doc(schoolId)
      .collection("seatReservations")
      .doc(reservationId);
    
    const reservationDoc = await reservationRef.get();

    if (!reservationDoc.exists) {
      throw new HttpsError("not-found", "Reservation not found");
    }

    if (reservationDoc.data().userId !== uid) {
      throw new HttpsError("permission-denied", "This is not your reservation");
    }

    await reservationRef.update({
      status: "cancelled",
      cancelledAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
  }
);

// =====================================================
// 收藏 API
// =====================================================

exports.toggleFavorite = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { itemType, itemId, schoolId } = request.data;

    if (!itemType || !itemId) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const favoriteRef = db.collection("users").doc(uid).collection("favorites").doc(`${itemType}_${itemId}`);
    const favoriteDoc = await favoriteRef.get();

    if (favoriteDoc.exists) {
      await favoriteRef.delete();
      return { success: true, favorited: false };
    } else {
      await favoriteRef.set({
        itemType,
        itemId,
        schoolId: schoolId || null,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { success: true, favorited: true };
    }
  }
);

exports.getFavorites = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { itemType } = request.data;

    let query = db.collection("users").doc(uid).collection("favorites");
    
    if (itemType) {
      query = query.where("itemType", "==", itemType);
    }

    const favoritesSnap = await query.orderBy("createdAt", "desc").limit(100).get();

    return {
      favorites: favoritesSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
    };
  }
);

// =====================================================
// 資料匯出 (GDPR 合規)
// =====================================================

exports.exportUserData = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    try {
      const [
        userDoc,
        favoritesSnap,
        groupsSnap,
        notificationsSnap,
      ] = await Promise.all([
        db.collection("users").doc(uid).get(),
        db.collection("users").doc(uid).collection("favorites").get(),
        db.collection("users").doc(uid).collection("groups").get(),
        db.collection("notifications").where("userId", "==", uid).limit(100).get(),
      ]);

      const exportData = {
        exportedAt: new Date().toISOString(),
        user: userDoc.exists ? { id: uid, ...userDoc.data() } : null,
        favorites: favoritesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        groups: groupsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        notifications: notificationsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      };

      return exportData;
    } catch (error) {
      console.error("Export user data error:", error);
      throw new HttpsError("internal", "Failed to export user data");
    }
  }
);

exports.deleteUserAccount = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { confirmation } = request.data;

    if (confirmation !== "DELETE_MY_ACCOUNT") {
      throw new HttpsError("invalid-argument", "Invalid confirmation");
    }

    try {
      const batch = db.batch();

      // 刪除使用者子集合
      const subcollections = ["favorites", "groups", "pushTokens", "settings"];
      for (const subcol of subcollections) {
        const snap = await db.collection("users").doc(uid).collection(subcol).get();
        snap.docs.forEach((doc) => batch.delete(doc.ref));
      }

      // 匿名化使用者資料
      batch.update(db.collection("users").doc(uid), {
        displayName: "已刪除使用者",
        email: `deleted_${uid}@deleted.local`,
        photoURL: null,
        studentId: null,
        department: null,
        deletedAt: FieldValue.serverTimestamp(),
        status: "deleted",
      });

      await batch.commit();

      // 刪除 Firebase Auth 帳號
      const { getAuth } = require("firebase-admin/auth");
      await getAuth().deleteUser(uid);

      return { success: true };
    } catch (error) {
      console.error("Delete user account error:", error);
      throw new HttpsError("internal", "Failed to delete account");
    }
  }
);

// =====================================================
// 餐廳訂餐 API
// =====================================================

exports.createOrder = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, merchantId, items, pickupTime, note, paymentMethod } = request.data;

    if (!schoolId || !merchantId || !items || items.length === 0) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = Math.round(subtotal * 0.05);
    const total = subtotal + tax;

    const orderRef = await db.collection("schools").doc(schoolId).collection("orders").add({
      userId: uid,
      merchantId,
      items,
      subtotal,
      tax,
      total,
      pickupTime: pickupTime || null,
      note: note || null,
      paymentMethod: paymentMethod || "campus_card",
      status: "pending",
      paymentStatus: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      orderId: orderRef.id,
      total,
    };
  }
);

exports.updateOrderStatus = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, orderId, status } = request.data;

    if (!schoolId || !orderId || !status) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const validStatuses = ["confirmed", "preparing", "ready", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      throw new HttpsError("invalid-argument", "Invalid status");
    }

    const orderRef = db.collection("schools").doc(schoolId).collection("orders").doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      throw new HttpsError("not-found", "Order not found");
    }

    const order = orderDoc.data();
    
    if (order.status === "cancelled" || order.status === "completed") {
      throw new HttpsError("failed-precondition", "Cannot update completed or cancelled orders");
    }

    await orderRef.update({
      status,
      [`${status}At`]: FieldValue.serverTimestamp(),
    });

    if (["ready", "cancelled"].includes(status)) {
      await sendPushToUser(order.userId, {
        title: status === "ready" ? "🍽️ 餐點已備妥" : "❌ 訂單已取消",
        body: status === "ready" ? "您的餐點已準備完成，請前往取餐" : "您的訂單已被取消",
      }, {
        type: "order",
        orderId,
        schoolId,
        channel: "orders",
      });
    }

    return { success: true };
  }
);

exports.cancelOrder = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, orderId, reason } = request.data;

    if (!schoolId || !orderId) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const orderRef = db.collection("schools").doc(schoolId).collection("orders").doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      throw new HttpsError("not-found", "Order not found");
    }

    const order = orderDoc.data();

    if (order.userId !== uid) {
      throw new HttpsError("permission-denied", "This is not your order");
    }

    if (["preparing", "ready", "completed"].includes(order.status)) {
      throw new HttpsError("failed-precondition", "Cannot cancel order in this status");
    }

    await orderRef.update({
      status: "cancelled",
      cancelledAt: FieldValue.serverTimestamp(),
      cancelReason: reason || "User cancelled",
    });

    return { success: true };
  }
);

// =====================================================
// 宿舍服務 API
// =====================================================

exports.submitRepairRequest = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, dormitory, room, category, description, urgency, images } = request.data;

    if (!schoolId || !dormitory || !room || !category || !description) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const repairRef = await db.collection("schools").doc(schoolId).collection("repairRequests").add({
      userId: uid,
      dormitory,
      room,
      category,
      description,
      urgency: urgency || "normal",
      images: images || [],
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      requestId: repairRef.id,
    };
  }
);

exports.updateRepairStatus = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, requestId, status, note } = request.data;

    if (!schoolId || !requestId || !status) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const validStatuses = ["pending", "assigned", "in_progress", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      throw new HttpsError("invalid-argument", "Invalid status");
    }

    const requestRef = db.collection("schools").doc(schoolId).collection("repairRequests").doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      throw new HttpsError("not-found", "Repair request not found");
    }

    await requestRef.update({
      status,
      staffNote: note || null,
      [`${status}At`]: FieldValue.serverTimestamp(),
    });

    const repairData = requestDoc.data();
    if (["assigned", "completed"].includes(status)) {
      await sendPushToUser(repairData.userId, {
        title: status === "assigned" ? "🔧 報修已受理" : "✅ 報修已完成",
        body: status === "assigned" ? "您的報修已派員處理" : "您的報修已完成，請確認",
      }, {
        type: "repair",
        requestId,
        schoolId,
        channel: "dormitory",
      });
    }

    return { success: true };
  }
);

exports.registerPackageArrival = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, recipientId, trackingNumber, courier, location, locker } = request.data;

    if (!schoolId || !recipientId) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const packageRef = await db.collection("schools").doc(schoolId).collection("packages").add({
      recipientId,
      trackingNumber: trackingNumber || null,
      courier: courier || "unknown",
      location: location || "管理室",
      locker: locker || null,
      status: "arrived",
      registeredBy: uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    await sendPushToUser(recipientId, {
      title: "📦 包裹到了！",
      body: locker ? `您的包裹已放入 ${locker}，請儘快領取` : `您的包裹已到達 ${location}，請儘快領取`,
    }, {
      type: "package",
      packageId: packageRef.id,
      schoolId,
      channel: "dormitory",
    });

    return {
      success: true,
      packageId: packageRef.id,
    };
  }
);

exports.confirmPackagePickup = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, packageId } = request.data;

    if (!schoolId || !packageId) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const packageRef = db.collection("schools").doc(schoolId).collection("packages").doc(packageId);
    const packageDoc = await packageRef.get();

    if (!packageDoc.exists) {
      throw new HttpsError("not-found", "Package not found");
    }

    if (packageDoc.data().recipientId !== uid) {
      throw new HttpsError("permission-denied", "This is not your package");
    }

    await packageRef.update({
      status: "picked_up",
      pickedUpAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
  }
);

exports.reserveWashingMachine = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, dormitory, machineId, startTime } = request.data;

    if (!schoolId || !dormitory || !machineId || !startTime) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const existingReservation = await db.collection("schools").doc(schoolId)
      .collection("washingReservations")
      .where("machineId", "==", machineId)
      .where("startTime", "==", startTime)
      .where("status", "==", "active")
      .get();

    if (!existingReservation.empty) {
      throw new HttpsError("already-exists", "This time slot is already reserved");
    }

    const reservationRef = await db.collection("schools").doc(schoolId).collection("washingReservations").add({
      userId: uid,
      dormitory,
      machineId,
      startTime,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      reservationId: reservationRef.id,
    };
  }
);

// =====================================================
// 列印服務 API
// =====================================================

exports.submitPrintJob = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, printerId, fileName, fileUrl, copies, color, duplex, pages } = request.data;

    if (!schoolId || !printerId || !fileName || !fileUrl) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const pageCount = pages || 1;
    const copyCount = copies || 1;
    const isColor = color || false;
    const isDuplex = duplex || false;

    const pricePerPage = isColor ? 5 : 1;
    const totalPages = pageCount * copyCount;
    const cost = totalPages * pricePerPage;

    const jobRef = await db.collection("schools").doc(schoolId).collection("printJobs").add({
      userId: uid,
      printerId,
      fileName,
      fileUrl,
      copies: copyCount,
      color: isColor,
      duplex: isDuplex,
      pages: pageCount,
      totalPages,
      cost,
      status: "queued",
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      jobId: jobRef.id,
      cost,
      estimatedTime: Math.ceil(totalPages / 10),
    };
  }
);

exports.updatePrintJobStatus = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, jobId, status } = request.data;

    if (!schoolId || !jobId || !status) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const validStatuses = ["queued", "printing", "completed", "failed", "cancelled"];
    if (!validStatuses.includes(status)) {
      throw new HttpsError("invalid-argument", "Invalid status");
    }

    const jobRef = db.collection("schools").doc(schoolId).collection("printJobs").doc(jobId);
    const jobDoc = await jobRef.get();

    if (!jobDoc.exists) {
      throw new HttpsError("not-found", "Print job not found");
    }

    await jobRef.update({
      status,
      [`${status}At`]: FieldValue.serverTimestamp(),
    });

    const jobData = jobDoc.data();
    if (status === "completed") {
      await sendPushToUser(jobData.userId, {
        title: "🖨️ 列印完成",
        body: `${jobData.fileName} 已列印完成，請前往取件`,
      }, {
        type: "print",
        jobId,
        schoolId,
        channel: "print",
      });
    }

    return { success: true };
  }
);

exports.cancelPrintJob = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, jobId } = request.data;

    if (!schoolId || !jobId) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const jobRef = db.collection("schools").doc(schoolId).collection("printJobs").doc(jobId);
    const jobDoc = await jobRef.get();

    if (!jobDoc.exists) {
      throw new HttpsError("not-found", "Print job not found");
    }

    if (jobDoc.data().userId !== uid) {
      throw new HttpsError("permission-denied", "This is not your print job");
    }

    if (jobDoc.data().status === "printing") {
      throw new HttpsError("failed-precondition", "Cannot cancel a job that is currently printing");
    }

    await jobRef.update({
      status: "cancelled",
      cancelledAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
  }
);

// =====================================================
// 健康中心預約 API
// =====================================================

exports.bookHealthAppointment = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, date, time, department, doctorId, symptoms, note } = request.data;

    if (!schoolId || !date || !time || !department) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const existingAppointment = await db.collection("schools").doc(schoolId)
      .collection("healthAppointments")
      .where("date", "==", date)
      .where("time", "==", time)
      .where("doctorId", "==", doctorId || null)
      .where("status", "==", "scheduled")
      .get();

    if (!existingAppointment.empty) {
      throw new HttpsError("already-exists", "This time slot is already booked");
    }

    const appointmentRef = await db.collection("schools").doc(schoolId).collection("healthAppointments").add({
      userId: uid,
      date,
      time,
      department,
      doctorId: doctorId || null,
      symptoms: symptoms || null,
      note: note || null,
      status: "scheduled",
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      appointmentId: appointmentRef.id,
    };
  }
);

exports.cancelHealthAppointment = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, appointmentId, reason } = request.data;

    if (!schoolId || !appointmentId) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const appointmentRef = db.collection("schools").doc(schoolId).collection("healthAppointments").doc(appointmentId);
    const appointmentDoc = await appointmentRef.get();

    if (!appointmentDoc.exists) {
      throw new HttpsError("not-found", "Appointment not found");
    }

    if (appointmentDoc.data().userId !== uid) {
      throw new HttpsError("permission-denied", "This is not your appointment");
    }

    await appointmentRef.update({
      status: "cancelled",
      cancelReason: reason || null,
      cancelledAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
  }
);

exports.getHealthRecords = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, limit: queryLimit } = request.data;

    if (!schoolId) {
      throw new HttpsError("invalid-argument", "Missing schoolId");
    }

    const recordsSnap = await db.collection("schools").doc(schoolId)
      .collection("healthRecords")
      .where("userId", "==", uid)
      .orderBy("visitDate", "desc")
      .limit(queryLimit || 20)
      .get();

    return {
      records: recordsSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
    };
  }
);

// =====================================================
// 校車服務 API
// =====================================================

exports.getBusArrivals = onCall(
  {
    region: REGION,
    secrets: [TDX_CLIENT_ID, TDX_CLIENT_SECRET],
  },
  async (request) => {
    const { schoolId, stopId, city, routeId } = request.data;

    if (!schoolId || !stopId) {
      throw new HttpsError("invalid-argument", "Missing schoolId or stopId");
    }

    const cacheRef = db.collection("busArrivals").doc(`${schoolId}_${stopId}`);
    const CACHE_TTL_MS = 60 * 1000; // 60 秒 Cache

    // 讀取 Firestore Cache
    const cached = await cacheRef.get().catch(() => null);
    if (cached && cached.exists) {
      const cacheData = cached.data();
      const cacheAge = Date.now() - (cacheData.cachedAt?.toMillis() ?? 0);
      if (cacheAge < CACHE_TTL_MS) {
        console.log(`[getBusArrivals] Cache hit for ${stopId}`);
        return { arrivals: cacheData.arrivals, fromCache: true };
      }
    }

    // 嘗試呼叫 TDX API
    const clientId = TDX_CLIENT_ID.value();
    const clientSecret = TDX_CLIENT_SECRET.value();

    if (!clientId || !clientSecret) {
      // 沒有 TDX 金鑰：回傳靜態資料
      const staticSnap = await db.collection("busArrivals")
        .where("schoolId", "==", schoolId)
        .where("stopId", "==", stopId)
        .orderBy("estimatedArrival", "asc")
        .limit(10)
        .get()
        .catch(() => ({ docs: [] }));
      return {
        arrivals: staticSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        fromCache: false,
        noApiKey: true,
      };
    }

    try {
      const accessToken = await getTdxAccessToken(clientId, clientSecret);
      const cityCode = city ?? "Taipei";
      const apiPath = routeId
        ? `/api/basic/v3/Bus/EstimatedTimeOfArrival/City/${cityCode}/${encodeURIComponent(routeId)}?%24filter=StopUID%20eq%20'${encodeURIComponent(stopId)}'&%24format=JSON&%24top=20`
        : `/api/basic/v3/Bus/EstimatedTimeOfArrival/City/${cityCode}?%24filter=StopUID%20eq%20'${encodeURIComponent(stopId)}'&%24format=JSON&%24top=20`;

      const tdxData = await fetchTdxApi(apiPath, accessToken);
      const arrivals = Array.isArray(tdxData) ? tdxData.map((item) => ({
        routeId: item.RouteID ?? routeId,
        routeName: item.RouteName?.Zh_tw ?? item.RouteUID ?? "—",
        stopId: item.StopUID ?? stopId,
        stopName: item.StopName?.Zh_tw ?? "—",
        estimatedArrival: item.EstimateTime != null ? item.EstimateTime : null, // 秒數
        plateNo: item.PlateNumb ?? null,
        status: item.StopStatus ?? 0,
        direction: item.Direction ?? 0,
        fetchedAt: new Date().toISOString(),
      })) : [];

      // 寫入 Firestore Cache
      await cacheRef.set({
        schoolId, stopId,
        arrivals,
        cachedAt: FieldValue.serverTimestamp(),
      }).catch((e) => console.warn("[getBusArrivals] Cache write failed:", e));

      console.log(`[getBusArrivals] TDX fetch OK: ${arrivals.length} arrivals for ${stopId}`);
      return { arrivals, fromCache: false };
    } catch (err) {
      console.error("[getBusArrivals] TDX API error:", err);
      // 回傳 Firestore 靜態資料作為 fallback
      const staticSnap = await db.collection("busArrivals")
        .where("schoolId", "==", schoolId)
        .where("stopId", "==", stopId)
        .limit(10)
        .get()
        .catch(() => ({ docs: [] }));
      return {
        arrivals: staticSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        fromCache: false,
        error: "TDX API unavailable, using static data",
      };
    }
  }
);

exports.subscribeBusAlert = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { schoolId, routeId, stopId, alertBefore } = request.data;

    if (!schoolId || !routeId || !stopId) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const alertRef = await db.collection("users").doc(uid).collection("busAlerts").add({
      schoolId,
      routeId,
      stopId,
      alertBefore: alertBefore || 5,
      enabled: true,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      alertId: alertRef.id,
    };
  }
);

exports.unsubscribeBusAlert = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { alertId } = request.data;

    if (!alertId) {
      throw new HttpsError("invalid-argument", "Missing alertId");
    }

    const alertRef = db.collection("users").doc(uid).collection("busAlerts").doc(alertId);
    const alertDoc = await alertRef.get();

    if (!alertDoc.exists) {
      throw new HttpsError("not-found", "Alert not found");
    }

    await alertRef.delete();

    return { success: true };
  }
);

exports.busArrivalReminder = onSchedule(
  {
    schedule: "every 1 minutes",
    region: REGION,
    timeZone: "Asia/Taipei",
  },
  async () => {
    console.log("Running bus arrival reminder check...");

    const now = new Date();
    const alertsSnap = await db.collectionGroup("busAlerts")
      .where("enabled", "==", true)
      .get();

    let sentCount = 0;

    for (const alertDoc of alertsSnap.docs) {
      const alert = alertDoc.data();
      const userId = alertDoc.ref.parent.parent.id;

      const arrivalsSnap = await db.collection("schools").doc(alert.schoolId)
        .collection("busArrivals")
        .where("stopId", "==", alert.stopId)
        .where("routeId", "==", alert.routeId)
        .orderBy("estimatedArrival", "asc")
        .limit(1)
        .get();

      if (arrivalsSnap.empty) continue;

      const arrival = arrivalsSnap.docs[0].data();
      const arrivalTime = arrival.estimatedArrival.toDate();
      const minutesUntilArrival = (arrivalTime - now) / 1000 / 60;

      if (minutesUntilArrival > 0 && minutesUntilArrival <= alert.alertBefore) {
        const lastNotified = alertDoc.data().lastNotifiedAt?.toDate();
        if (lastNotified && (now - lastNotified) < 10 * 60 * 1000) {
          continue;
        }

        await sendPushToUser(userId, {
          title: "🚌 公車即將到站",
          body: `${arrival.routeName || "校車"} 將在約 ${Math.ceil(minutesUntilArrival)} 分鐘後到達 ${arrival.stopName || "您訂閱的站點"}`,
        }, {
          type: "bus_arrival",
          routeId: alert.routeId,
          stopId: alert.stopId,
          channel: "bus",
        });

        await alertDoc.ref.update({
          lastNotifiedAt: FieldValue.serverTimestamp(),
        });

        sentCount++;
      }
    }

    console.log(`Bus arrival reminders sent: ${sentCount}`);
  }
);

// =====================================================
// 成績通知排程
// =====================================================

exports.gradePublishedNotification = onDocumentCreated(
  {
    document: "schools/{schoolId}/grades/{gradeId}",
    region: REGION,
  },
  async (event) => {
    const { schoolId, gradeId } = event.params;
    const grade = event.data?.data();

    if (!grade) return;

    console.log(`New grade published for user ${grade.userId}: ${grade.courseName}`);

    await sendPushToUser(grade.userId, {
      title: "📊 成績已公布",
      body: `${grade.courseName} 成績已公布：${grade.letterGrade}`,
    }, {
      type: "grade",
      gradeId,
      schoolId,
      channel: "grades",
    });
  }
);

// =====================================================
// 支付系統 API
// =====================================================

exports.processTopup = onRequest(
  {
    region: REGION,
    cors: true,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ code: "AUTH_ERROR", message: "未提供有效的認證資訊" });
      return;
    }

    const idToken = authHeader.split("Bearer ")[1];

    try {
      const { getAuth } = require("firebase-admin/auth");
      const auth = getAuth();
      const decodedToken = await auth.verifyIdToken(idToken);
      const uid = decodedToken.uid;

      const { userId, amount, paymentMethod } = req.body;

      if (userId !== uid) {
        res.status(403).json({ code: "PERMISSION_DENIED", message: "無法為其他使用者儲值" });
        return;
      }

      if (!amount || typeof amount !== "number" || amount <= 0) {
        res.status(400).json({ code: "INVALID_AMOUNT", message: "無效的儲值金額" });
        return;
      }

      if (amount > 10000) {
        res.status(400).json({ code: "AMOUNT_TOO_LARGE", message: "單次儲值上限為 10,000 元" });
        return;
      }

      if (amount < 100) {
        res.status(400).json({ code: "AMOUNT_TOO_SMALL", message: "最低儲值金額為 100 元" });
        return;
      }

      const validPaymentMethods = ["credit_card", "line_pay", "jko_pay", "apple_pay", "google_pay", "bank_transfer"];
      if (!validPaymentMethods.includes(paymentMethod)) {
        res.status(400).json({ code: "INVALID_PAYMENT_METHOD", message: "不支援的付款方式" });
        return;
      }

      const userRef = db.collection("users").doc(uid);
      const transactionsRef = db.collection("transactions");

      const result = await db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        
        if (!userDoc.exists) {
          throw new Error("USER_NOT_FOUND");
        }

        const userData = userDoc.data();
        const currentBalance = userData.balance || 0;
        const newBalance = currentBalance + amount;

        const transactionDoc = transactionsRef.doc();
        
        transaction.update(userRef, {
          balance: newBalance,
          lastTopupAt: FieldValue.serverTimestamp(),
        });

        transaction.set(transactionDoc, {
          userId: uid,
          type: "topup",
          amount: amount,
          paymentMethod: paymentMethod,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          status: "completed",
          createdAt: FieldValue.serverTimestamp(),
        });

        return {
          transactionId: transactionDoc.id,
          newBalance: newBalance,
        };
      });

      console.log(`Topup completed: user ${uid}, amount ${amount}, new balance ${result.newBalance}`);

      res.json({
        success: true,
        transactionId: result.transactionId,
        newBalance: result.newBalance,
      });

    } catch (error) {
      console.error("processTopup error:", error);
      
      if (error.message === "USER_NOT_FOUND") {
        res.status(404).json({ code: "USER_NOT_FOUND", message: "找不到使用者" });
        return;
      }

      res.status(500).json({ 
        code: "SERVER_ERROR", 
        message: "伺服器錯誤，請稍後再試" 
      });
    }
  }
);

exports.processPayment = onRequest(
  {
    region: REGION,
    cors: true,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ code: "AUTH_ERROR", message: "未提供有效的認證資訊" });
      return;
    }

    const idToken = authHeader.split("Bearer ")[1];

    try {
      const { getAuth } = require("firebase-admin/auth");
      const auth = getAuth();
      const decodedToken = await auth.verifyIdToken(idToken);
      const uid = decodedToken.uid;

      const { userId, amount, paymentMethod, merchantId, description } = req.body;

      if (userId !== uid) {
        res.status(403).json({ code: "PERMISSION_DENIED", message: "無法為其他使用者付款" });
        return;
      }

      if (!amount || typeof amount !== "number" || amount <= 0) {
        res.status(400).json({ code: "INVALID_AMOUNT", message: "無效的付款金額" });
        return;
      }

      if (!merchantId) {
        res.status(400).json({ code: "INVALID_MERCHANT", message: "未指定商家" });
        return;
      }

      const validPaymentMethods = ["campus_card", "credit_card", "line_pay", "jko_pay", "apple_pay", "google_pay"];
      if (!validPaymentMethods.includes(paymentMethod)) {
        res.status(400).json({ code: "INVALID_PAYMENT_METHOD", message: "不支援的付款方式" });
        return;
      }

      const userRef = db.collection("users").doc(uid);
      const transactionsRef = db.collection("transactions");

      const result = await db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        
        if (!userDoc.exists) {
          throw new Error("USER_NOT_FOUND");
        }

        const userData = userDoc.data();
        const currentBalance = userData.balance || 0;

        if (paymentMethod === "campus_card" && currentBalance < amount) {
          throw new Error("INSUFFICIENT_BALANCE");
        }

        const newBalance = paymentMethod === "campus_card" 
          ? currentBalance - amount 
          : currentBalance;

        const transactionDoc = transactionsRef.doc();
        
        if (paymentMethod === "campus_card") {
          transaction.update(userRef, {
            balance: newBalance,
            lastPaymentAt: FieldValue.serverTimestamp(),
          });
        }

        transaction.set(transactionDoc, {
          userId: uid,
          type: "payment",
          amount: -amount,
          paymentMethod: paymentMethod,
          merchantId: merchantId,
          description: description || "",
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          status: "completed",
          createdAt: FieldValue.serverTimestamp(),
        });

        return {
          transactionId: transactionDoc.id,
          newBalance: newBalance,
        };
      });

      console.log(`Payment completed: user ${uid}, amount ${amount}, merchant ${merchantId}`);

      res.json({
        success: true,
        transactionId: result.transactionId,
        newBalance: result.newBalance,
      });

    } catch (error) {
      console.error("processPayment error:", error);
      
      if (error.message === "USER_NOT_FOUND") {
        res.status(404).json({ code: "USER_NOT_FOUND", message: "找不到使用者" });
        return;
      }

      if (error.message === "INSUFFICIENT_BALANCE") {
        res.status(400).json({ code: "INSUFFICIENT_BALANCE", message: "餘額不足" });
        return;
      }

      res.status(500).json({ 
        code: "SERVER_ERROR", 
        message: "伺服器錯誤，請稍後再試" 
      });
    }
  }
);

exports.getBalance = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    try {
      const userDoc = await db.collection("users").doc(uid).get();
      
      if (!userDoc.exists) {
        throw new HttpsError("not-found", "User not found");
      }

      const userData = userDoc.data();
      
      return {
        balance: userData.balance || 0,
        lastTopupAt: userData.lastTopupAt?.toDate()?.toISOString() || null,
        lastPaymentAt: userData.lastPaymentAt?.toDate()?.toISOString() || null,
      };
    } catch (error) {
      console.error("getBalance error:", error);
      throw new HttpsError("internal", "Failed to get balance");
    }
  }
);

exports.getTransactionHistory = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { limit: queryLimit, type } = request.data || {};

    try {
      let transactionsQuery = db.collection("transactions")
        .where("userId", "==", uid)
        .orderBy("createdAt", "desc");
      
      if (type && ["topup", "payment", "refund"].includes(type)) {
        transactionsQuery = transactionsQuery.where("type", "==", type);
      }

      const transactionsSnap = await transactionsQuery
        .limit(queryLimit || 50)
        .get();

      return {
        transactions: transactionsSnap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate()?.toISOString(),
        })),
      };
    } catch (error) {
      console.error("getTransactionHistory error:", error);
      throw new HttpsError("internal", "Failed to get transaction history");
    }
  }
);

exports.requestRefund = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { transactionId, reason } = request.data;

    if (!transactionId) {
      throw new HttpsError("invalid-argument", "Missing transactionId");
    }

    try {
      const transactionDoc = await db.collection("transactions").doc(transactionId).get();
      
      if (!transactionDoc.exists) {
        throw new HttpsError("not-found", "Transaction not found");
      }

      const transactionData = transactionDoc.data();

      if (transactionData.userId !== uid) {
        throw new HttpsError("permission-denied", "This is not your transaction");
      }

      if (transactionData.type !== "payment") {
        throw new HttpsError("failed-precondition", "Only payments can be refunded");
      }

      if (transactionData.status === "refunded") {
        throw new HttpsError("failed-precondition", "This transaction has already been refunded");
      }

      const createdAt = transactionData.createdAt?.toDate();
      if (createdAt) {
        const hoursSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceCreation > 24) {
          throw new HttpsError("failed-precondition", "Refund window has expired (24 hours)");
        }
      }

      const refundRequestRef = await db.collection("refundRequests").add({
        userId: uid,
        transactionId,
        originalAmount: Math.abs(transactionData.amount),
        reason: reason || "",
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        refundRequestId: refundRequestRef.id,
        message: "退款申請已提交，將在 1-3 個工作天內處理",
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error("requestRefund error:", error);
      throw new HttpsError("internal", "Failed to request refund");
    }
  }
);

// =====================================================
// 成就追蹤系統 (trackAchievement)
// =====================================================

exports.trackAchievement = onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Must be logged in");

    const { achievementId, progress, schoolId } = request.data;
    if (!achievementId || progress === undefined) {
      throw new HttpsError("invalid-argument", "Missing achievementId or progress");
    }

    const ACHIEVEMENT_REQUIREMENTS = {
      navigate_first: 1, event_first: 1, event_5: 5,
      group_join: 1, post_first: 1, post_10: 10,
      credit_check: 1, course_10: 10,
      ai_chat: 1, ai_master: 50,
      streak_7: 7, streak_30: 30,
      knowledge_contributor: 5, top_questioner: 3,
    };

    const requirement = ACHIEVEMENT_REQUIREMENTS[achievementId] ?? 1;
    const wasUnlocked = progress >= requirement;

    try {
      const achievementRef = db.collection("users").doc(uid).collection("achievements").doc(achievementId);
      const existing = await achievementRef.get();
      const existingData = existing.exists ? existing.data() : null;

      const newData = {
        progress,
        unlocked: wasUnlocked,
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (wasUnlocked && !existingData?.unlockedAt) {
        newData.unlockedAt = FieldValue.serverTimestamp();
      }

      await achievementRef.set(newData, { merge: true });

      // 同步更新排行榜
      if (schoolId && wasUnlocked && !existingData?.unlocked) {
        const ACHIEVEMENT_POINTS = {
          navigate_first: 15, event_first: 25, event_5: 75,
          group_join: 20, post_first: 30, post_10: 100,
          credit_check: 20, course_10: 80,
          ai_chat: 25, ai_master: 150,
          streak_7: 100, streak_30: 300,
          knowledge_contributor: 80, top_questioner: 50,
        };
        const points = ACHIEVEMENT_POINTS[achievementId] ?? 10;

        const leaderboardRef = db.collection("schools").doc(schoolId).collection("leaderboard").doc(uid);
        await leaderboardRef.set({
          points: FieldValue.increment(points),
          displayName: (await db.collection("users").doc(uid).get()).data()?.displayName ?? "同學",
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      return { success: true, unlocked: wasUnlocked };
    } catch (error) {
      console.error("trackAchievement error:", error);
      throw new HttpsError("internal", "Failed to track achievement");
    }
  }
);

// =====================================================
// 課堂互動 - Live Session
// =====================================================

exports.startLiveSession = onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Must be logged in");

    const { groupId, classroomLat, classroomLng, qrExpiryMinutes = 5 } = request.data;
    if (!groupId) throw new HttpsError("invalid-argument", "Missing groupId");

    const memberRef = db.collection("groups").doc(groupId).collection("members").doc(uid);
    const member = await memberRef.get();
    if (!member.exists || !["owner", "instructor"].includes(member.data()?.role)) {
      throw new HttpsError("permission-denied", "Only instructors can start a live session");
    }

    const sessionId = `${new Date().toISOString().slice(0, 10)}_${Date.now()}`;
    const qrToken = `${groupId}_${sessionId}_${Math.random().toString(36).slice(2, 10)}`;
    const qrExpiresAt = new Date(Date.now() + qrExpiryMinutes * 60 * 1000);

    const liveSessionRef = db.collection("groups").doc(groupId).collection("liveSessions").doc(sessionId);
    const attendanceSessionRef = db.collection("groups").doc(groupId).collection("attendanceSessions").doc(sessionId);
    const sessionPayload = {
      sessionId,
      teacherId: uid,
      startedAt: FieldValue.serverTimestamp(),
      endedAt: null,
      active: true,
      qrToken,
      qrExpiresAt: Timestamp.fromDate(qrExpiresAt),
      ...(classroomLat && classroomLng ? { location: { lat: classroomLat, lng: classroomLng, radiusM: 100 } } : {}),
      reactions: { understood: 0, partial: 0, confused: 0 },
      attendeeCount: 0,
    };

    await Promise.all([
      liveSessionRef.set(sessionPayload),
      attendanceSessionRef.set({
        sessionId,
        liveSessionId: sessionId,
        groupId,
        teacherId: uid,
        startedAt: FieldValue.serverTimestamp(),
        endedAt: null,
        active: true,
        attendeeCount: 0,
        attendanceMode: "qr",
        source: "live_session",
        qrEnabled: true,
        ...(classroomLat && classroomLng ? { location: { lat: classroomLat, lng: classroomLng, radiusM: 100 } } : {}),
      }),
    ]);

    // 推播通知給群組成員
    const membersSnap = await db.collection("groups").doc(groupId).collection("members").get();
    const studentUids = membersSnap.docs
      .filter((d) => d.id !== uid && !["instructor", "owner"].includes(d.data()?.role))
      .map((d) => d.id);

    const groupDoc = await db.collection("groups").doc(groupId).get();
    const groupName = groupDoc.data()?.name ?? "課堂";

    const tokens = (await Promise.all(studentUids.map(getUserPushTokens))).flat().filter(Boolean);
    if (tokens.length > 0) {
      await messaging.sendEachForMulticast({
        tokens,
        notification: { title: `${groupName} 課堂開始`, body: "老師已開啟即時課堂互動，快進入！" },
        data: { type: "live_session", groupId, sessionId, click_action: "OPEN_CLASSROOM" },
      });
    }

    return { success: true, sessionId, qrToken, qrExpiresAt: qrExpiresAt.toISOString() };
  }
);

exports.endLiveSession = onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Must be logged in");

    const { groupId, sessionId } = request.data;
    if (!groupId || !sessionId) throw new HttpsError("invalid-argument", "Missing groupId or sessionId");

    const sessionRef = db.collection("groups").doc(groupId).collection("liveSessions").doc(sessionId);
    const session = await sessionRef.get();

    if (!session.exists || session.data()?.teacherId !== uid) {
      throw new HttpsError("permission-denied", "Not authorized to end this session");
    }

    await Promise.all([
      sessionRef.update({ active: false, endedAt: FieldValue.serverTimestamp() }),
      db.collection("groups").doc(groupId).collection("attendanceSessions").doc(sessionId).set({
        active: false,
        endedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
    ]);
    return { success: true };
  }
);

exports.submitPollResponse = onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Must be logged in");

    const { groupId, sessionId, pollId, optionIdx } = request.data;
    if (!groupId || !sessionId || !pollId || optionIdx === undefined) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const pollRef = db.collection("groups").doc(groupId)
      .collection("liveSessions").doc(sessionId)
      .collection("polls").doc(pollId);

    await pollRef.update({ [`responses.${uid}`]: optionIdx });
    return { success: true };
  }
);

exports.joinLiveSession = onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Must be logged in");

    const { groupId, sessionId, qrToken } = request.data;
    if (!groupId || !sessionId) throw new HttpsError("invalid-argument", "Missing required fields");

    const sessionRef = db.collection("groups").doc(groupId).collection("liveSessions").doc(sessionId);
    const session = await sessionRef.get();

    if (!session.exists || !session.data()?.active) {
      throw new HttpsError("not-found", "Session not found or not active");
    }

    if (qrToken) {
      const sessionData = session.data();
      if (sessionData.qrToken !== qrToken) {
        throw new HttpsError("permission-denied", "Invalid QR token");
      }
      if (sessionData.qrExpiresAt && sessionData.qrExpiresAt.toDate() < new Date()) {
        throw new HttpsError("deadline-exceeded", "QR code has expired");
      }
    }

    const attendanceSessionRef = db.collection("groups").doc(groupId).collection("attendanceSessions").doc(sessionId);

    await db.runTransaction(async (transaction) => {
      const latestSession = await transaction.get(sessionRef);
      if (!latestSession.exists || !latestSession.data()?.active) {
        throw new HttpsError("not-found", "Session not found or not active");
      }

      const latestSessionData = latestSession.data();
      const alreadyJoined = !!latestSessionData?.attendees?.[uid];
      const sessionUpdates = {
        [`attendees.${uid}`]: FieldValue.serverTimestamp(),
      };

      if (!alreadyJoined) {
        sessionUpdates.attendeeCount = FieldValue.increment(1);
      }

      transaction.update(sessionRef, sessionUpdates);
      transaction.set(
        attendanceSessionRef,
        {
          sessionId,
          liveSessionId: sessionId,
          groupId,
          teacherId: latestSessionData.teacherId,
          startedAt: latestSessionData.startedAt || FieldValue.serverTimestamp(),
          active: latestSessionData.active,
          attendanceMode: "qr",
          source: "live_session",
          ...(qrToken ? { qrEnabled: true } : {}),
          ...(latestSessionData.location ? { location: latestSessionData.location } : {}),
          [`attendees.${uid}`]: FieldValue.serverTimestamp(),
          ...(alreadyJoined ? {} : { attendeeCount: FieldValue.increment(1) }),
        },
        { merge: true }
      );
      transaction.set(
        attendanceSessionRef.collection("attendanceRecords").doc(uid),
        {
          uid,
          status: "present",
          source: qrToken ? "qr" : "tap",
          checkedInAt: FieldValue.serverTimestamp(),
          sessionId,
          groupId,
        },
        { merge: true }
      );
    });

    return { success: true };
  }
);

exports.submitReaction = onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Must be logged in");

    const { groupId, sessionId, reaction } = request.data;
    if (!groupId || !sessionId || !["understood", "partial", "confused"].includes(reaction)) {
      throw new HttpsError("invalid-argument", "Invalid reaction");
    }

    const sessionRef = db.collection("groups").doc(groupId).collection("liveSessions").doc(sessionId);
    const userReactionRef = sessionRef.collection("userReactions").doc(uid);

    const existing = await userReactionRef.get();
    const updates = { [`reactions.${reaction}`]: FieldValue.increment(1) };

    if (existing.exists && existing.data()?.reaction) {
      updates[`reactions.${existing.data().reaction}`] = FieldValue.increment(-1);
    }

    await Promise.all([
      sessionRef.update(updates),
      userReactionRef.set({ reaction, updatedAt: FieldValue.serverTimestamp() }),
    ]);

    return { success: true };
  }
);

// =====================================================
// AI 每日簡報 (generateDailyBrief) - 每日 07:30
// =====================================================

exports.generateDailyBrief = onSchedule(
  { schedule: "30 7 * * *", region: REGION, timeZone: "Asia/Taipei" },
  async () => {
    const today = new Date().toISOString().slice(0, 10);
    console.log(`[generateDailyBrief] Running for ${today}`);

    try {
      const usersSnap = await db.collection("users").where("role", "in", ["student", "teacher"]).limit(500).get();

      await Promise.allSettled(
        usersSnap.docs.map(async (userDoc) => {
          const uid = userDoc.id;
          const userData = userDoc.data();

          // 取得用戶的課程（從 AsyncStorage 無法在後端讀，改由用戶 Firestore profile 存）
          const schoolId = userData.schoolId;
          if (!schoolId) return;

          // 取得今日課程 (透過 schedule subcollection 或 直接從 groups 取)
          const todayDOW = new Date().getDay();
          const briefParts = [];

          // 統計今日課程（查詢用戶加入的所有群組 members 紀錄）
          const memberSnap = await db.collectionGroup("members")
            .where("uid", "==", uid)
            .limit(20)
            .get()
            .catch(() => ({ docs: [] }));

          if (memberSnap.docs.length > 0) {
            briefParts.push(`今天你已加入 ${memberSnap.docs.length} 個學習群組。`);
          }

          // 取得最新公告（頂層 announcements 集合，依 schoolId 篩選）
          const announcementsSnap = await db.collection("announcements")
            .where("schoolId", "==", schoolId)
            .orderBy("publishedAt", "desc")
            .limit(2)
            .get()
            .catch(() => ({ docs: [] }));

          if (announcementsSnap.docs.length > 0) {
            const titles = announcementsSnap.docs.map((d) => d.data().title).filter(Boolean);
            if (titles.length > 0) {
              briefParts.push(`最新公告：${titles.slice(0, 2).join("、")}。`);
            }
          }

          if (briefParts.length === 0) {
            briefParts.push("今天也要加油！有任何問題可以問 AI 助理。");
          }

          const content = briefParts.join(" ");

          await db.collection("users").doc(uid).collection("dailyBriefs").doc(today).set({
            content,
            generatedAt: FieldValue.serverTimestamp(),
            date: today,
          });
        })
      );

      console.log(`[generateDailyBrief] Completed for ${usersSnap.docs.length} users`);
    } catch (error) {
      console.error("[generateDailyBrief] Error:", error);
    }
  }
);

// =====================================================
// 學習週報 (generateWeeklyReport) - 每週日 22:00
// =====================================================

exports.generateWeeklyReport = onSchedule(
  { schedule: "0 22 * * 0", region: REGION, timeZone: "Asia/Taipei" },
  async () => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 6);
    const weekId = `${weekStart.toISOString().slice(0, 10)}_${now.toISOString().slice(0, 10)}`;

    console.log(`[generateWeeklyReport] Running for week ${weekId}`);

    try {
      const usersSnap = await db.collection("users").where("role", "==", "student").limit(500).get();

      await Promise.allSettled(
        usersSnap.docs.map(async (userDoc) => {
          const uid = userDoc.id;
          const userData = userDoc.data();
          const schoolId = userData.schoolId;
          if (!schoolId) return;

          // 統計本週成就解鎖數
          const achievementsSnap = await db.collection("users").doc(uid).collection("achievements")
            .where("unlocked", "==", true)
            .where("updatedAt", ">=", Timestamp.fromDate(weekStart))
            .get()
            .catch(() => ({ docs: [] }));

          const newAchievements = achievementsSnap.docs.length;

          // 統計本週作業繳交情況
          const submissionsSnap = await db.collectionGroup("submissions")
            .where("uid", "==", uid)
            .where("submittedAt", ">=", Timestamp.fromDate(weekStart))
            .get()
            .catch(() => ({ docs: [] }));

          const totalSubmissions = submissionsSnap.docs.length;
          const onTimeSubmissions = submissionsSnap.docs.filter((d) => !d.data().isLate).length;
          const onTimeRate = totalSubmissions > 0
            ? Math.round((onTimeSubmissions / totalSubmissions) * 100)
            : 100;

          const summaryParts = [];
          if (newAchievements > 0) summaryParts.push(`解鎖了 ${newAchievements} 個新成就`);
          if (totalSubmissions > 0) summaryParts.push(`完成了 ${totalSubmissions} 份作業，準時率 ${onTimeRate}%`);

          const summary = summaryParts.length > 0
            ? `本週你${summaryParts.join("、")}。繼續保持！`
            : "本週繼續努力，下週會更好！";

          await db.collection("users").doc(uid).collection("weeklyReports").doc(weekId).set({
            weekId,
            weekStart: Timestamp.fromDate(weekStart),
            weekEnd: Timestamp.fromDate(now),
            summary,
            stats: {
              newAchievements,
              totalSubmissions,
              onTimeSubmissions,
              onTimeRate,
            },
            generatedAt: FieldValue.serverTimestamp(),
          });

          // 推播通知
          const tokens = await getUserPushTokens(uid);
          if (tokens.length > 0) {
            await messaging.sendEachForMulticast({
              tokens,
              notification: {
                title: "📊 本週學習報告出爐了！",
                body: summary,
              },
              data: { type: "weekly_report", weekId },
            }).catch(() => {});
          }
        })
      );

      console.log(`[generateWeeklyReport] Completed for week ${weekId}`);
    } catch (error) {
      console.error("[generateWeeklyReport] Error:", error);
    }
  }
);

console.log("Firebase Cloud Functions loaded successfully");
