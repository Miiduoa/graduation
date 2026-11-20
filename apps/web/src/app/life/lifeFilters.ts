export const LIFE_QUERY_LIMIT = 80;

export type LifeServiceCategory = 'all' | 'public' | 'community' | 'personal';

export type LifeFilters = {
  query: string;
  category: LifeServiceCategory;
};

function boundedQuery(query: string) {
  return query.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, LIFE_QUERY_LIMIT);
}

export function readLifeFilters(params: Pick<URLSearchParams, 'get'>): LifeFilters {
  const category = params.get('category');
  return {
    // Keep the person's spacing and letter forms; normalization belongs to matching only.
    query: boundedQuery(params.get('q') ?? ''),
    category:
      category === 'public' || category === 'community' || category === 'personal'
        ? category
        : 'all',
  };
}

export function writeLifeFilters(params: URLSearchParams, filters: LifeFilters) {
  const query = boundedQuery(filters.query);
  if (query) params.set('q', query);
  else params.delete('q');
  if (filters.category === 'all') params.delete('category');
  else params.set('category', filters.category);
}
