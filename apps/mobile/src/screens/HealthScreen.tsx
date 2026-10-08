import React, { useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useSchool } from '../state/school';
import { useTheme } from '../state/theme';
import { AIDetailScreen, AICard, AIButton } from '../ui/aiFirst';

// Official school service pages, checked 2026-10-08. No personal health record is inferred.
const SERVICES = [
  { title: '想找人聊聊', description: '了解個別諮商與初次晤談的申請方式，依校方流程預約。', action: '查看諮商申請方式', url: 'https://osachc.pu.edu.tw/p/412-1067-1754.php?Lang=zh-tw' },
  { title: '查詢就醫資訊', description: '查看學校公告的特約醫院；看診與掛號請向醫療院所確認。', action: '查看特約醫院', url: 'https://osachc.pu.edu.tw/p/412-1067-1775.php?Lang=zh-tw' },
  { title: '學生健康檢查', description: '查詢健檢公告與辦理方式。個人檢查結果請向校方或檢查單位查詢。', action: '查看健檢公告', url: 'https://osachc.pu.edu.tw/p/412-1067-1787.php?Lang=zh-tw' },
  { title: '校園 AED 位置', description: '查看學校公布的 AED 分布圖；實際位置與設備狀態請以現場為準。', action: '開啟校方 AED 分布圖', url: 'https://osachc.pu.edu.tw/p/412-1067-1797.php?Lang=zh-tw' },
] as const;

type Props = { navigation?: { goBack?: () => void } };
export function HealthScreen({ navigation }: Props) {
  const { school } = useSchool();
  return <HealthDirectory key={school.id} schoolId={school.id} navigation={navigation} />;
}

function HealthDirectory({ schoolId, navigation }: Props & { schoolId: string }) {
  const theme = useTheme();
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const active = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const open = async (url: string) => {
    if (!active.current || pending.current || schoolId !== 'pu') return;
    pending.current = true;
    setOpening(url);
    setError('');
    try {
      await Linking.openURL(url);
    } catch {
      if (active.current) setError('無法開啟學校網頁，請確認網路連線後再試一次。');
    } finally {
      pending.current = false;
      if (active.current) setOpening(null);
    }
  };
  const body = { ...theme.typography.body, color: theme.colors.muted };
  return <AIDetailScreen title="校園健康" subtitle="找到就醫、諮商與健康檢查的校方資訊。" onBack={() => navigation?.goBack?.()}>
    {schoolId !== 'pu' ? <AICard title="學校健康服務"><Text style={body}>尚未提供這所學校的健康服務入口，請從學校官網查詢。</Text></AICard> : <>
      {error ? <AICard><Text accessibilityRole="alert" style={{ ...body, color: theme.colors.danger }}>{error}</Text></AICard> : null}
      {SERVICES.map((service) => <AICard key={service.url} title={service.title}>
        <View style={{ gap: theme.space.md }}>
          <Text style={body}>{service.description}</Text>
          <AIButton label={opening === service.url ? '正在開啟…' : service.action} disabled={opening !== null} onPress={() => void open(service.url)} />
        </View>
      </AICard>)}
      <AICard title="諮商暨健康中心">
        <View style={{ gap: theme.space.md }}>
          <Text style={body}>服務時間、聯絡方式與最新消息，請查看中心網站。</Text>
          <AIButton label="前往中心網站" variant="ghost" disabled={opening !== null} onPress={() => void open('https://osachc.pu.edu.tw/')} />
          <Text style={{ ...theme.typography.bodySmall, color: theme.colors.muted }}>來源：靜宜大學諮商暨健康中心。預約與個人資料查詢在校方服務辦理。</Text>
        </View>
      </AICard>
    </>}
  </AIDetailScreen>;
}
