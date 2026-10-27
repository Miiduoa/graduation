/**
 * Model-family chat templates for the GGUF backends supported by Campus One.
 *
 * Keep prompt construction independent of native llama.rn so differences among
 * tokenizers can be regression tested without model downloads or paid APIs.
 */
export type LocalPromptMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
};

function phiChat(messages: readonly LocalPromptMessage[]): string {
  let result = '';
  for (const message of messages) {
    if (message.role === 'tool') {
      result += `<|user|>\n[工具 ${message.name || 'unknown'} 回傳]\n${message.content}<|end|>\n`;
    } else {
      result += `<|${message.role}|>\n${message.content}<|end|>\n`;
    }
  }
  return result + '<|assistant|>\n';
}

/** Mistral v0.3 uses tokenizer V3 ([INST]), not Qwen's ChatML. */
function mistralChat(messages: readonly LocalPromptMessage[]): string {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');
  const conversation = messages.filter((message) => message.role !== 'system');
  let prefix = system;
  let result = '';
  for (const message of conversation) {
    if (message.role === 'assistant') {
      result += `${message.content}</s>`;
      continue;
    }
    const toolResult = message.role === 'tool'
      ? `[工具 ${message.name || 'unknown'} 回傳]\n${message.content}`
      : message.content;
    const text = prefix ? `${prefix}\n\n${toolResult}` : toolResult;
    result += `${result ? '' : '<s>'}[INST]${text}[/INST]`;
    prefix = '';
  }
  if (!result && system) result = `<s>[INST]${system}[/INST]`;
  return result;
}

function chatML(messages: readonly LocalPromptMessage[], qwen3: boolean): string {
  const lastUser = messages.map((message) => message.role).lastIndexOf('user');
  let result = '';
  for (const [index, message] of messages.entries()) {
    if (message.role === 'tool') {
      result += `<|im_start|>tool\nName: ${message.name || 'unknown'}\nResult: ${message.content}<|im_end|>\n`;
      continue;
    }
    const noThink = qwen3 && message.role === 'user' && index === lastUser ? '\n/no_think' : '';
    result += `<|im_start|>${message.role}\n${message.content}${noThink}<|im_end|>\n`;
  }
  return result + '<|im_start|>assistant\n';
}

/** The loaded model, not the last clicked model preference, chooses the template. */
export function formatLocalModelChat(
  messages: readonly LocalPromptMessage[],
  modelId: string | null | undefined,
): string {
  switch (modelId) {
    case 'mistral-7b-v0.3':
      return mistralChat(messages);
    case 'phi-3.5-mini':
      return phiChat(messages);
    default:
      return chatML(messages, modelId?.startsWith('qwen3-') === true);
  }
}

export function defaultLocalStopSequences(modelId: string | null | undefined): string[] {
  switch (modelId) {
    case 'mistral-7b-v0.3':
      return ['</s>', '[INST]'];
    case 'phi-3.5-mini':
      return ['<|end|>', '<|endoftext|>', '<|user|>'];
    default:
      return ['<|im_end|>', '<|im_start|>'];
  }
}
