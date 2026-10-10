import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { safeNavigate } from '../utils/safeNavigate';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { useNuniSession } from '../state/nuniSession';

export default function LoginLandingScreen() {
  const navigation = useNavigation();
  const auth = useNuniSession();
  const s = useThemeStyleSheet(createStyles);
  return (
    <SafeAreaView testID="login-landing" style={s.page}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.brand}>CAMPUS ONE</Text>
        <View style={s.intro}>
          <Text style={s.school}>課程・校園・每天的事</Text>
          <Text style={s.heading}>你的課程，{'\n'}隨手就能查看。</Text>
          <Text style={s.body}>查看課程、掌握待辦，找到校園裡需要的資訊。</Text>
        </View>
        <View style={s.panel}>
          <Text style={s.title}>Campus One 帳號</Text>
          <Text style={s.body}>和網頁版使用同一個帳號，加入課程、繳交作業或管理店家。</Text>
          <Pressable
            testID="login-start"
            accessibilityRole="button"
            style={s.button}
            onPress={() => safeNavigate(navigation, 'NuniWorkspace')}
          >
            <Text style={s.buttonText}>
              {auth.session && !auth.loading && !auth.error && !auth.pendingLogout
                ? '回到我的 Campus One'
                : auth.loading
                  ? '確認 Campus One 帳號'
                  : auth.error || auth.pendingLogout
                    ? '繼續確認帳號狀態'
                    : '登入或建立帳號'}
            </Text>
          </Pressable>
        </View>
        <View style={s.schoolPanel}>
          <Text style={s.title}>連線學校帳號</Text>
          <Text style={s.body}>讀取學校提供的課表與成績。目前支援靜宜 E 校園。</Text>
          <Pressable
            testID="school-login-start"
            accessibilityRole="button"
            style={s.schoolButton}
            onPress={() => safeNavigate(navigation, 'SSOLogin')}
          >
            <Text style={s.schoolButtonText}>前往學校登入</Text>
          </Pressable>
        </View>
        <Text style={s.footer}>Campus One · 課程與校園生活</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const createStyles = () =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.colors.bg },
    content: { padding: 28, flexGrow: 1 },
    brand: {
      color: theme.colors.text,
      letterSpacing: 2,
      fontWeight: '700',
      fontSize: 14,
      marginTop: 16,
    },
    intro: { paddingVertical: 65 },
    school: { color: theme.colors.textSecondary, fontSize: 13, marginBottom: 18 },
    heading: {
      color: theme.colors.text,
      fontSize: 36,
      fontWeight: '600',
      lineHeight: 49,
      letterSpacing: -1,
    },
    body: { color: theme.colors.muted, fontSize: 14, lineHeight: 25, marginTop: 16 },
    panel: {
      padding: 24,
      backgroundColor: theme.colors.focusSurface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
    },
    title: { color: theme.colors.text, fontSize: 19, fontWeight: '600' },
    button: { backgroundColor: theme.colors.accent, padding: 15, borderRadius: 4, marginTop: 24 },
    buttonText: {
      color: theme.colors.onAccent,
      textAlign: 'center',
      fontSize: 15,
      fontWeight: '600',
    },
    schoolPanel: { paddingTop: 28 },
    schoolButton: { minHeight: 48, justifyContent: 'center', paddingVertical: 14, marginTop: 10 },
    schoolButtonText: { color: theme.colors.accent, fontSize: 15, fontWeight: '600' },
    footer: { color: theme.colors.muted, fontSize: 11, paddingVertical: 40 },
  });
