import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  PUBLIC_SCHOOL_INFO_CATALOG_URL,
  PUBLIC_SCHOOL_INFO_SNAPSHOT_DATE,
  buildPublicSchoolMapsSearchUrl,
  formatPublicSchoolAddress,
  formatPublicSchoolCity,
  getPublicSchoolInfo,
  getPublicSchoolTelHref,
  getSafePublicSchoolWebsiteUrl,
} from '@campus/shared/src/publicSchoolInfo';
import { resolveSchoolPublicServices } from '@campus/shared/src/schoolPublicServices';
import { AIDetailScreen, AIButton, aiTokens } from '../ui/aiFirst';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';

type Navigation = {
  goBack?: () => void;
};

export default function SchoolInfoScreen({ navigation }: { navigation?: Navigation }) {
  const { user } = useAuth();
  const { school } = useSchool();
  // Include name so a same-ID conflicting rename remounts and invalidates retained actions.
  const scope = JSON.stringify([user?.uid, school.id, school.name]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  return (
    <SchoolInfoContent
      key={scope}
      scope={scope}
      activeScope={activeScope}
      schoolId={school.id}
      schoolName={school.name}
      navigation={navigation}
    />
  );
}

function SchoolInfoContent({
  scope,
  activeScope,
  schoolId,
  schoolName,
  navigation,
}: {
  scope: string;
  activeScope: React.MutableRefObject<string>;
  schoolId: string;
  schoolName: string;
  navigation?: Navigation;
}) {
  const styles = useThemeStyleSheet(createStyles);
  const info = getPublicSchoolInfo(schoolId, schoolName);
  const [error, setError] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  const mounted = useRef(true);
  const opening = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const isCurrent = () => mounted.current && activeScope.current === scope;

  const open = async (url: string) => {
    if (!isCurrent() || opening.current) return;
    opening.current = true;
    setError('');
    try {
      // Let a school/account switch invalidate this action before leaving the app.
      await Promise.resolve();
      if (!isCurrent()) return;
      await Linking.openURL(url);
    } catch {
      if (isCurrent()) setError('無法開啟連結，請確認裝置設定後重試。');
    } finally {
      opening.current = false;
    }
  };

  const copyTelephone = async (telephone: string) => {
    if (!isCurrent()) return;
    setError('');
    setCopyNotice('');
    try {
      await Promise.resolve();
      if (!isCurrent()) return;
      await Clipboard.setStringAsync(telephone);
      if (isCurrent()) setCopyNotice('已複製學校總機號碼。');
    } catch {
      if (isCurrent()) setError('無法複製號碼，請自行選取上方總機後複製。');
    }
  };

  const websiteUrl = info ? getSafePublicSchoolWebsiteUrl(info.websiteUrl) : null;
  const telHref = info ? getPublicSchoolTelHref(info.telephone) : null;
  const mapsUrl = info ? buildPublicSchoolMapsSearchUrl(info) : null;
  const publicServices = info ? resolveSchoolPublicServices(schoolId) : null;

  return (
    <AIDetailScreen
      title="學校資訊"
      subtitle="官方總機、網站、名錄地址與校方服務。"
      onBack={() => navigation?.goBack?.()}
    >
      <View style={styles.page}>
        {!info ? (
          <InfoSection title="公開聯絡資料" first>
            <Text style={styles.secondary}>
              目前沒有這所學校的公開聯絡資料，請先重新選擇學校。
            </Text>
          </InfoSection>
        ) : (
          <>
            <InfoSection title="學校" first>
              <Text accessibilityRole="header" style={styles.schoolName}>
                {info.name}
              </Text>
              <Text style={styles.meta}>
                {info.academicYear} 學年度名錄 · {formatPublicSchoolCity(info)}
              </Text>
              <Text style={styles.value}>{formatPublicSchoolAddress(info)}</Text>
              <Text style={styles.meta}>
                這是名錄中的機構地址；若有多個校區，請到官方網站確認實際位置。
              </Text>
            </InfoSection>
            <InfoSection title="聯絡方式">
              <Text selectable style={styles.value}>
                學校總機：{info.telephone}
              </Text>
              {telHref ? (
                <AIButton
                  label="撥打學校總機"
                  onPress={() => {
                    if (!isCurrent()) return;
                    void open(telHref);
                  }}
                />
              ) : (
                <AIButton
                  label="複製學校總機"
                  onPress={() => {
                    if (!isCurrent()) return;
                    void copyTelephone(info.telephone);
                  }}
                />
              )}
              {copyNotice ? (
                <Text accessibilityLiveRegion="polite" style={styles.meta}>
                  {copyNotice}
                </Text>
              ) : null}
              <View style={styles.rowGroup}>
                {websiteUrl ? (
                  <LinkRow
                    label="開啟官方網站"
                    onPress={() => {
                      if (!isCurrent()) return;
                      void open(websiteUrl);
                    }}
                  />
                ) : null}
                {mapsUrl ? (
                  <LinkRow
                    label="用地圖搜尋校名與地址"
                    onPress={() => {
                      if (!isCurrent()) return;
                      void open(mapsUrl);
                    }}
                  />
                ) : null}
              </View>
            </InfoSection>
            <InfoSection title="住宿與職涯資訊">
              {publicServices ? (
                <>
                  <Text style={styles.meta}>
                    請依校方網站的公告與流程辦理。個人包裹、線上報修與履歷申請紀錄尚未連結。
                  </Text>
                  <View style={styles.rowGroup}>
                    {(['dormitory', 'career'] as const).map((kind) => {
                      const link = publicServices.services[kind];
                      return (
                        <View key={kind}>
                          {link.entryKind === 'student-portal-fallback' ? (
                            <Text style={[styles.meta, styles.rowNote]}>
                              {kind === 'dormitory'
                                ? '請在臺大學生專區查找住宿相關資訊。'
                                : '請在臺大學生專區查找職涯與實習資訊。'}
                            </Text>
                          ) : null}
                          <LinkRow
                            label={`前往${link.label}`}
                            source={`來源：${link.sourceLabel}`}
                            onPress={() => void open(link.url)}
                          />
                        </View>
                      );
                    })}
                  </View>
                </>
              ) : (
                <Text style={styles.secondary}>
                  目前沒有這所學校的住宿與職涯入口，請從上方官方網站查詢。
                </Text>
              )}
            </InfoSection>
            <InfoSection title="資料來源">
              <Text style={styles.meta}>
                教育部統計處大專校院名錄（{info.academicYear} 學年度），快照日期{' '}
                {PUBLIC_SCHOOL_INFO_SNAPSHOT_DATE}
                。此頁提供公開聯絡方式；校務服務依學校目前開放項目使用。
              </Text>
              <View style={styles.rowGroup}>
                <LinkRow
                  label="開啟政府資料開放平台名錄"
                  onPress={() => {
                    if (!isCurrent()) return;
                    void open(PUBLIC_SCHOOL_INFO_CATALOG_URL);
                  }}
                />
              </View>
            </InfoSection>
          </>
        )}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>
    </AIDetailScreen>
  );
}

function InfoSection({
  title,
  first = false,
  children,
}: {
  title: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  const styles = useThemeStyleSheet(createStyles);
  return (
    <View style={[styles.section, first ? styles.sectionFirst : null]}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function LinkRow({
  label,
  source,
  onPress,
}: {
  label: string;
  source?: string;
  onPress: () => void;
}) {
  const styles = useThemeStyleSheet(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, pressed ? styles.linkRowPressed : null]}
    >
      <View style={styles.linkRowText}>
        <Text style={styles.linkLabel}>{label}</Text>
        {source ? <Text style={styles.meta}>{source}</Text> : null}
      </View>
      <Text accessible={false} importantForAccessibility="no" style={styles.chevron}>
        ›
      </Text>
    </Pressable>
  );
}

const createStyles = () => StyleSheet.create({
  page: { paddingHorizontal: aiTokens.space.md, paddingBottom: 16 },
  section: {
    paddingTop: 20,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.separator,
  },
  sectionFirst: { borderTopWidth: 0, paddingTop: 8 },
  sectionLabel: {
    color: aiTokens.muted,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  sectionBody: { gap: 10, marginTop: 10, alignItems: 'stretch' },
  schoolName: { color: aiTokens.text, fontSize: 20, lineHeight: 28, fontWeight: '700' },
  value: { color: aiTokens.text, fontSize: 16, lineHeight: 24 },
  secondary: { color: aiTokens.textSecondary, lineHeight: 22 },
  meta: { color: aiTokens.muted, fontSize: 14, lineHeight: 21 },
  rowNote: { paddingTop: 10 },
  rowGroup: { marginTop: 2 },
  linkRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.separator,
  },
  linkRowPressed: { backgroundColor: theme.colors.surfaceMuted },
  linkRowText: { flex: 1, minWidth: 0, gap: 2 },
  linkLabel: { color: aiTokens.ai, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  chevron: { color: aiTokens.muted, fontSize: 18, marginLeft: 8 },
  error: { color: aiTokens.danger, lineHeight: 22, marginTop: 16 },
});
