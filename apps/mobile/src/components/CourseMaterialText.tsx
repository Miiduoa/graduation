import React from 'react';
import { Alert, Linking, Text } from 'react-native';
import { courseMaterialTextParts } from '@campus/shared/src/courseMaterialText';
import { useTheme } from '../state/theme';

export function CourseMaterialText({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Text style={{ color: theme.colors.text, fontSize: 15, lineHeight: 24 }}>
      {courseMaterialTextParts(text).map((part, index) => part.href ? (
        <Text
          key={index}
          accessibilityRole="link"
          accessibilityLabel={part.text}
          accessibilityHint="在瀏覽器開啟教材連結"
          style={{ color: theme.colors.accent, textDecorationLine: 'underline' }}
          onPress={async () => {
            try {
              await Linking.openURL(part.href!);
            } catch {
              Alert.alert('無法開啟教材連結', '請稍後再試一次。');
            }
          }}
        >
          {part.text}
        </Text>
      ) : part.text)}
    </Text>
  );
}
