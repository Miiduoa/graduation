import AsyncStorage from '@react-native-async-storage/async-storage';
import { parsePersonalImportAiResponse } from '@campus/shared/src/imports/aiRecognition';
import {
  loadPersonalImportDraft,
  savePersonalImportDraft,
} from '../services/imports/personalImportDraft';

const options = { kind: 'grades' as const, schoolId: 'pu', academicYear: '115', semester: '1' };
const source = '資料庫，學分 3，成績 85';
const result = () =>
  parsePersonalImportAiResponse(
    JSON.stringify({
      complete: true,
      rows: [{ title: '資料庫', credits: 3, grade: '85', evidence: source }],
    }),
    source,
    options,
  );
beforeEach(async () => {
  await AsyncStorage.clear();
});

test('recovers completed rows and retry ranges only for their owner and school', async () => {
  const draft = {
    text: `${source}\n第二門課`,
    options,
    ...result(),
    retryBatches: [{ text: '第二門課', startLine: 2 }],
  };
  await savePersonalImportDraft({ owner: 'first', schoolId: 'pu' }, draft);
  expect(await loadPersonalImportDraft({ owner: 'second', schoolId: 'pu' })).toBeNull();
  expect(await loadPersonalImportDraft({ owner: 'first', schoolId: 'other' })).toBeNull();
  expect(await loadPersonalImportDraft({ owner: 'first', schoolId: 'pu' })).toEqual(draft);
});

test('queued edits and clearing cannot be overwritten by an older checkpoint', async () => {
  const scope = { owner: 'first', schoolId: 'pu' };
  const draft = { text: source, options, ...result(), retryBatches: [] };
  const first = savePersonalImportDraft(scope, draft);
  const cleared = savePersonalImportDraft(scope, null);
  await Promise.all([first, cleared]);
  expect(await loadPersonalImportDraft(scope)).toBeNull();
});

test.each(['options', 'duplicate', 'source', 'retry'])(
  'ignores a damaged %s draft instead of crashing the preview',
  async (damage) => {
    const scope = { owner: 'first', schoolId: 'pu' };
    const draft = {
      text: source,
      options: { ...options },
      ...result(),
      retryBatches: [] as Array<{ text: string; startLine: number }>,
    };
    if (damage === 'options') draft.options.academicYear = {} as string;
    if (damage === 'duplicate') draft.rows.push(draft.rows[0]);
    if (damage === 'source') draft.rows[0].source.line = -1;
    if (damage === 'retry') draft.retryBatches.push({ text: '不同來源', startLine: 1 });
    await savePersonalImportDraft(scope, draft);
    expect(await loadPersonalImportDraft(scope)).toBeNull();
  },
);
