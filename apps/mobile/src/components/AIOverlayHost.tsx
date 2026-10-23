import React from 'react';
import { Modal } from 'react-native';
import { aiOverlay, useAIOverlay } from '../app/useAIOverlay';
import { CampusAssistantScreen } from '../screens/CampusAssistantScreen';

export function AIOverlayHost() {
  const overlay = useAIOverlay();
  if (!overlay.visible) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={() => aiOverlay.close()}>
      <CampusAssistantScreen
        navigation={{ goBack: () => aiOverlay.close() }}
        route={{ name: 'AIChat', params: { prompt: overlay.initialPrompt } }}
      />
    </Modal>
  );
}
