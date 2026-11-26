import { startSearchResultNavigation } from './app/search/searchResultNavigation';

export function onRouterTransitionStart(_url: string, type: 'push' | 'replace' | 'traverse') {
  startSearchResultNavigation(type);
}
