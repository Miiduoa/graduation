'use strict';

/**
 * 群組提問的助理回覆：由伺服器在提問建立後產生並寫入，用戶端不能寫。
 * 舊版 App 仍會嘗試自己寫，會被規則擋下；這裡照樣會替任何版本送出的提問產生回覆。
 */

const ASSISTANT_AUTHOR_ID = 'campus-assistant';
const ASSISTANT_AUTHOR_NAME = '助理回覆';
const ASSISTANT_COMMENT_ID = 'assistant';
const REPLY_NOTE = '\n\n_這是校園助理的回覆，請以老師和同學的回答為準。_';
// 沒有金鑰、模型出錯或逾時時寫的固定說法（不拿一般校園摘要充當答案）
const ASSISTANT_FAILED_COPY = '助理暫時沒辦法回答，可以等其他同學回覆';
const DEFAULT_TIMEOUT_MS = 45000;

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

    const replyRef = deps.db.doc(`groups/${groupId}/posts/${postId}/comments/${ASSISTANT_COMMENT_ID}`);
    const writeReply = async (body) => {
      const reply = {
        body,
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
        return 'written';
      } catch (error) {
        if (!(error?.code === 6 || /already exists/i.test(String(error?.message)))) throw error;
        const existing = await replyRef.get();
        if (existing.exists && existing.data()?.generatedBy === 'server') return 'duplicate';
        // 不是伺服器寫的（例如舊規則下用戶端先佔位），用伺服器的回覆蓋掉
        await replyRef.set(reply);
        log('[groupAssistantReply] replaced a non-server assistant doc', groupId, postId);
        return 'written';
      }
    };
    const fail = async (reason) => {
      const written = await writeReply(ASSISTANT_FAILED_COPY);
      if (written === 'duplicate') return { status: 'done', duplicate: true };
      await markStatus('failed', reason);
      return { status: 'failed', reason };
    };

    if ((deps.enabled && !deps.enabled()) || !deps.generate) return fail('not-configured');

    let content = '';
    let reason = 'no-answer';
    const timeoutMs = deps.timeoutMs || DEFAULT_TIMEOUT_MS;
    let timer;
    try {
      const result = await Promise.race([
        deps.generate({
          uid: post.authorId,
          schoolId: post.schoolId || null,
          groupId,
          prompt: questionPrompt(post),
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), timeoutMs);
        }),
      ]);
      // 只接受真的由模型產生的回答
      content = result && !result.error && result.fromModel === true && typeof result.content === 'string' ? result.content.trim() : '';
      if (!content && result?.reason) reason = result.reason;
    } catch (error) {
      reason = error?.code === 'timeout' ? 'timeout' : 'model-error';
      log('[groupAssistantReply] generate failed', groupId, postId, error?.code || error?.message || error);
    } finally {
      clearTimeout(timer);
    }
    if (!content) return fail(reason);

    const written = await writeReply(`${content.slice(0, 6000)}${REPLY_NOTE}`);
    if (written === 'duplicate') return { status: 'done', duplicate: true };
    await markStatus('done');
    return { status: 'done' };
  };
}

/**
 * 直接問模型；不走校園助理的整套流程，因為那套在模型不能用時會改回一般的校園摘要。
 * 沒有金鑰或模型沒回答時回 fromModel: false，由上面寫成「暫時沒辦法回答」。
 */
async function generateWithCampusAssistant({ prompt }, { callModel } = {}) {
  const call = callModel || require('./assistantAgent').callAssistantModel;
  const result = await call({
    messages: [
      {
        role: 'system',
        content:
          '你是大學課程群組裡的助理，用台灣繁體中文簡短回答同學的課程問題。不知道或沒有根據就直接說不確定，請同學問老師，不要編造日期、成績或學校規定。',
      },
      { role: 'user', content: prompt },
    ],
  });
  const content = typeof result?.content === 'string' ? result.content.trim() : '';
  if (!content || !result?.provider || result.provider === 'none') {
    return { fromModel: false, content: '', reason: 'no-model' };
  }
  return { fromModel: true, content, provider: result.provider };
}

module.exports = {
  ASSISTANT_AUTHOR_ID,
  ASSISTANT_AUTHOR_NAME,
  ASSISTANT_COMMENT_ID,
  ASSISTANT_FAILED_COPY,
  createGroupAssistantReplyHandler,
  generateWithCampusAssistant,
};
