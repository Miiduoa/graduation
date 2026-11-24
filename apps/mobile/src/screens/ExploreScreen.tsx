import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  ASSISTANT_EXPERIENCE_CATEGORIES, filterAssistantExperiences,
  type AssistantExperience, type AssistantExperienceCategory,
} from '@campus/shared/src/assistantExperiences';
import { ASSISTANT_ROLE_WORKFLOWS, type AssistantWorkContext } from '@campus/shared/src/assistantRoleWorkflows';
import { getAssistantService } from '@campus/shared/src/assistantServices';
import { useAuth } from '../state/auth';
import { useOptionalNuniSession } from '../state/nuniSession';
import { useSchool } from '../state/school';
import { SchoolBrowsingControl } from '../components/SchoolBrowsingControl';
import { AIScreen } from '../ui/aiFirst';
import { theme } from '../ui/theme';
import { pageTitleFont } from '../ui/styles';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { resolveDashboardRole } from '../services/dashboardRole';
import { mobileWorkspaceExperience, workspaceContextForRole, workspaceDraftParams } from '../services/workspaceEntry';
import { mobileAssistantServiceDestination, type MobileAssistantAudience } from '../services/assistantServiceNavigation';
import { isRouteRegistered, safeNavigate } from '../utils/safeNavigate';
import type { ServiceScreenProps } from './UnavailableFeatureScreen';

export function ExploreScreen(props: ServiceScreenProps) {
  const auth = useAuth();
  const platform = useOptionalNuniSession();
  const { school, selectionReady } = useSchool();
  const readyPlatform = !platform?.loading && !platform?.error && !platform?.pendingLogout ? platform?.session : null;
  const campusReady = !!auth.user && !auth.loading && !auth.profileLoading && auth.profile?.uid === auth.user.uid;
  const audience: MobileAssistantAudience = readyPlatform ? 'platform' : campusReady ? 'campus' : 'guest';
  const routeContext = ASSISTANT_ROLE_WORKFLOWS.find((workflow) => workflow.id === props.route?.params?.workContext)?.id;
  const context = routeContext ?? (campusReady ? workspaceContextForRole(resolveDashboardRole(auth.profile)) : 'student');
  const scope = JSON.stringify([auth.user?.uid, readyPlatform?.platformAccountId, readyPlatform?.context, platform?.pendingLogout, platform?.error, school.id, selectionReady]);
  return <ExploreContent key={JSON.stringify([scope, context])} {...props} audience={audience} initialContext={context} />;
}

