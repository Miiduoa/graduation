import { renderHook, act, waitFor } from '@testing-library/react-native';
import { usePagination, useInfiniteScroll } from '../../hooks/usePagination';

describe('usePagination', () => {
  const mockFetchFn = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize with loading state', () => {
    mockFetchFn.mockResolvedValue({ data: [], total: 0 });

    const { result } = renderHook(() => usePagination(mockFetchFn));

    expect(result.current.loading).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(result.current.page).toBe(1);
  });

  it('should fetch initial page', async () => {
    const mockData = [{ id: 1 }, { id: 2 }];
    mockFetchFn.mockResolvedValue({ data: mockData, total: 50 });

    const { result } = renderHook(() => usePagination(mockFetchFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toEqual(mockData);
    expect(result.current.totalItems).toBe(50);
    expect(mockFetchFn).toHaveBeenCalledWith(1, 20);
  });

  it('should use custom initial options', async () => {
    mockFetchFn.mockResolvedValue({ data: [], total: 100 });

    const { result } = renderHook(() =>
      usePagination(mockFetchFn, {
        initialPage: 2,
        pageSize: 10,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.page).toBe(2);
    expect(result.current.pageSize).toBe(10);
    expect(mockFetchFn).toHaveBeenCalledWith(2, 10);
  });

  it('should calculate pagination correctly', async () => {
    mockFetchFn.mockResolvedValue({ data: [], total: 95 });

    const { result } = renderHook(() =>
      usePagination(mockFetchFn, { pageSize: 20 })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.totalPages).toBe(5);
    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.hasPreviousPage).toBe(false);
  });

  it('should go to specific page', async () => {
    mockFetchFn.mockResolvedValue({ data: [], total: 100 });

    const { result } = renderHook(() => usePagination(mockFetchFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.goToPage(3);
    });

    await waitFor(() => {
      expect(result.current.page).toBe(3);
    });

    expect(mockFetchFn).toHaveBeenLastCalledWith(3, 20);
  });

  it('should not go to invalid page', async () => {
    mockFetchFn.mockResolvedValue({ data: [], total: 50 });

    const { result } = renderHook(() => usePagination(mockFetchFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const callCountBefore = mockFetchFn.mock.calls.length;

    act(() => {
      result.current.goToPage(0);
      result.current.goToPage(100);
    });

    expect(mockFetchFn.mock.calls.length).toBe(callCountBefore);
  });

  it('should navigate to next page', async () => {
    mockFetchFn.mockResolvedValue({ data: [], total: 100 });

    const { result } = renderHook(() => usePagination(mockFetchFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.nextPage();
    });

    await waitFor(() => {
      expect(result.current.page).toBe(2);
    });
  });

  it('should navigate to previous page', async () => {
    mockFetchFn.mockResolvedValue({ data: [], total: 100 });

    const { result } = renderHook(() =>
      usePagination(mockFetchFn, { initialPage: 3 })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.previousPage();
    });

    await waitFor(() => {
      expect(result.current.page).toBe(2);
    });
  });

  it('should not navigate past boundaries', async () => {
    mockFetchFn.mockResolvedValue({ data: [], total: 40 });

    const { result } = renderHook(() => usePagination(mockFetchFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.previousPage();
    });

    expect(result.current.page).toBe(1);

    await act(async () => {
      result.current.goToPage(2);
    });

    await waitFor(() => {
      expect(result.current.page).toBe(2);
    });

    const callCountBefore = mockFetchFn.mock.calls.length;

    act(() => {
      result.current.nextPage();
    });

    expect(mockFetchFn.mock.calls.length).toBe(callCountBefore);
  });

  it('should refresh and reset to page 1', async () => {
    mockFetchFn.mockResolvedValue({ data: [{ id: 1 }], total: 100 });

    const { result } = renderHook(() =>
      usePagination(mockFetchFn, { initialPage: 3 })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.page).toBe(1);
    expect(result.current.items).toEqual([{ id: 1 }]);
  });

  it('should load more and append items', async () => {
    mockFetchFn
      .mockResolvedValueOnce({ data: [{ id: 1 }, { id: 2 }], total: 100 })
      .mockResolvedValueOnce({ data: [{ id: 3 }, { id: 4 }], total: 100 });

    const { result } = renderHook(() => usePagination(mockFetchFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);

    await act(async () => {
      await result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.loadingMore).toBe(false);
    });

    expect(result.current.items).toHaveLength(4);
    expect(result.current.items).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
    ]);
  });

  it('should handle fetch error', async () => {
    mockFetchFn.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => usePagination(mockFetchFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
  });

  it('should update page size', async () => {
    mockFetchFn.mockResolvedValue({ data: [], total: 100 });

    const { result } = renderHook(() => usePagination(mockFetchFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setPageSize(50);
    });

    await waitFor(() => {
      expect(result.current.pageSize).toBe(50);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.page).toBe(1);
  });
});

describe('useInfiniteScroll', () => {
  const mockFetchFn = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize with loading state', () => {
    mockFetchFn.mockResolvedValue({ data: [], hasMore: false });

    const { result } = renderHook(() => useInfiniteScroll(mockFetchFn));

    expect(result.current.loading).toBe(true);
    expect(result.current.items).toEqual([]);
  });

  it('should fetch initial data', async () => {
    const mockData = [{ id: 1 }, { id: 2 }];
    mockFetchFn.mockResolvedValue({
      data: mockData,
      hasMore: true,
      nextCursor: 'cursor1',
    });

    const { result } = renderHook(() => useInfiniteScroll(mockFetchFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toEqual(mockData);
    expect(result.current.hasMore).toBe(true);
    expect(mockFetchFn).toHaveBeenCalledWith(undefined);
  });

  it('should load more with cursor', async () => {
    mockFetchFn
      .mockResolvedValueOnce({
        data: [{ id: 1 }],
        hasMore: true,
        nextCursor: 'cursor1',
      })
      .mockResolvedValueOnce({
        data: [{ id: 2 }],
        hasMore: false,
        nextCursor: undefined,
      });

    const { result } = renderHook(() => useInfiniteScroll(mockFetchFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.loadingMore).toBe(false);
    });

    expect(result.current.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.current.hasMore).toBe(false);
    expect(mockFetchFn).toHaveBeenLastCalledWith('cursor1');
  });

  it('should not load more when hasMore is false', async () => {
    mockFetchFn.mockResolvedValue({
      data: [{ id: 1 }],
      hasMore: false,
    });

    const { result } = renderHook(() => useInfiniteScroll(mockFetchFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const callCount = mockFetchFn.mock.calls.length;

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockFetchFn.mock.calls.length).toBe(callCount);
  });

  it('should refresh and reset', async () => {
    mockFetchFn
      .mockResolvedValueOnce({
        data: [{ id: 1 }],
        hasMore: true,
        nextCursor: 'cursor1',
      })
      .mockResolvedValueOnce({
        data: [{ id: 2 }],
        hasMore: false,
      })
      .mockResolvedValueOnce({
        data: [{ id: 3 }],
        hasMore: true,
        nextCursor: 'cursor2',
      });

    const { result } = renderHook(() => useInfiniteScroll(mockFetchFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.loadMore();
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.items).toEqual([{ id: 3 }]);
    expect(mockFetchFn).toHaveBeenLastCalledWith(undefined);
  });

  it('should handle onEndReached', async () => {
    mockFetchFn
      .mockResolvedValueOnce({
        data: [{ id: 1 }],
        hasMore: true,
        nextCursor: 'cursor1',
      })
      .mockResolvedValueOnce({
        data: [{ id: 2 }],
        hasMore: false,
      });

    const { result } = renderHook(() => useInfiniteScroll(mockFetchFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.onEndReached();
    });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });
  });

  it('should handle fetch error', async () => {
    mockFetchFn.mockRejectedValue(new Error('Fetch failed'));

    const { result } = renderHook(() => useInfiniteScroll(mockFetchFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Fetch failed');
  });

  it('should prevent concurrent loadMore calls', async () => {
    let resolveFirst: () => void;
    const firstPromise = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    mockFetchFn.mockImplementation(async () => {
      await firstPromise;
      return { data: [{ id: 1 }], hasMore: true, nextCursor: 'cursor1' };
    });

    const { result } = renderHook(() => useInfiniteScroll(mockFetchFn));

    await waitFor(() => {
      expect(mockFetchFn).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.onEndReached();
      result.current.onEndReached();
    });

    resolveFirst!();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockFetchFn).toHaveBeenCalledTimes(1);
  });

  it('should re-fetch when dependencies change', async () => {
    mockFetchFn.mockResolvedValue({
      data: [{ id: 1 }],
      hasMore: false,
    });

    const { result, rerender } = renderHook(
      ({ filter }) => useInfiniteScroll(mockFetchFn, [filter]),
      { initialProps: { filter: 'a' } }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockFetchFn).toHaveBeenCalledTimes(1);

    rerender({ filter: 'b' });

    await waitFor(() => {
      expect(mockFetchFn).toHaveBeenCalledTimes(2);
    });
  });
});
