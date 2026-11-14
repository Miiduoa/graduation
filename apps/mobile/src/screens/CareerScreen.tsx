import React, { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import {
  CAREER_EMPTY,
  CAREER_JOBS_UNAVAILABLE,
  CAREER_LINKS,
  careerCalendarUrl,
  careerSoon,
  emptyCareerFeed,
  fetchCareerFeed,
  type CareerFeed,
} from '../../../../packages/shared/src/career';
import { resolveSchoolPublicServices } from '@campus/shared/src/schoolPublicServices';
import { useSchool } from '../state/school';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
function Body({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: aiTokens.text, fontSize: 16, lineHeight: 25 }}>{children}</Text>;
}
function Content({ schoolId }: { schoolId: string }) {
  const [feed, setFeed] = useState<CareerFeed | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const official = resolveSchoolPublicServices(schoolId)?.services.career;
  useEffect(() => {
    const controller = new AbortController();
    fetchCareerFeed(schoolId, 'https://nuni.tw', controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setFeed(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFeed(emptyCareerFeed());
      });
    return () => controller.abort();
  }, [schoolId, retry]);
  function open(url: string) {
    void Linking.openURL(url).catch(() => setError('無法開啟連結，請稍後重試。'));
  }
  return (
    <View style={{ gap: 18 }}>
      <AICard title="接下來">
        <Body>
          職產處、系所與校園徵才的明確日期，最多顯示 5 筆。日期來自標題，詳細時段請回原文確認。
        </Body>
        {!feed ? (
          <Body>正在讀取公開職涯資訊…</Body>
        ) : !feed.timeline.length ? (
          <Body>目前沒有可確認日期的近期截止日或活動。</Body>
        ) : (
          feed.timeline.map((item) => (
            <Pressable
              key={item.url}
              accessibilityRole="link"
              accessibilityLabel={`${item.date} ${item.title}，加入行事曆`}
              onPress={() => open(careerCalendarUrl(item))}
              style={{
                height: 56,
                flexDirection: 'row',
                alignItems: 'center',
                borderBottomWidth: 1,
                borderColor: aiTokens.border,
              }}
            >
              <Text
                style={{
                  width: 52,
                  color: careerSoon(item.date) ? aiTokens.ai : aiTokens.text,
                  fontWeight: careerSoon(item.date) ? '700' : '400',
                }}
              >
                {item.date.slice(5).replace('-', '/')}
              </Text>
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: careerSoon(item.date) ? aiTokens.ai : aiTokens.text,
                    fontWeight: careerSoon(item.date) ? '700' : '400',
                  }}
                >
                  {item.title}
                </Text>
                <Text style={{ color: aiTokens.muted, fontSize: 12 }}>{item.source}</Text>
              </View>
            </Pressable>
          ))
        )}
        <Body>點選日期列可「加入行事曆」，將開啟 Google 日曆確認；不會自動建立或發送提醒。</Body>
        {feed?.announcementsUnavailable && <Body>部分校方公告暫時讀不到，仍可前往官方網站。</Body>}
        <AIButton
          label="重新整理"
          onPress={() => {
            setFeed(null);
            setRetry((v) => v + 1);
          }}
        />
      </AICard>
      <AICard title="校內工讀與實習">
        <Body>{CAREER_EMPTY}</Body>
        {official && <AIButton label={`${official.label} ↗`} onPress={() => open(official.url)} />}
        <Body>
          此頁提供公開資訊，尚未接上校內工讀申請及實習學分系統。申請、權益說明與學分認定請洽校方；這裡不受理投遞或登錄時數。
        </Body>
      </AICard>
      <AICard title="校方職涯公告">
        <Body>只顯示標題、公告日期與原文連結；公告日期不是截止日。</Body>
        {feed && !feed.supported && (
          <Body>目前尚未接上這所學校的公告來源，請從校方職涯入口查詢。</Body>
        )}
        {feed?.announcements.length ? (
          feed.announcements.map((a) => (
            <View key={a.url} style={{ gap: 6, paddingVertical: 10 }}>
              <Body>
                {a.source} · {a.date || '未提供公告日期'}
              </Body>
              <AIButton label={`${a.title} ↗`} onPress={() => open(a.url)} />
            </View>
          ))
        ) : (
          <Body>目前沒有可顯示的公告。</Body>
        )}
        {official && <AIButton label="前往校方職涯資源 ↗" onPress={() => open(official.url)} />}
      </AICard>
      <AICard title="附近職缺補充">
        <AIButton
          label="來源：台灣就業通開放資料 ↗"
          onPress={() => open('https://data.gov.tw/dataset/44062')}
        />
        <Body>
          {feed?.supported !== false
            ? '靜宜周邊：沙鹿（433）。'
            : '目前僅接入靜宜周邊沙鹿（433），不套用到其他學校。'}
          外站職缺不代表校方推薦或可抵實習學分。
        </Body>
        {feed?.jobsUnavailable ? (
          <Body>{CAREER_JOBS_UNAVAILABLE}</Body>
        ) : feed?.supported && !feed.jobs.length ? (
          <Body>目前沒有沙鹿地區的補充職缺。</Body>
        ) : null}
        {feed?.jobs.map((j) => (
          <View key={j.url}>
            <Body>台灣就業通 · {j.company}</Body>
            <AIButton label={`${j.title} ↗`} onPress={() => open(j.url)} />
          </View>
        ))}
        {CAREER_LINKS.map((link) => (
          <AIButton key={link.url} label={`${link.label} ↗`} onPress={() => open(link.url)} />
        ))}
      </AICard>
      <AICard title="給學生、職涯承辦與平台營運">
        <Body>
          訪客與登入者看到相同的公開資訊。承辦與營運可從來源連結核對公告；本頁沒有上架、申請審核、學生名冊或實習紀錄管理功能。諮詢預約請依校方網站流程辦理。
        </Body>
      </AICard>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: aiTokens.text }}>
          {error}
        </Text>
      )}
    </View>
  );
}
export function CareerScreen({ navigation }: { navigation?: { goBack?: () => void } }) {
  const { school, selectionReady } = useSchool();
  return (
    <AIDetailScreen
      title="職涯"
      subtitle={`生活 › 職涯 · ${school.name}`}
      onBack={() => navigation?.goBack?.()}
    >
      {selectionReady !== false && school.id ? (
        <Content key={school.id} schoolId={school.id} />
      ) : (
        <Body>請先選擇學校，再查看該校的職涯資訊。</Body>
      )}
    </AIDetailScreen>
  );
}
