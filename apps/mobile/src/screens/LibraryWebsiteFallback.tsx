import React, { useLayoutEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import {
  getPublicSchoolInfo,
  getSafePublicSchoolWebsiteUrl,
} from '@campus/shared/src/publicSchoolInfo';
import { theme } from '../ui/theme';

/** The MOE directory verifies the university website, not a library or OPAC endpoint. */
export function LibraryWebsiteFallback({
  schoolId,
  schoolName,
}: {
  schoolId: string;
  schoolName: string;
}) {
  const info = getPublicSchoolInfo(schoolId, schoolName);
  const url = getSafePublicSchoolWebsiteUrl(info?.websiteUrl);
  const [failed, setFailed] = useState(false);
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const open = async () => {
    if (!active.current || !url) return;
    setFailed(false);
    try {
      await Linking.openURL(url);
    } catch {
      if (active.current) setFailed(true);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
        {url && info
          ? `尚未收錄${info.name}的館藏入口。可從學校官網查找「圖書館」。`
          : '請先確認所選學校，目前無法提供這所學校的圖書館連結。'}
      </Text>
      {url && info ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => void open()}
          style={{
            minHeight: 48,
            paddingHorizontal: 16,
            borderRadius: 12,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: theme.colors.accent,
          }}
        >
          <Text style={{ color: theme.colors.onAccent, fontWeight: '700' }}>
            開啟{info.name}官網
          </Text>
        </Pressable>
      ) : null}
      {failed ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
          無法開啟學校官網，請再試一次。
        </Text>
      ) : null}
    </View>
  );
}
