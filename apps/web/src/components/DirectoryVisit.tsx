'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ServiceJourney } from '@/lib/serviceJourneys';

type Origin = {
  journey: ServiceJourney;
  serviceHref: string;
  destination: string;
  returnHref: string;
};
type Visit = Origin & { from: string; route: string; scope: string; returning: boolean };
type BrowserNavigation = {
  currentEntry?: { index: number } | null;
  entries(): { url?: string | null }[];
};

export function backToDirectoryIfAdjacent(origin: Visit) {
  try {
    const navigation = (window as Window & { navigation?: BrowserNavigation }).navigation;
    const previous = navigation?.entries()[(navigation.currentEntry?.index ?? 0) - 1];
    if (!previous?.url) return false;
    const url = new URL(previous.url);
    // A fragment can focus its own heading after popstate. Open the filtered
    // directory URL explicitly so that the service row receives focus.
    if (url.hash || url.origin !== window.location.origin ||
        routeKey(url.pathname, url.searchParams.toString()) !== origin.from) return false;
    window.history.back();
    return true;
  } catch {
    return false;
  }
}

type DirectoryVisit = {
  remember: (origin: Origin) => string | undefined;
  ownerToken: string | null | undefined;
  origin: Visit | null;
  beginReturn: () => void;
  restoreRow: string | null;
  finishReturn: () => void;
};

const Context = createContext<DirectoryVisit | null>(null);
export const useDirectoryVisit = () => useContext(Context);

function routeKey(pathname: string, params: string) {
  return pathname + (params ? '?' + params : '');
}

// A visit belongs to one direct service transition in this tab. Ordinary deep
// links and later visits to the same service retain their usual breadcrumbs.
// While scope is undefined (identity check), keep the visit private until resolved.
export function DirectoryVisitProvider({ scope, children }: { scope: string | null | undefined; children: ReactNode }) {
  const route = routeKey(usePathname() ?? '/', useSearchParams()?.toString() ?? '');
  const [visit, setVisit] = useState<Visit | null>(null);
  const [owner, setOwner] = useState<{ scope: string | null; token: string | null }>({ scope: scope ?? null, token: null });
  if (scope !== undefined && owner.scope !== scope) setOwner({ scope, token: null });
  if (visit && scope !== undefined && visit.scope !== scope) {
    setVisit(null);
  } else if (visit && visit.route !== route) {
    // Typing can update window.location just before Next acknowledges the URL.
    const leavingDirectory = visit.route !== visit.destination && !visit.returning;
    const expected = leavingDirectory
      ? route === visit.from || route === visit.destination
      : visit.returning && route === visit.returnHref;
    setVisit(expected ? { ...visit, route } : null);
  }

  return (
    <Context.Provider value={{
      ownerToken: scope === undefined ? undefined : owner.token,
      remember(origin) {
        if (!scope) return;
        // History stores this tab-local marker, never an account identifier.
        const token = owner.token ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        if (!owner.token) setOwner({ scope, token });
        const url = new URL(window.location.href);
        setVisit({ ...origin, from: routeKey(url.pathname, url.searchParams.toString()), route, scope, returning: false });
        return token;
      },
      origin: visit?.scope === scope && route === visit?.destination ? visit : null,
      beginReturn() { setVisit((current) => current && { ...current, returning: true }); },
      restoreRow: visit?.scope === scope && visit?.returning && visit.returnHref === route
        ? visit.serviceHref : null,
      finishReturn() { setVisit(null); },
    }}>
      {children}
    </Context.Provider>
  );
}
