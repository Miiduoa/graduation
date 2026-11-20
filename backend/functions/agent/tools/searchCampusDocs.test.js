'use strict';

const mockFetchChunks = jest.fn();
jest.mock('../../lib/assistantFetchers', () => ({
  fetchAssistantKnowledgeChunks: (...args) => mockFetchChunks(...args),
}));

const mockWebSearch = jest.fn();
jest.mock('../../assistantAgent', () => ({
  answerWithServerWebSearch: (...args) => mockWebSearch(...args),
}));

const searchCampusDocs = require('./searchCampusDocs');

describe('searchCampusDocs tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns campusChunks only when chunks exist', async () => {
    mockFetchChunks.mockResolvedValue([{ id: '1', title: '規章', text: '…' }]);
    const out = await searchCampusDocs.execute({ schoolId: 's1' }, { query: '請假' });
    expect(out.campusChunks).toHaveLength(1);
    expect(out.webFallback).toBeNull();
    expect(mockWebSearch).not.toHaveBeenCalled();
  });

  test('an empty campus result keeps model-generated private text local', async () => {
    mockFetchChunks.mockResolvedValue([]);
    mockWebSearch.mockResolvedValue({
      content: '公開摘要',
      sources: [{ title: 'Duck', url: 'https://x', snippet: 'y' }],
    });
    const out = await searchCampusDocs.execute(
      { uid: 'alice', schoolId: 's1' },
      { query: '館藏校驗 AUDIT_PRIVATE_LIBRARY_CANARY_518' },
    );
    expect(out).toEqual({ campusChunks: [], webFallback: null });
    expect(mockWebSearch).not.toHaveBeenCalled();
  });

  test.each(['ntu', 'ncku', 'ntpu'])('preserves the server actor and %s campus scope', async (schoolId) => {
    mockFetchChunks.mockResolvedValue([]);
    await searchCampusDocs.execute(
      { uid: 'alice', schoolId, groupId: 'current-group' },
      { query: '校規', uid: 'other-user', schoolId: 'other-school', groupId: 'other-group' },
    );
    expect(mockFetchChunks).toHaveBeenCalledWith({
      uid: 'alice', schoolId, groupId: 'current-group', queryText: '校規',
    });
    expect(mockWebSearch).not.toHaveBeenCalled();
  });

  test('bounds only the retrieval query while accepting a long conversation question', async () => {
    mockFetchChunks.mockResolvedValue([]);
    mockWebSearch.mockResolvedValue(null);
    const query = `請查公告${'完整背景。'.repeat(700)}`;
    await expect(searchCampusDocs.execute({ schoolId: 'pu' }, { query })).resolves.toEqual({ campusChunks: [], webFallback: null });
    expect(mockFetchChunks).toHaveBeenCalledWith(expect.objectContaining({ queryText: query.slice(0, 500) }));
    expect(mockWebSearch).not.toHaveBeenCalled();
  });
});
