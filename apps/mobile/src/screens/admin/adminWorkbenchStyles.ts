import { StyleSheet } from 'react-native';
import { theme } from '../../ui/theme';

/** Local admin workbench styles — does not alter shared theme tokens. */
export const adminWorkbenchStyles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 4,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  headerEyebrow: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  headerTitle: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  headerSchool: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
  },
  headerMeta: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  scopeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 2,
  },
  accountText: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '60%',
    color: theme.colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  tabScroll: {
    marginHorizontal: -4,
  },
  tabScrollContent: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  tabWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tabButton: {
    minHeight: 44,
    minWidth: 60,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabButtonActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft,
  },
  tabLabel: {
    color: theme.colors.muted,
    fontWeight: '700',
    fontSize: 13,
  },
  tabLabelActive: {
    color: theme.colors.accent,
  },
  surface: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: 16,
    gap: 12,
  },
  surfaceTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 24,
  },
  surfaceDescription: {
    color: theme.colors.muted,
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
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  statusRowLast: {
    borderBottomWidth: 0,
  },
  statusLabel: {
    color: theme.colors.text,
    fontWeight: '600',
    fontSize: 14,
    flexShrink: 0,
  },
  statusValue: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'right',
  },
  statusValueError: {
    color: theme.colors.danger,
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
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.text,
  },
  listItem: {
    padding: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 6,
  },
  listItemTitle: {
    color: theme.colors.text,
    fontWeight: '700',
    fontSize: 15,
    lineHeight: 22,
  },
  listItemMeta: {
    color: theme.colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  inlineError: {
    color: theme.colors.danger,
    fontSize: 13,
    lineHeight: 19,
  },
  mutedNote: {
    color: theme.colors.muted,
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
    color: theme.colors.muted,
    marginBottom: 6,
    fontWeight: '600',
  },
  formInput: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.text,
  },
});

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
