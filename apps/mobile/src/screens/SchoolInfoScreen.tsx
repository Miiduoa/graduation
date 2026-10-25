import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Linking, Text, View } from 'react-native';
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
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';

type Navigation = {
  goBack?: () => void;
};

export default function SchoolInfoScreen({ navigation }: { navigation?: Navigation }) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
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
      {!info ? (
        <AICard title="公開聯絡資料">
          <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
            目前沒有這所學校的公開聯絡資料，請先重新選擇學校。
          </Text>
        </AICard>
      ) : (
        <>
          <AICard title={info.name}>
            <View style={{ gap: 12 }}>
              <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                {info.academicYear} 學年度名錄 · {formatPublicSchoolCity(info)}
              </Text>
              <Text style={{ color: aiTokens.text, lineHeight: 22 }}>
                {formatPublicSchoolAddress(info)}
              </Text>
              <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                這是名錄中的機構地址；若有多個校區，請到官方網站確認實際位置。
              </Text>
            </View>
          </AICard>
          <AICard title="聯絡方式">
            <View style={{ gap: 12 }}>
              <Text selectable style={{ color: aiTokens.muted, lineHeight: 22 }}>
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
              {websiteUrl ? (
                <AIButton
                  label="開啟官方網站"
                  onPress={() => {
                    if (!isCurrent()) return;
                    void open(websiteUrl);
                  }}
                />
              ) : null}
              {mapsUrl ? (
                <AIButton
                  label="用地圖搜尋校名與地址"
                  variant="ghost"
                  onPress={() => {
                    if (!isCurrent()) return;
                    void open(mapsUrl);
                  }}
                />
              ) : null}
              {copyNotice ? (
                <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>{copyNotice}</Text>
              ) : null}
            </View>
          </AICard>
          <AICard title="住宿與職涯資訊">
            <View style={{ gap: 16 }}>
              {publicServices ? (
                <>
                  <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                    請依校方網站的公告與流程辦理。個人包裹、線上報修與履歷申請紀錄尚未連結。
                  </Text>
                  {(['dormitory', 'career'] as const).map((kind) => {
                    const link = publicServices.services[kind];
                    return (
                      <View key={kind} style={{ gap: 8 }}>
                        {link.entryKind === 'student-portal-fallback' ? (
                          <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                            {kind === 'dormitory'
                              ? '請在臺大學生專區查找住宿相關資訊。'
                              : '請在臺大學生專區查找職涯與實習資訊。'}
                          </Text>
                        ) : null}
                        <AIButton
                          label={`前往${link.label}`}
                          variant="ghost"
                          onPress={() => void open(link.url)}
                        />
                        <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                          來源：{link.sourceLabel}
                        </Text>
                      </View>
                    );
                  })}
                </>
              ) : (
                <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                  目前沒有這所學校的住宿與職涯入口，請從上方官方網站查詢。
                </Text>
              )}
            </View>
          </AICard>
          <AICard title="資料來源">
            <View style={{ gap: 12 }}>
              <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                教育部統計處大專校院名錄（{info.academicYear} 學年度），快照日期{' '}
                {PUBLIC_SCHOOL_INFO_SNAPSHOT_DATE}
                。此頁提供公開聯絡方式；校務服務依學校目前開放項目使用。
              </Text>
              <AIButton
                label="開啟政府資料開放平台名錄"
                variant="ghost"
                onPress={() => {
                  if (!isCurrent()) return;
                  void open(PUBLIC_SCHOOL_INFO_CATALOG_URL);
                }}
              />
            </View>
          </AICard>
        </>
      )}
      {error ? (
        <AICard>
          <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
            {error}
          </Text>
        </AICard>
      ) : null}
    </AIDetailScreen>
  );
}
