'use client';

import { useState } from 'react';
import { answerAssistantLocally, canAnswerAssistantLocally, type LocalAssistantResult } from '@/lib/assistantLocalActions';
import { AssistantServiceLinks } from './AssistantServiceLinks';

/** Available with the older public-service assistant, independent of model credentials. */
export function AssistantLocalEntry({ owner, schoolId }: { owner: string; schoolId: string }) {
  const [question, setQuestion] = useState('');
  const [reply, setReply] = useState<LocalAssistantResult | null>(null);
  return (
    <details>
      <summary style={{ minHeight: 44, paddingBlock: 12 }}>更多服務與個人匯入紀錄</summary>
      <p>可以說「開啟請假」「查看我的匯入成績」或「你能做什麼」。這些查詢由此裝置處理。</p>
      <form aria-label="裝置服務查詢" onSubmit={(event) => {
        event.preventDefault();
        const result = answerAssistantLocally(question, { owner, schoolId });
        if (result) { setReply(result); setQuestion(''); }
      }}>
        <label htmlFor="local-service-question">想開啟的服務或個人紀錄</label>
        <input id="local-service-question" value={question} maxLength={500}
          onChange={(event) => setQuestion(event.target.value)} style={{ width: '100%', minHeight: 44 }} />
        <button disabled={!canAnswerAssistantLocally(question)} style={{ minHeight: 44 }}>查詢裝置服務</button>
      </form>
      {reply && <div role="status">
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{reply.content}</p>
        <AssistantServiceLinks serviceIds={reply.serviceIds} schoolId={schoolId} audience={owner.startsWith('platform:') ? 'platform' : 'school'} />
      </div>}
    </details>
  );
}
