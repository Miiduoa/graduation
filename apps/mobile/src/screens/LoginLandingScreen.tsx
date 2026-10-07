import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { safeNavigate } from '../utils/safeNavigate';

export default function LoginLandingScreen() {
  const navigation = useNavigation();
  return (
    <SafeAreaView style={s.page}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.brand}>CAMPUS ONE</Text>
        <View style={s.intro}>
          <Text style={s.school}>靜宜大學</Text>
          <Text style={s.heading}>你的課程，{'\n'}隨手就能查看。</Text>
          <Text style={s.body}>查看課程、掌握待辦，找到校園裡需要的資訊。</Text>
        </View>
        <View style={s.panel}>
          <Text style={s.title}>登入你的校園帳號</Text>
          <Text style={s.body}>使用學校帳號登入，查看個人課程與通知。</Text>
          <Pressable
            accessibilityRole="button"
            style={s.button}
            onPress={() => safeNavigate(navigation, 'SSOLogin')}
          >
            <Text style={s.buttonText}>前往登入 ↗</Text>
          </Pressable>
        </View>
        <Text style={s.footer}>Campus One · 課程與校園生活</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8f7f3' },
  content: { padding: 28, flexGrow: 1 },
  brand: { color: '#243b35', letterSpacing: 2, fontWeight: '700', fontSize: 14, marginTop: 16 },
  intro: { paddingVertical: 65 },
  school: { color: '#526750', fontSize: 13, marginBottom: 18 },
  heading: { color: '#243b35', fontSize: 36, fontWeight: '600', lineHeight: 49, letterSpacing: -1 },
  body: { color: '#626e67', fontSize: 14, lineHeight: 25, marginTop: 16 },
  panel: {
    padding: 24,
    backgroundColor: '#e6ece5',
    borderColor: '#d4ded3',
    borderWidth: 1,
    borderRadius: 8,
  },
  title: { color: '#243b35', fontSize: 19, fontWeight: '600' },
  button: { backgroundColor: '#28483b', padding: 15, borderRadius: 4, marginTop: 24 },
  buttonText: { color: '#fff', textAlign: 'center', fontSize: 15, fontWeight: '600' },
  footer: { color: '#626e67', fontSize: 11, paddingVertical: 40 },
});
