import { isFirebaseMockMode } from '../firebase';
import { firebaseSource } from './firebaseSource';

export async function loadBusJourneyRoute(uid?: string, schoolId?: string | null, routeId?: string) {
  if (!uid || !schoolId || !routeId || isFirebaseMockMode()) {
    throw new Error('route-unavailable');
  }
  const routes = await firebaseSource.listBusRoutes(schoolId);
  return routes.find((route) => route.id === routeId && route.isActive !== false) ?? null;
}
