import React from 'react';
import { Modal } from 'react-native';
import { aiOverlay, useAIOverlay } from '../app/useAIOverlay';
import { useOptionalAgentDrafts } from '../state/AgentDraftProvider';
import { CampusAssistantScreen } from '../screens/CampusAssistantScreen';

export function AIOverlayHost() {
  const overlay = useAIOverlay();
  const drafts = useOptionalAgentDrafts();
  if (!overlay.visible || (drafts && (!drafts.ready || overlay.scopeOwner !== drafts.ownerKey))) return null;
  const route = { key: overlay.entryId, name: 'AIChat', params: { prompt: overlay.initialPrompt } };
  return (
    <Modal visible animationType="slide" onRequestClose={() => aiOverlay.close()}>
      <CampusAssistantScreen
        navigation={{ goBack: () => aiOverlay.close() }}
        route={route}
      />
    </Modal>
  );
}
