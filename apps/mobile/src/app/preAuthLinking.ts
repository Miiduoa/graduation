import { getStateFromPath, type LinkingOptions } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import { stagePendingSharedPostLink, stagePublicInitialSharedPostLink } from './pendingSharedPostLink';
import type { PreAuthStackParamList } from '../screens/preAuthTypes';
import { rewriteLegacyShopsPath } from './legacyShopsPath';

/** Platform accounts have their own entry before a school account is connected. */
export const preAuthLinking: LinkingOptions<PreAuthStackParamList> = {
  prefixes: [Linking.createURL('/'), 'campus://'],
  config: {
    initialRouteName: 'LoginLanding',
    screens: {
      LoginLanding: '',
      Map: 'map',
      Library: 'library',
      LibraryCatalog: 'library/catalog',
      SchoolInfo: 'school-info',
      BusSchedule: 'bus',
      公告總覽: 'announcements',
      公告詳情: 'announcement/:id',
      NuniWorkspace: 'campus-one',
      SSOLogin: 'sso-login',
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
  async getInitialURL() {
    const url = await Linking.getInitialURL();
    if (url && stagePublicInitialSharedPostLink(url, Constants.expoConfig?.extra?.release?.deepLinkHost)) {
      return null;
    }
    return url;
  },
  subscribe: (listener) => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (stagePendingSharedPostLink(url, Constants.expoConfig?.extra?.release?.deepLinkHost)) return;
      listener(url);
    });
    return () => subscription.remove();
  },
};
