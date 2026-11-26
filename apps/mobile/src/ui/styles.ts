import { Platform } from 'react-native';
import { theme } from './theme';

export const pageTitleFont = Platform.OS === 'ios' ? 'System' : 'sans-serif';

export const styles = {
  get text() {
    return {
      title: { fontSize: 22, fontWeight: '700', color: theme.colors.text } as const,
      h2: { fontSize: 16, fontWeight: '700', color: theme.colors.text } as const,
      body: { fontSize: 16, color: theme.colors.text } as const,
      muted: { fontSize: 14, color: theme.colors.muted } as const,
    };
  },
};
