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

  test('calls answerWithServerWebSearch when no chunks', async () => {
    mockFetchChunks.mockResolvedValue([]);
    mockWebSearch.mockResolvedValue({
      content: '公開摘要',
      sources: [{ title: 'Duck', url: 'https://x', snippet: 'y' }],
    });
    const out = await searchCampusDocs.execute({ schoolId: 's1' }, { query: '診斷書' });
    expect(out.campusChunks).toEqual([]);
    expect(out.webFallback?.content).toBe('公開摘要');
    expect(mockWebSearch).toHaveBeenCalledWith('診斷書');
  });
});
