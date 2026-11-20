'use client';

import { useState } from 'react';
import { answerAssistantLocally, canAnswerAssistantLocally, type LocalAssistantResult } from '@/lib/assistantLocalActions';
import { AssistantServiceLinks } from './AssistantServiceLinks';

/** Available with the older public-service assistant, independent of model credentials. */
export function AssistantLocalEntry({ owner, schoolId }: { owner: string; schoolId: string }) {
  return <LocalEntry key={JSON.stringify([owner, schoolId])} owner={owner} schoolId={schoolId} />;
}

function LocalEntry({ owner, schoolId }: { owner: string; schoolId: string }) {
  const [question, setQuestion] = useState('');
  const [reply, setReply] = useState<LocalAssistantResult | null>(null);
  return (
    <details>
      <summary style={{ minHeight: 44, paddingBlock: 12 }}>查詢課表、行程與個人紀錄</summary>
      <p>可以問「我今天有什麼課」「下一堂課在哪裡」「明天有什麼行程」，也能查看匯入成績或開啟服務。資料由這台裝置直接整理。</p>
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
