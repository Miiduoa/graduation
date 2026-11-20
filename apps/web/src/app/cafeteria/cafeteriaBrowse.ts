import type { MenuItem } from '@/lib/firebase';
import type { CatalogCafeteria } from '@/lib/cafeteriaCatalog';
import { CAFETERIA_REVIEW_STATUS_DEFAULT } from '@campus/shared/src/cafeteriaCatalog';

export type DiningFilters = {
  search: string;
  category: string;
  budget: 'all' | '100' | '150';
  sort: 'name' | 'price';
};

export const DEFAULT_DINING_FILTERS: DiningFilters = {
  search: '',
  category: '',
  budget: 'all',
  sort: 'name',
};

export type DiningSection = {
  cafeteria: CatalogCafeteria;
  items: MenuItem[];
  allItems: MenuItem[];
  minimumPrice: number | null;
};

export function normalizeDiningSearch(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-TW');
}

export function menuPrice(item: MenuItem): number | null {
  return typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0
    ? item.price
    : null;
}

export function diningPrice(price: number | null): string {
  return price === null ? '未標價' : `NT$${price.toLocaleString('zh-TW')}`;
}

export function buildDiningSections(
  cafeterias: CatalogCafeteria[],
  menus: MenuItem[],
): DiningSection[] {
  const shops = new Map(cafeterias.map((shop) => [shop.id, shop]));
  const grouped = new Map<string, MenuItem[]>();
  for (const menu of menus) {
    const matching = menu.cafeteriaId
      ? []
      : cafeterias.filter((shop) => shop.name === menu.cafeteria);
    const id = menu.cafeteriaId || (matching.length === 1 ? matching[0].id : menu.cafeteria);
    if (!id) continue;
    if (!shops.has(id)) {
      shops.set(id, {
        id,
        name: menu.cafeteria || '未命名餐廳',
        reviewStatus: CAFETERIA_REVIEW_STATUS_DEFAULT,
      });
    }
    const items = grouped.get(id) ?? [];
    items.push(menu);
    grouped.set(id, items);
  }
  return Array.from(shops.values()).map((cafeteria) => {
    const items = grouped.get(cafeteria.id) ?? [];
    const prices = items.flatMap((item) => {
      const price = menuPrice(item);
      return price === null ? [] : [price];
    });
    return {
      cafeteria,
      items,
      allItems: items,
      minimumPrice: prices.length ? Math.min(...prices) : null,
    };
  });
}

export function filterDiningSections(
  sections: DiningSection[],
  filters: DiningFilters,
): DiningSection[] {
  const terms = normalizeDiningSearch(filters.search).split(/\s+/).filter(Boolean);
  const constrained = Boolean(filters.category || filters.budget !== 'all');
  const results = sections.flatMap((section) => {
    const { cafeteria } = section;
    const shopText = normalizeDiningSearch(
      [cafeteria.name, cafeteria.location, cafeteria.intro, cafeteria.openingHours]
        .filter(Boolean)
        .join(' '),
    );
    const shopMatches = terms.every((term) => shopText.includes(term));
    const items = section.allItems.filter((item) => {
      if (filters.category && item.category?.trim() !== filters.category) return false;
      const price = menuPrice(item);
      if (filters.budget !== 'all' && (price === null || price > Number(filters.budget)))
        return false;
      const text = `${shopText} ${normalizeDiningSearch(
        [item.name, item.description, item.category, ...(item.tags ?? [])]
          .filter(Boolean)
          .join(' '),
      )}`;
      return terms.every((term) => text.includes(term));
    });
    if (!items.length && (constrained || !shopMatches)) return [];
    const prices = items.flatMap((item) => {
      const price = menuPrice(item);
      return price === null ? [] : [price];
    });
    return [
      {
        ...section,
        items:
          filters.sort === 'price'
            ? [...items].sort((a, b) => (menuPrice(a) ?? Infinity) - (menuPrice(b) ?? Infinity))
            : items,
        minimumPrice: prices.length ? Math.min(...prices) : null,
      },
    ];
  });
  return results.sort((a, b) => {
    if (filters.sort === 'price') {
      const priceOrder = (a.minimumPrice ?? Infinity) - (b.minimumPrice ?? Infinity);
      if (Number.isFinite(priceOrder) && priceOrder !== 0) return priceOrder;
      if (a.minimumPrice === null && b.minimumPrice !== null) return 1;
      if (a.minimumPrice !== null && b.minimumPrice === null) return -1;
    }
    return a.cafeteria.name.localeCompare(b.cafeteria.name, 'zh-TW');
  });
}

export function readDiningFilters(schoolId: string): DiningFilters {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(`campus:dining:${schoolId}`) ?? 'null',
    );
    if (!value || typeof value !== 'object') return { ...DEFAULT_DINING_FILTERS };
    const saved = value as Record<string, unknown>;
    return {
      search: typeof saved.search === 'string' ? saved.search.slice(0, 120) : '',
      category: typeof saved.category === 'string' ? saved.category.slice(0, 80) : '',
      budget: saved.budget === '100' || saved.budget === '150' ? saved.budget : 'all',
      sort: saved.sort === 'price' ? 'price' : 'name',
    };
  } catch {
    return { ...DEFAULT_DINING_FILTERS };
  }
}

export function saveDiningFilters(schoolId: string, filters: DiningFilters): void {
  try {
    sessionStorage.setItem(`campus:dining:${schoolId}`, JSON.stringify(filters));
  } catch {
    // Browsing still works when the browser cannot keep session preferences.
  }
}
