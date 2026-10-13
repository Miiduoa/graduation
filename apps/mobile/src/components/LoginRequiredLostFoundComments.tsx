import React from 'react';
import { Text, View } from 'react-native';
import {
  LOGIN_REQUIRED_ACTION_TEXT,
  LOGIN_REQUIRED_LOST_FOUND_AND_COMMENTS_TEXT,
} from '@campus/shared/src/signedInSocialReads';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';

export function LoginRequiredLostFoundComments({ onLogin }: { onLogin?: () => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Text style={{ color: theme.colors.text, flexShrink: 1, lineHeight: 22 }}>
        {LOGIN_REQUIRED_LOST_FOUND_AND_COMMENTS_TEXT}
      </Text>
      <Button text={LOGIN_REQUIRED_ACTION_TEXT} kind="primary" onPress={onLogin} />
    </View>
  );
}
