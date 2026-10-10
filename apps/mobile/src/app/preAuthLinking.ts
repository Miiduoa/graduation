import type { LinkingOptions } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import type { PreAuthStackParamList } from '../screens/preAuthTypes';

/** Platform accounts have their own entry before a school account is connected. */
export const preAuthLinking: LinkingOptions<PreAuthStackParamList> = {
  prefixes: [Linking.createURL('/'), 'campus://'],
  config: {
    initialRouteName: 'LoginLanding',
    screens: {
      LoginLanding: '',
      NuniWorkspace: 'campus-one',
      SSOLogin: 'sso-login',
    },
  },
  getInitialURL: () => Linking.getInitialURL(),
  subscribe: (listener) => {
    const subscription = Linking.addEventListener('url', ({ url }) => listener(url));
    return () => subscription.remove();
  },
};
