'use strict';

function createUserProfileChangedHandler({
  syncAuthClaims,
  syncDirectoryEntriesForUser,
  log = console,
}) {
  return async function onUserProfileChanged(event) {
    const uid = event.params.uid;
    const afterData = event.data.after?.data();

    if (!afterData) {
      await syncDirectoryEntriesForUser(uid, null);
      return;
    }

    try {
      await syncAuthClaims(uid, afterData);
    } catch (error) {
      log.error('Failed to sync auth claims:', error);
    }

    try {
      await syncDirectoryEntriesForUser(uid, afterData);
    } catch (error) {
      log.error('Failed to sync school directory entries:', error);
    }
  };
}

function createSchoolMembershipChangedHandler({ syncSchoolDirectoryEntry, log = console }) {
  return async function onSchoolMembershipChanged(event) {
    const { schoolId, uid } = event.params;
    const membership = event.data.after?.data() || null;

    try {
      await syncSchoolDirectoryEntry({
        schoolId,
        uid,
        membership,
      });
    } catch (error) {
      log.error('Failed to sync school directory membership:', error);
    }
  };
}

function createCafeteriaOperatorChangedHandler({ syncCafeteriaOperatorCount, log = console }) {
  return async function onCafeteriaOperatorChanged(event) {
    const { schoolId, cafeteriaId } = event.params;

    try {
      await syncCafeteriaOperatorCount(schoolId, cafeteriaId);
    } catch (error) {
      log.error('Failed to sync cafeteria operator count:', error);
    }
  };
}

function createGroupQuestionAssistantReplyTrigger({ handleGroupQuestion }) {
  return async function groupQuestionAssistantReply(event) {
    const { groupId, postId } = event.params;
    await handleGroupQuestion({ groupId, postId, post: event.data?.data() });
  };
}

function createGradePublishedNotificationHandler({ sendPushToUser, log = console }) {
  return async function gradePublishedNotification(event) {
    const { schoolId, gradeId } = event.params;
    const grade = event.data?.data();

    if (!grade) return;

    log.log(`New grade published for user ${grade.userId}: ${grade.courseName}`);

    await sendPushToUser(
      grade.userId,
      {
        title: '📊 成績已公布',
        body: `${grade.courseName} 成績已公布：${grade.letterGrade}`,
      },
      {
        type: 'grade',
        gradeId,
        schoolId,
        channel: 'grades',
      },
    );
  };
}

module.exports = {
  createUserProfileChangedHandler,
  createSchoolMembershipChangedHandler,
  createCafeteriaOperatorChangedHandler,
  createGroupQuestionAssistantReplyTrigger,
  createGradePublishedNotificationHandler,
};
