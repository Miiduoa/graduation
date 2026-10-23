import { getStateFromPath, type LinkingOptions } from '@react-navigation/native';
import * as Linking from 'expo-linking';
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
      BusSchedule: 'bus',
      公告總覽: 'announcements',
      公告詳情: 'announcement/:id',
      NuniWorkspace: 'campus-one',
      SSOLogin: 'sso-login',
    },
  },
  getStateFromPath: (path, options) => getStateFromPath(rewriteLegacyShopsPath(path), options),
  getInitialURL: () => Linking.getInitialURL(),
  subscribe: (listener) => {
    const subscription = Linking.addEventListener('url', ({ url }) => listener(url));
    return () => subscription.remove();
  },
};
