import { getStateFromPath, type LinkingOptions } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import type { PreAuthStackParamList } from '../screens/preAuthTypes';
import { rewriteLegacyShopsPath } from './legacyShopsPath';
import { isReservedMaestroHarnessUrl } from './maestroHarnessLink';
import { parseStudentCardDeepLink } from './studentCardDeepLink';

function ignorePublicNavigationUrl(url: string | null | undefined): boolean {
  return Boolean(parseStudentCardDeepLink(url) || isReservedMaestroHarnessUrl(url));
}

/** Platform accounts have their own entry before a school account is connected. */
export const preAuthLinking: LinkingOptions<PreAuthStackParamList> = {
  prefixes: [Linking.createURL('/'), 'campus://'],
  config: {
    initialRouteName: 'LoginLanding',
    screens: {
      LoginLanding: '',
      Explore: 'explore',
      Map: 'map',
      Library: 'library',
      LibraryCatalog: 'library/catalog',
      Dormitory: 'dormitory',
      Career: 'career',
      PlatformLostFound: 'platform-lost-found/:id?',
      SchoolInfo: 'school-info',
      StudentCard: 'student-card',
      BusSchedule: 'bus',
      公告總覽: 'announcements',
      公告詳情: 'announcement/:id',
      活動總覽: 'events',
      活動詳情: 'event/:id',
      NuniWorkspace: 'campus-one',
      SSOLogin: 'sso-login',
      TronClassWorkspace: 'tronclass',
      OralExamDemo: 'demo/oral-exam',
      PersonalTimetable: 'personal-timetable',
      PersonalCalendar: {
        path: 'personal-calendar/:eventId?',
        parse: {
          eventId: (value: string | undefined) => (value && value.length ? value : undefined),
        },
      },
    },
  },
  getStateFromPath: (path, options) => getStateFromPath(rewriteLegacyShopsPath(path), options),
  getInitialURL: async () => {
    const url = await Linking.getInitialURL();
    return ignorePublicNavigationUrl(url) ? null : url;
  },
  subscribe: (listener) => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (!ignorePublicNavigationUrl(url)) listener(url);
    });
    return () => subscription.remove();
  },
};