function ExploreContent({ navigation, audience, initialContext }: ServiceScreenProps & {
  audience: MobileAssistantAudience;
  initialContext: AssistantWorkContext;
}) {
  const s = useThemeStyleSheet(createStyles);
  const { school } = useSchool();
  const [workContext, setWorkContext] = useState<AssistantWorkContext | 'all'>(initialContext);
  const [category, setCategory] = useState<AssistantExperienceCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [openError, setOpenError] = useState('');
  const terms = query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const results = filterAssistantExperiences({ workContext, category })
    .map((experience) => mobileWorkspaceExperience(experience, audience === 'platform'))
    .filter((experience) => {
      const text = `${experience.title} ${experience.description} ${experience.prompt} ${experience.keywords}`.normalize('NFKC').toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
  const groups = ASSISTANT_EXPERIENCE_CATEGORIES.map((group) => ({ ...group, items: results.filter((experience) => experience.category === group.id) })).filter((group) => group.items.length);
  const assistantRoute = audience === 'platform' ? 'NuniTimetableAssistant' : 'AIChat';
  const start = (experience: AssistantExperience) => {
    const context = experience.workContext === 'all' ? workContext === 'all' ? 'student' : workContext : experience.workContext;
    safeNavigate(navigation, assistantRoute, workspaceDraftParams(experience.prompt, context));
  };
  const openService = async (experience: AssistantExperience) => {
    setOpenError('');
    const destination = mobileAssistantServiceDestination(experience.serviceId, audience, navigation, undefined, school.id);
    if (!destination) { setOpenError('現在無法開啟這項服務，請稍後再試。'); return; }
    if (destination.kind === 'native') {
      safeNavigate(navigation, destination.route, destination.params);
      return;
    }
    try { await Linking.openURL(destination.url); }
    catch { setOpenError('無法開啟網頁，請確認連線後再試。'); }
  };
  return (
    <AIScreen contentContainerStyle={s.content} testID="explore-screen">
      <View style={s.masthead}>
        <View style={s.titleBlock}>
          <Text accessibilityRole="header" style={s.title}>探索</Text>
          <Text style={s.lead}>從想完成的事，找到 nuni 的用法。</Text>
        </View>
        <SchoolBrowsingControl compact />
      </View>
      <View style={s.search}>
        <Ionicons name="search-outline" size={20} color={theme.colors.muted} />
        <TextInput accessibilityLabel="搜尋 nuni 用法" placeholder="找靈感、課業或校園生活"
          placeholderTextColor={theme.colors.muted} value={query} onChangeText={setQuery}
          maxLength={120} clearButtonMode="while-editing" style={s.searchInput} />
        {query ? <Pressable accessibilityRole="button" accessibilityLabel="清除用法搜尋"
          onPress={() => setQuery('')} style={s.clear}><Text style={s.clearText}>清除</Text></Pressable> : null}
      </View>
      <View style={s.contextSection}>
        <Text style={s.filterLabel}>依你的情境</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.contexts}>
          {[{ id: 'all' as const, label: '全部情境' }, ...ASSISTANT_ROLE_WORKFLOWS].map((context) => (
            <Pressable key={context.id} accessibilityRole="button" accessibilityLabel={`用法情境：${context.label}`}
              accessibilityState={{ selected: workContext === context.id }}
              onPress={() => { setWorkContext(context.id); setOpenError(''); }}
              style={({ pressed }) => [s.context, workContext === context.id && s.selectedContext, pressed && s.pressed]}>
              <Text style={[s.contextText, workContext === context.id && s.selectedContextText]}>{context.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <View style={s.categories}>
        {[{ id: 'all' as const, label: '全部用法' }, ...ASSISTANT_EXPERIENCE_CATEGORIES].map((item) => (
          <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: category === item.id }}
            onPress={() => setCategory(item.id)} style={[s.category, category === item.id && s.activeCategory]}>
            <Text style={[s.categoryText, category === item.id && s.activeCategoryText]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.note}>先帶入問題，再由你送出。服務會依帳號與學校提供可使用的內容。</Text>
      {audience === 'campus' && isRouteRegistered(navigation, 'CampusHome') ? (
        <Pressable accessibilityRole="button" onPress={() => safeNavigate(navigation, 'CampusHome')} style={s.directory}>
          <Text style={s.serviceLink}>查看全部校園服務</Text>
          <Ionicons name="arrow-forward-outline" size={18} color={theme.colors.accent} />
        </Pressable>
      ) : null}
      {openError ? <Text accessibilityRole="alert" style={s.error}>{openError}</Text> : null}
      {!results.length ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>還沒有符合的用法</Text>
          <Text style={s.description}>換個關鍵字，或看看其他情境。</Text>
          <Pressable accessibilityRole="button" onPress={() => { setQuery(''); setCategory('all'); setWorkContext('all'); }} style={s.reset}>
            <Text style={s.serviceLink}>顯示全部用法</Text>
          </Pressable>
        </View>
      ) : groups.map((group) => (
        <View key={group.id} style={s.section}>
          <Text accessibilityRole="header" style={s.sectionTitle}>{group.label}</Text>
          <Text style={s.description}>{group.description}</Text>
          {group.items.map((experience) => {
            const service = getAssistantService(experience.serviceId);
            const destination = mobileAssistantServiceDestination(experience.serviceId, audience, navigation, undefined, school.id);
            return (
              <View key={experience.id} style={s.experience}>
                <Text accessibilityRole="header" style={s.experienceTitle}>{experience.title}</Text>
                <Text style={s.description}>{experience.description}</Text>
                <View style={s.actions}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`試著問 nuni：${experience.title}`}
                    onPress={() => start(experience)} style={({ pressed }) => [s.startAction, pressed && s.pressed]}>
                    <Text style={s.startActionText}>試著問 nuni</Text>
                  </Pressable>
                  {service && destination ? (
                    <Pressable accessibilityRole={destination.kind === 'web' ? 'link' : 'button'}
                      accessibilityLabel={`開啟${service.label}${destination.kind === 'web' ? '網頁' : ''}，${experience.title}`}
                      onPress={() => void openService(experience)} style={({ pressed }) => [s.serviceAction, pressed && s.pressed]}>
                      <Text style={s.serviceLink}>{service.label}{destination.kind === 'web' ? '（網頁）' : ''}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </AIScreen>
  );
}

const createStyles = () => StyleSheet.create({
  content: { paddingHorizontal: theme.layout.screenHorizontalPadding, gap: 20 },
  masthead: { paddingTop: 24, gap: 16 },
  titleBlock: { gap: 8 },
  title: { fontFamily: pageTitleFont, color: theme.colors.text, fontSize: 34, lineHeight: 42, fontWeight: '700' },
  lead: { color: theme.colors.textSecondary, fontSize: 17, lineHeight: 26 },
  search: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 14, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, gap: 10, backgroundColor: theme.colors.surface },
  searchInput: { flex: 1, color: theme.colors.text, fontSize: 16, minHeight: 50, paddingVertical: 12 },
  clear: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  clearText: { color: theme.colors.accent, fontSize: 14 },
  contextSection: { gap: 10 },
  filterLabel: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
  contexts: { gap: 8, paddingBottom: 2 },
  context: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 11, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: theme.colors.border },
  selectedContext: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  contextText: { color: theme.colors.textSecondary, fontSize: 15 },
  selectedContextText: { color: theme.colors.bg, fontWeight: '600' },
  categories: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 4 },
  category: { minHeight: 44, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeCategory: { borderBottomColor: theme.colors.accent },
  categoryText: { color: theme.colors.textSecondary, fontSize: 15 },
  activeCategoryText: { color: theme.colors.text, fontWeight: '600' },
  note: { color: theme.colors.muted, fontSize: 14, lineHeight: 22 },
  directory: { minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center', alignSelf: 'flex-start' },
  section: { gap: 7, paddingTop: 12 },
  sectionTitle: { color: theme.colors.text, fontSize: 23, fontWeight: '600', lineHeight: 31 },
  description: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 23 },
  experience: { paddingTop: 22, paddingBottom: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, gap: 8 },
  experienceTitle: { color: theme.colors.text, fontSize: 19, lineHeight: 28, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 5, alignItems: 'center' },
  startAction: { minHeight: 44, justifyContent: 'center', backgroundColor: theme.colors.surfaceInteractive, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22 },
  startActionText: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  serviceAction: { minHeight: 44, justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 4, flexShrink: 1 },
  serviceLink: { color: theme.colors.accent, fontSize: 15, lineHeight: 23 },
  pressed: { opacity: 0.7 },
  error: { color: theme.colors.danger, fontSize: 15, lineHeight: 23 },
  empty: { paddingVertical: 36, gap: 8 },
  emptyTitle: { color: theme.colors.text, fontSize: 20, fontWeight: '600' },
  reset: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
