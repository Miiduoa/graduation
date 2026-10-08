import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getFunctionsInstance, isFirebaseMockMode } from '../firebase';
export type CampusAssistantMessage = { role: 'user' | 'assistant'; content: string };
export type CampusAssistantScope = { uid: string; schoolId: string };

export async function askCampusAssistant(input: {
  scope: CampusAssistantScope;
  messages: CampusAssistantMessage[];
  isCurrent: () => boolean;
}): Promise<{ content: string; hasActions: boolean }> {
  const check = () => {
    if (
      !input.isCurrent() ||
      isFirebaseMockMode() ||
      !input.scope.uid ||
      !input.scope.schoolId ||
      getAuthInstance().currentUser?.uid !== input.scope.uid
    )
      throw new Error('Assistant session changed');
  };
  check();
  const messages = input.messages
    .slice(-20)
    .map((message) => ({ role: message.role, content: message.content.trim().slice(0, 1600) }));
  if (
    !messages.length ||
    messages[messages.length - 1].role !== 'user' ||
    !messages[messages.length - 1].content
  )
    throw new Error('Missing question');
  const callable = httpsCallable<
    unknown,
    { content?: string; error?: unknown; actions?: unknown[]; run?: { status?: string } }
  >(getFunctionsInstance(), 'askCampusAssistant');
  const result = await callable({
    messages,
    context: {
      schoolId: input.scope.schoolId,
      screen: 'campus-assistant',
      locale: 'zh-TW',
      timezone: 'Asia/Taipei',
    },
  });
  check();
  if (
    result.data.error ||
    !['completed', 'blocked'].includes(result.data.run?.status ?? '') ||
    typeof result.data.content !== 'string' ||
    !result.data.content.trim()
  )
    throw new Error('Assistant reply not confirmed');
  return {
    content: result.data.content.trim(),
    hasActions: Array.isArray(result.data.actions) && result.data.actions.length > 0,
  };
}
