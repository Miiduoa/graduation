'use strict';

/**
 * 群組提問的助理回覆：由伺服器在提問建立後產生並寫入，用戶端不能寫。
 * 舊版 App 仍會嘗試自己寫，會被規則擋下；這裡照樣會替任何版本送出的提問產生回覆。
 */

const ASSISTANT_AUTHOR_ID = 'campus-assistant';
const ASSISTANT_AUTHOR_NAME = '助理回覆';
const ASSISTANT_COMMENT_ID = 'assistant';
const REPLY_NOTE = '\n\n_這是校園助理的回覆，請以老師和同學的回答為準。_';

function questionPrompt(post) {
  const title = String(post.title || '').trim().slice(0, 200);
  const body = String(post.body || '').trim().slice(0, 4000);
  return `課程問題：${title}\n\n詳細說明：${body}`;
}

/**
 * @param {{ db: FirebaseFirestore.Firestore, FieldValue: any, generate?: (input: object) => Promise<{ content?: string, error?: string } | null>, enabled?: () => boolean, log?: (...args: any[]) => void }} deps
 */
function createGroupAssistantReplyHandler(deps) {
  const log = deps.log || ((...args) => console.log(...args));
  return async function handle({ groupId, postId, post }) {
    if (!post || post.kind !== 'question' || !post.authorId) return { status: 'skipped' };
    const postRef = deps.db.doc(`groups/${groupId}/posts/${postId}`);
    const markStatus = (status, reason) =>
      postRef
        .set({ assistantReply: { status, reason: reason || null, updatedAt: deps.FieldValue.serverTimestamp() } }, { merge: true })
        .catch(() => undefined);

    if (deps.enabled && !deps.enabled()) {
      await markStatus('unavailable', 'not-configured');
      return { status: 'unavailable', reason: 'not-configured' };
    }
    if (!deps.generate) {
      await markStatus('unavailable', 'not-configured');
      return { status: 'unavailable', reason: 'not-configured' };
    }

    let content = '';
    try {
      const result = await deps.generate({
        uid: post.authorId,
        schoolId: post.schoolId || null,
        groupId,
        prompt: questionPrompt(post),
      });
      content = result && !result.error && typeof result.content === 'string' ? result.content.trim() : '';
    } catch (error) {
      log('[groupAssistantReply] generate failed', groupId, postId, error?.code || error?.message || error);
    }
    if (!content) {
      await markStatus('unavailable', 'no-answer');
      return { status: 'unavailable', reason: 'no-answer' };
    }

    const replyRef = deps.db.doc(`groups/${groupId}/posts/${postId}/comments/${ASSISTANT_COMMENT_ID}`);
    const reply = {
      body: `${content.slice(0, 6000)}${REPLY_NOTE}`,
      createdAt: deps.FieldValue.serverTimestamp(),
      authorId: ASSISTANT_AUTHOR_ID,
      authorName: ASSISTANT_AUTHOR_NAME,
      requestedBy: post.authorId,
      isAI: true,
      generatedBy: 'server',
    };
    try {
      // 固定的文件編號：同一則提問重跑也只會有一則助理回覆
      await replyRef.create(reply);
    } catch (error) {
      if (!(error?.code === 6 || /already exists/i.test(String(error?.message)))) throw error;
      const existing = await replyRef.get();
      if (existing.exists && existing.data()?.generatedBy === 'server') return { status: 'done', duplicate: true };
      // 不是伺服器寫的（例如舊規則下用戶端先佔位），用伺服器的回覆蓋掉
      await replyRef.set(reply);
      log('[groupAssistantReply] replaced a non-server assistant doc', groupId, postId);
    }
    await markStatus('done');
    return { status: 'done' };
  };
}

/** 用伺服器端的校園助理產生回覆，身分用發問的人，只看得到他本來就看得到的資料。 */
async function generateWithCampusAssistant({ uid, schoolId, groupId, prompt }) {
  const { runCampusAssistantWithAgentRuntime } = require('./agent/runtime');
  const result = await runCampusAssistantWithAgentRuntime({
    auth: { uid, token: schoolId ? { schoolId } : {} },
    data: {
      messages: [{ role: 'user', content: prompt }],
      context: { schoolId: schoolId || null, groupId, timezone: 'Asia/Taipei', source: 'group-question' },
    },
    rawRequest: { headers: {} },
  });
  return { content: typeof result?.content === 'string' ? result.content : '', error: result?.error };
}

module.exports = {
  ASSISTANT_AUTHOR_ID,
  ASSISTANT_AUTHOR_NAME,
  ASSISTANT_COMMENT_ID,
  createGroupAssistantReplyHandler,
  generateWithCampusAssistant,
};
