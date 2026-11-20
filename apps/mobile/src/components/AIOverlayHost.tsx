import React, { useSyncExternalStore } from 'react';
import { Modal } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { aiOverlay, useAIOverlay } from '../app/useAIOverlay';
import { rootNavigationRef, subscribeSchoolNavigationReady } from '../app/rootNavigation';
import { isPublicNavigationReady, publicNavigationRef, subscribePublicNavigationReady } from '../app/publicNavigation';
import { CampusAssistantScreen } from '../screens/CampusAssistantScreen';

function subscribeNavigationReady(notify: () => void) {
  const school = subscribeSchoolNavigationReady(notify);
  const guest = subscribePublicNavigationReady(notify);
  return () => { school(); guest(); };
}
function navigationOwner() {
  return isPublicNavigationReady() ? 'public' : rootNavigationRef.isReady() ? 'school' : 'none';
}

export function AIOverlayHost() {
  const overlay = useAIOverlay();
  const owner = useSyncExternalStore(subscribeNavigationReady, navigationOwner, () => 'none');
  const target = owner === 'public' ? publicNavigationRef : owner === 'school' ? rootNavigationRef : null;
  if (!overlay.visible) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={() => aiOverlay.close()}>
      <CampusAssistantScreen
        navigation={{
          goBack: () => aiOverlay.close(),
          ...(target ? {
            getState: () => target.getRootState(),
            navigate: (name: string, params?: Record<string, unknown>) => {
              if (navigationOwner() !== owner || !target.isReady() ||
                  !target.getRootState()?.routeNames.some(route => route === name)) {
                throw new Error('Assistant destination is not available');
              }
              target.dispatch(CommonActions.navigate({ name, params }));
              aiOverlay.close();
            },
          } : {}),
        }}
        route={{ name: 'AIChat', params: { prompt: overlay.initialPrompt } }}
      />
    </Modal>
  );
}
