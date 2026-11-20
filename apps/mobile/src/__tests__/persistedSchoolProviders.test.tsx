import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { FavoritesProvider, useFavorites } from '../state/favorites';
import { SearchHistoryProvider, useSearchHistory } from '../state/searchHistory';
import { getScopedStorageKey } from '../services/scopedStorage';

let current: { favorites: ReturnType<typeof useFavorites>; search: ReturnType<typeof useSearchHistory> };
function Probe() {
  current = { favorites: useFavorites(), search: useSearchHistory() };
  return null;
}
function tree(schoolId: string) {
  return <FavoritesProvider userId="account" schoolId={schoolId}>
    <SearchHistoryProvider userId="account" schoolId={schoolId}><Probe /></SearchHistoryProvider>
  </FavoritesProvider>;
}

test('favorites and search actions remain usable after switching schools and ignore retained old actions', async () => {
  await AsyncStorage.clear();
  for (const schoolId of ['pu', 'ntu']) {
    await AsyncStorage.setItem(getScopedStorageKey('favorites', { uid: 'account', schoolId }),
      JSON.stringify({ announcement: [], event: [], poi: [schoolId], menu: [] }));
    await AsyncStorage.setItem(getScopedStorageKey('search-history', { uid: 'account', schoolId }),
      JSON.stringify([{ query: schoolId, type: 'poi', timestamp: 1 }]));
  }
  const view = render(tree('pu'));
  await waitFor(() => expect(current.favorites.favorites.poi).toEqual(['pu']));
  await waitFor(() => expect(current.search.history[0]?.query).toBe('pu'));
  const prior = current;
  view.rerender(tree('ntu'));
  await waitFor(() => expect(current.favorites.favorites.poi).toEqual(['ntu']));
  await waitFor(() => expect(current.search.history[0]?.query).toBe('ntu'));
  act(() => {
    prior.favorites.toggleFavorite('poi', 'stale');
    prior.search.addSearch('stale', 'poi');
    current.favorites.toggleFavorite('poi', 'new');
    current.search.addSearch('new', 'poi');
  });
  expect(current.favorites.favorites.poi).toEqual(['ntu', 'new']);
  expect(current.search.history.map((entry) => entry.query)).toEqual(['new', 'ntu']);
  await waitFor(async () => {
    expect(await AsyncStorage.getItem(getScopedStorageKey('favorites', { uid: 'account', schoolId: 'ntu' })))
      .toContain('new');
  });
  expect(await AsyncStorage.getItem(getScopedStorageKey('favorites', { uid: 'account', schoolId: 'pu' })))
    .not.toContain('new');
  view.rerender(tree('pu'));
  await waitFor(() => expect(current.favorites.favorites.poi).toEqual(['pu']));
  await waitFor(() => expect(current.search.history[0]?.query).toBe('pu'));
  act(() => {
    prior.favorites.toggleFavorite('poi', 'previous-visit');
    prior.search.addSearch('previous-visit', 'poi');
  });
  expect(current.favorites.favorites.poi).toEqual(['pu']);
  expect(current.search.history.map((entry) => entry.query)).toEqual(['pu']);
});
