export type QuizAnswerInput = string | string[] | boolean | null;
export type QuizAnswerPayload = { optionIds: string[] } | { value: boolean } | { text: string };
export type QuizOption = { id: string; label: string };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Preserve authored option IDs rather than deriving identifiers from array positions. */
export function quizOptions(choices: unknown): QuizOption[] {
  const container = object(choices);
  const raw = Array.isArray(choices) ? choices
    : container && (Array.isArray(container.options) ? container.options
      : Array.isArray(container.choices) ? container.choices
      : Array.isArray(container.items) ? container.items : null);
  if (!raw) return [];
  const result: QuizOption[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const entry = object(item);
    const key = entry ? entry.id ?? entry.value ?? entry.key : item;
    const id = typeof key === 'string' ? key.trim() : '';
    if (!id || seen.has(id)) continue;
    const original = entry ? entry.label ?? entry.text ?? entry.title ?? entry.value : item;
    result.push({ id, label: typeof original === 'string' && original.trim() ? original : id });
    seen.add(id);
  }
  return result;
}

export function quizAnswerInput(type: string, stored: unknown): QuizAnswerInput {
  const value = object(stored);
  if (!value) return null;
  if (type === 'single') {
    const ids = Array.isArray(value.optionIds) ? value.optionIds : [];
    return typeof ids[0] === 'string' ? ids[0] : null;
  }
  if (type === 'multiple') {
    return Array.isArray(value.optionIds)
      ? value.optionIds.filter((id): id is string => typeof id === 'string') : [];
  }
  if (type === 'boolean') return typeof value.value === 'boolean' ? value.value : null;
  if (type === 'short' || type === 'essay') return typeof value.text === 'string' ? value.text : '';
  return null;
}

/** Match public._quiz_normalize_answer's JSON contract. Null clears the answer. */
export function quizAnswerPayload(
  type: string,
  value: QuizAnswerInput,
  choices?: unknown,
): QuizAnswerPayload | null {
  if (value === null) return null;
  if (type === 'single' || type === 'multiple') {
    const available = new Set(quizOptions(choices).map((option) => option.id));
    if (!available.size) throw new Error('此題尚未設定有效選項');
    const ids = (typeof value === 'string' ? [value] : Array.isArray(value) ? value : [])
      .map((id) => id.trim()).filter(Boolean);
    if (!ids.length) return null;
    if (type === 'single' && ids.length !== 1) throw new Error('單選題只能選一個答案');
    if (ids.some((id) => !available.has(id))) throw new Error('選擇了不屬於本題的選項');
    return { optionIds: Array.from(new Set(ids)).sort() };
  }
  if (type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error('請選擇正確或錯誤');
    return { value };
  }
  if (type === 'short' || type === 'essay') {
    if (typeof value !== 'string') throw new Error('請輸入文字作答');
    const text = value.trim();
    if (!text) return null;
    if (text.length > 8000) throw new Error('作答內容不能超過 8000 字');
    return { text };
  }
  throw new Error('此題型目前不支援作答');
}
