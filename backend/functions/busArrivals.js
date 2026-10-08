function readRealtimeBusCache(data, now = Date.now()) {
  const cachedAt = data?.cachedAt?.toMillis?.();
  const fetchedAt = typeof data?.fetchedAt === 'string' ? Date.parse(data.fetchedAt) : NaN;
  if (
    data?.source !== 'tdx' ||
    data?.isRealtime !== true ||
    !Array.isArray(data.arrivals) ||
    !Number.isFinite(cachedAt) ||
    now < cachedAt ||
    now - cachedAt >= 60_000 ||
    !Number.isFinite(fetchedAt) ||
    now < fetchedAt ||
    now - fetchedAt >= 60_000
  )
    return null;
  return {
    arrivals: data.arrivals,
    source: 'tdx',
    isRealtime: true,
    fetchedAt: data.fetchedAt,
    fromCache: true,
  };
}

module.exports = { readRealtimeBusCache };
