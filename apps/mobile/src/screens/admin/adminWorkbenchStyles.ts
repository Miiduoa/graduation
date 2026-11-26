import { StyleSheet } from 'react-native';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';

const HAIRLINE = StyleSheet.hairlineWidth;

/**
 * Local admin workbench styles — does not alter shared theme tokens.
 * Built lazily so a light/dark toggle (theme version bump) rebuilds every consumer.
 */
export function createAdminWorkbenchStyles() {
  return StyleSheet.create({
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      marginBottom: 2,
    },
    headerCopy: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    headerTitle: {
      color: theme.colors.text,
      fontSize: 26,
      fontWeight: '800',
      lineHeight: 32,
    },
    headerSchool: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: '600',
      lineHeight: 22,
    },
    headerMeta: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
    },
    scopeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      columnGap: 8,
      rowGap: 2,
    },
    roleText: {
      color: theme.colors.accent,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 19,
    },
    accountText: {
      flexShrink: 1,
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
    },
    tabScroll: {
      flexGrow: 0,
      marginHorizontal: -theme.layout.screenHorizontalPadding,
      borderBottomWidth: HAIRLINE,
      borderBottomColor: theme.colors.border,
    },
    tabScrollContent: {
      flexDirection: 'row',
      flexWrap: 'nowrap',
      gap: 4,
      paddingHorizontal: theme.layout.screenHorizontalPadding - 12,
    },
    tabButton: {
      minHeight: 48,
      minWidth: 48,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderBottomWidth: 3,
      borderBottomColor: 'transparent',
    },
    tabButtonActive: {
      borderBottomColor: theme.colors.accent,
    },
    tabLabel: {
      color: theme.colors.textSecondary,
      fontWeight: '500',
      fontSize: 15,
      lineHeight: 20,
    },
    tabLabelActive: {
      color: theme.colors.text,
      fontWeight: '800',
    },
    surface: {
      paddingBottom: 20,
      borderBottomWidth: HAIRLINE,
      borderBottomColor: theme.colors.border,
      gap: 12,
    },
    surfaceTitle: {
      color: theme.colors.text,
      fontSize: 19,
      fontWeight: '800',
      lineHeight: 26,
    },
    surfaceDescription: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 2,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 10,
      borderBottomWidth: HAIRLINE,
      borderBottomColor: theme.colors.border,
    },
    statusRowLast: {
      borderBottomWidth: 0,
    },
    statusLabel: {
      color: theme.colors.text,
      fontWeight: '700',
      fontSize: 14,
      lineHeight: 20,
      flexShrink: 0,
    },
    statusValueWrap: {
      flex: 1,
      minWidth: 0,
      alignItems: 'flex-end',
      gap: 6,
    },
    statusValue: {
      minWidth: 0,
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'right',
    },
    statusValueError: {
      color: theme.colors.danger,
      fontWeight: '600',
    },
    feedbackStack: {
      gap: 10,
    },
    actionStack: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    secondaryActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 4,
    },
    searchField: {
      minHeight: 44,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      color: theme.colors.text,
    },
    listItem: {
      paddingVertical: 12,
      borderBottomWidth: HAIRLINE,
      borderBottomColor: theme.colors.border,
      gap: 4,
    },
    listItemTitle: {
      color: theme.colors.text,
      fontWeight: '700',
      fontSize: 15,
      lineHeight: 22,
    },
    listItemMeta: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
    },
    inlineError: {
      color: theme.colors.danger,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '600',
    },
    mutedNote: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
    },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    formField: {
      marginBottom: 12,
    },
    formLabel: {
      color: theme.colors.textSecondary,
      marginBottom: 6,
      fontWeight: '600',
    },
    formInput: {
      minHeight: 44,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      color: theme.colors.text,
    },
  });
}

/** Theme-subscribed styles: re-resolve whenever light/dark or school theme changes. */
export function useAdminWorkbenchStyles() {
  return useThemeStyleSheet(createAdminWorkbenchStyles);
}

/** Page batch sizes — not verified school-wide totals. */
export const ADMIN_PAGE_SIZES = {
  announcements: 50,
  members: 100,
  logs: 20,
  cafeterias: 100,
} as const;

/** @deprecated Use ADMIN_PAGE_SIZES; kept for call sites mid-migration. */
export const ADMIN_LIST_LIMITS = ADMIN_PAGE_SIZES;

export type MemberRole = 'admin' | 'editor' | 'member';

export function memberRoleLabel(role: MemberRole): string {
  if (role === 'admin') return '管理員';
  if (role === 'editor') return '編輯者';
  return '一般成員';
}

export function formatLoadedScope(args: {
  count: number;
  hasMore?: boolean;
  pageSize?: number;
}): string {
  if (args.hasMore) {
    return `目前已載入 ${args.count}（尚可載入更多）`;
  }
  return `目前已載入 ${args.count}`;
}

export function formatDataStatus(args: {
  loading: boolean;
  refreshing?: boolean;
  error: string | null;
  count: number;
  hasMore?: boolean;
  /** @deprecated page size is batch size only; kept for older call sites */
  limit?: number;
}): string {
  if (args.loading && args.count === 0) return '載入中…';
  if (args.refreshing) {
    if (args.error) return `更新中…（先前載入失敗）`;
    return `更新中…（目前已載入 ${args.count}）`;
  }
  if (args.error) return `載入失敗：${args.error}`;
  return formatLoadedScope({ count: args.count, hasMore: args.hasMore });
}
