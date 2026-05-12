/** Firestore paths for campus social + messaging extensions (aligned with backend rules). */

export function campusPostDocPath(schoolId: string, postId: string) {
  return `schools/${schoolId}/campusPosts/${postId}` as const;
}

export function campusReplyDocPath(schoolId: string, postId: string, replyId: string) {
  return `schools/${schoolId}/campusPosts/${postId}/replies/${replyId}` as const;
}

export function lbsPresenceDocPath(schoolId: string, sessionId: string) {
  return `schools/${schoolId}/lbsPresence/${sessionId}` as const;
}

export function friendshipDocPath(id: string) {
  return `friendships/${id}` as const;
}

export function followDocPath(id: string) {
  return `follows/${id}` as const;
}

export function storyDocPath(storyId: string) {
  return `campusStories/${storyId}` as const;
}

export function storyViewDocPath(storyId: string, viewerUid: string) {
  return `campusStories/${storyId}/storyViews/${viewerUid}` as const;
}

export function campusReportPath(reportId: string) {
  return `campusReports/${reportId}` as const;
}

export function userBlockedPath(uid: string, blockedUid: string) {
  return `users/${uid}/blockedUsers/${blockedUid}`;
}

export function userKeepPath(uid: string, keepId: string) {
  return `users/${uid}/keeps/${keepId}`;
}

export function campusPostStoragePath(schoolId: string, postId: string, fileName: string) {
  return `schools/${schoolId}/campusPosts/${postId}/${fileName}`;
}

export function storyStoragePath(schoolId: string, storyId: string, fileName: string) {
  return `schools/${schoolId}/stories/${storyId}/${fileName}`;
}

export function conversationMediaPath(conversationId: string, uploadId: string, fileName: string) {
  return `conversations/${conversationId}/media/${uploadId}/${fileName}`;
}
