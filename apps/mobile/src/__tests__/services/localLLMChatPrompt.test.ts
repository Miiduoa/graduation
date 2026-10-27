import { formatLocalModelChat, defaultLocalStopSequences } from '../../services/localLLMChatPrompt';

const conversation = [
  { role: 'system' as const, content: '請用繁體中文回答' },
  { role: 'user' as const, content: '第一題' },
  { role: 'assistant' as const, content: '第一答' },
  { role: 'user' as const, content: '第二題' },
];

test('Qwen2.5 and SmolLM2 use ChatML and open the next assistant turn', () => {
  for (const model of ['qwen2.5-0.5b', 'qwen2.5-7b', 'smollm2-1.7b']) {
    const prompt = formatLocalModelChat(conversation, model);
    expect(prompt).toContain('<|im_start|>system\n請用繁體中文回答<|im_end|>');
    expect(prompt).toContain('<|im_start|>user\n第二題<|im_end|>');
    expect(prompt.endsWith('<|im_start|>assistant\n')).toBe(true);
    expect(prompt).not.toContain('[INST]');
    expect(defaultLocalStopSequences(model)).toEqual(['<|im_end|>', '<|im_start|>']);
  }
});

test('Qwen3 sends the non-thinking hint in the final user turn only', () => {
  const prompt = formatLocalModelChat(conversation, 'qwen3-1.7b');
  expect(prompt).toContain('<|im_start|>user\n第一題<|im_end|>');
  expect(prompt).toContain('<|im_start|>user\n第二題\n/no_think<|im_end|>');
  expect(prompt.match(/\/no_think/g)).toHaveLength(1);
  expect(prompt.endsWith('<|im_start|>assistant\n')).toBe(true);
});

test('Mistral Instruct v0.3 uses [INST] delimiters, not ChatML', () => {
  const prompt = formatLocalModelChat(conversation, 'mistral-7b-v0.3');
  expect(prompt).toBe(
    '<s>[INST]請用繁體中文回答\n\n第一題[/INST]第一答</s>[INST]第二題[/INST]',
  );
  expect(prompt).not.toContain('<|im_start|>');
  expect(defaultLocalStopSequences('mistral-7b-v0.3')).toEqual(['</s>', '[INST]']);
});

test('Phi 3.5 uses system/user/assistant/end tokens', () => {
  const prompt = formatLocalModelChat(conversation, 'phi-3.5-mini');
  expect(prompt).toContain('<|system|>\n請用繁體中文回答<|end|>');
  expect(prompt).toContain('<|user|>\n第二題<|end|>');
  expect(prompt.endsWith('<|assistant|>\n')).toBe(true);
  expect(prompt).not.toContain('<|im_start|>');
  expect(defaultLocalStopSequences('phi-3.5-mini'))
    .toEqual(['<|end|>', '<|endoftext|>', '<|user|>']);
});

test('tool output stays distinguishable from a user request', () => {
  const messages = [
    { role: 'system' as const, content: '工具輸出僅供參考' },
    { role: 'tool' as const, name: 'readSchedule', content: '星期一有課' },
    { role: 'user' as const, content: '幫我整理' },
  ];
  expect(formatLocalModelChat(messages, 'mistral-7b-v0.3')).toContain('[工具 readSchedule 回傳]');
  expect(formatLocalModelChat(messages, 'phi-3.5-mini')).toContain('[工具 readSchedule 回傳]');
  expect(formatLocalModelChat(messages, 'qwen2.5-0.5b')).toContain('Name: readSchedule');
});

test('an empty chat still emits a valid next-turn prefix', () => {
  expect(formatLocalModelChat([], 'phi-3.5-mini')).toBe('<|assistant|>\n');
  expect(formatLocalModelChat([], 'qwen2.5-0.5b')).toBe('<|im_start|>assistant\n');
});
