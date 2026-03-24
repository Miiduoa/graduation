/* eslint-disable */
import React, { useEffect, useState, useMemo } from "react";
import { ScrollView, Text, TextInput, View, Pressable, Alert, Image, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { Screen, Card, Button, Pill, AnimatedCard, Avatar, ListItem, ToggleSwitch } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { getDb, uploadAvatar } from "../firebase";
import * as ImagePicker from "expo-image-picker";

type ValidationErrors = {
  displayName?: string;
  department?: string;
  studentId?: string;
  bio?: string;
  phone?: string;
};

export function ProfileEditScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();
  const db = getDb();

  const [displayName, setDisplayName] = useState("");
  const [department, setDepartment] = useState("");
  const [studentId, setStudentId] = useState("");
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [newAvatarLocalUri, setNewAvatarLocalUri] = useState<string | null>(null);
  const [isPublicProfile, setIsPublicProfile] = useState(true);
  const [allowDirectMessage, setAllowDirectMessage] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (auth.profile) {
      setDisplayName(auth.profile.displayName ?? "");
      setDepartment(auth.profile.department ?? "");
      setStudentId(auth.profile.studentId ?? "");
      setBio(auth.profile.bio ?? "");
      setPhone((auth.profile as any).phone ?? "");
      setAvatarUri((auth.profile as any).avatarUrl ?? null);
      setIsPublicProfile((auth.profile as any).isPublicProfile ?? true);
      setAllowDirectMessage((auth.profile as any).allowDirectMessage ?? true);
    }
  }, [auth.profile]);

  const validateForm = (): boolean => {
    const errors: ValidationErrors = {};
    
    if (displayName.trim().length > 50) {
      errors.displayName = "顯示名稱不可超過 50 字";
    }
    
    if (department.trim().length > 50) {
      errors.department = "系所名稱不可超過 50 字";
    }
    
    if (studentId.trim() && !/^[A-Za-z0-9]{1,20}$/.test(studentId.trim())) {
      errors.studentId = "學號格式不正確（英數字，最多 20 字）";
    }
    
    if (bio.trim().length > 500) {
      errors.bio = "自我介紹不可超過 500 字";
    }
    
    if (phone.trim() && !/^[0-9\-+() ]{0,20}$/.test(phone.trim())) {
      errors.phone = "電話格式不正確";
    }
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handlePickImage = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (!permissionResult.granted) {
        Alert.alert("需要權限", "請允許存取相簿以上傳頭像");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setNewAvatarLocalUri(result.assets[0].uri);
        setHasChanges(true);
      }
    } catch (e) {
      Alert.alert("錯誤", "無法選擇圖片");
    }
  };

  const handleTakePhoto = async () => {
    try {
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      
      if (!permissionResult.granted) {
        Alert.alert("需要權限", "請允許存取相機以拍攝頭像");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setNewAvatarLocalUri(result.assets[0].uri);
        setHasChanges(true);
      }
    } catch (e) {
      Alert.alert("錯誤", "無法拍攝照片");
    }
  };

  const showAvatarOptions = () => {
    Alert.alert(
      "更換頭像",
      "選擇頭像來源",
      [
        { text: "從相簿選擇", onPress: handlePickImage },
        { text: "拍攝照片", onPress: handleTakePhoto },
        ...((avatarUri || newAvatarLocalUri) ? [{ text: "移除頭像", onPress: () => { setAvatarUri(null); setNewAvatarLocalUri(null); setHasChanges(true); }, style: "destructive" as const }] : []),
        { text: "取消", style: "cancel" as const },
      ]
    );
  };

  const onSave = async () => {
    setErr(null);
    setSuccess(false);
    
    if (!auth.user) {
      setErr("請先登入");
      return;
    }

    if (!validateForm()) {
      setErr("請修正表單錯誤");
      return;
    }

    setSaving(true);
    try {
      let finalAvatarUrl = avatarUri;
      
      if (newAvatarLocalUri) {
        try {
          finalAvatarUrl = await uploadAvatar(auth.user.uid, newAvatarLocalUri);
        } catch (uploadErr: any) {
          console.warn("Avatar upload failed, saving profile without avatar update:", uploadErr);
          finalAvatarUrl = avatarUri;
          setNewAvatarLocalUri(null);
        }
      }
      
      await setDoc(
        doc(db, "users", auth.user.uid),
        {
          displayName: displayName.trim() || null,
          department: department.trim() || null,
          studentId: studentId.trim() || null,
          bio: bio.trim() || null,
          phone: phone.trim() || null,
          avatarUrl: finalAvatarUrl,
          isPublicProfile,
          allowDirectMessage,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      
      setAvatarUri(finalAvatarUrl);
      setNewAvatarLocalUri(null);
      await auth.refreshProfile();
      setSuccess(true);
      setHasChanges(false);
      Alert.alert("成功", "個人資料已更新");
    } catch (e: any) {
      setErr(e?.message ?? "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const handleFieldChange = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setHasChanges(true);
    setSuccess(false);
  };

  const completionPercentage = useMemo(() => {
    let filled = 0;
    const total = 5;
    if (displayName.trim()) filled++;
    if (department.trim()) filled++;
    if (studentId.trim()) filled++;
    if (bio.trim()) filled++;
    if (avatarUri || newAvatarLocalUri) filled++;
    return Math.round((filled / total) * 100);
  }, [displayName, department, studentId, bio, avatarUri, newAvatarLocalUri]);

  if (!auth.user) {
    return (
      <Screen>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
          <AnimatedCard title="編輯個人資料" subtitle="尚未登入">
            <View style={{ alignItems: "center", padding: 24 }}>
              <Ionicons name="person-circle-outline" size={64} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, marginTop: 16, textAlign: "center" }}>
                請先到『我的』登入後再編輯個人資料
              </Text>
              <View style={{ marginTop: 16 }}>
                <Button text="前往登入" kind="primary" onPress={() => nav?.navigate?.("MeHome")} />
              </View>
            </View>
          </AnimatedCard>
        </ScrollView>
      </Screen>
    );
  }

  const inputStyle = {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.text,
    fontSize: 15,
  };

  const errorInputStyle = {
    ...inputStyle,
    borderColor: theme.colors.danger,
  };

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        {/* Profile Completion Card */}
        <AnimatedCard title="" subtitle="">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <Pressable onPress={showAvatarOptions}>
              <View style={{ position: "relative" }}>
                {(newAvatarLocalUri || avatarUri) ? (
                  <Image
                    source={{ uri: newAvatarLocalUri || avatarUri! }}
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: 40,
                      borderWidth: 3,
                      borderColor: theme.colors.accent,
                    }}
                  />
                ) : (
                  <View
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: 40,
                      backgroundColor: theme.colors.accentSoft,
                      borderWidth: 3,
                      borderColor: theme.colors.accent,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 32 }}>
                      {displayName?.[0]?.toUpperCase() ?? auth.user?.email?.[0]?.toUpperCase() ?? "?"}
                    </Text>
                  </View>
                )}
                <View
                  style={{
                    position: "absolute",
                    bottom: 0,
                    right: 0,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: theme.colors.accent,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 2,
                    borderColor: theme.colors.bg,
                  }}
                >
                  <Ionicons name="camera" size={14} color="#fff" />
                </View>
              </View>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 18 }}>
                {displayName || auth.user.email || "未設定名稱"}
              </Text>
              <Text style={{ color: theme.colors.muted, marginTop: 4 }}>
                {department || "未設定系所"}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                <View style={{ flex: 1, height: 6, backgroundColor: theme.colors.border, borderRadius: 3 }}>
                  <View
                    style={{
                      width: `${completionPercentage}%`,
                      height: "100%",
                      backgroundColor: completionPercentage === 100 ? theme.colors.success : theme.colors.accent,
                      borderRadius: 3,
                    }}
                  />
                </View>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{completionPercentage}%</Text>
              </View>
              <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
                資料完整度
              </Text>
            </View>
          </View>
        </AnimatedCard>

        {/* Alerts */}
        {err && (
          <View style={{ padding: 12, borderRadius: theme.radius.md, backgroundColor: `${theme.colors.danger}15`, borderWidth: 1, borderColor: `${theme.colors.danger}30` }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="alert-circle" size={20} color={theme.colors.danger} />
              <Text style={{ color: theme.colors.danger, fontWeight: "600" }}>{err}</Text>
            </View>
          </View>
        )}

        {success && (
          <View style={{ padding: 12, borderRadius: theme.radius.md, backgroundColor: `${theme.colors.success}15`, borderWidth: 1, borderColor: `${theme.colors.success}30` }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
              <Text style={{ color: theme.colors.success, fontWeight: "600" }}>個人資料已更新</Text>
            </View>
          </View>
        )}

        {/* Basic Info */}
        <AnimatedCard title="基本資料" subtitle="這些資訊會顯示在你的個人檔案" delay={100}>
          <View style={{ gap: 16 }}>
            <View>
              <Text style={{ color: theme.colors.muted, marginBottom: 6 }}>顯示名稱</Text>
              <TextInput
                value={displayName}
                onChangeText={handleFieldChange(setDisplayName)}
                placeholder="例如：王小明"
                placeholderTextColor="rgba(168,176,194,0.6)"
                maxLength={50}
                style={validationErrors.displayName ? errorInputStyle : inputStyle}
              />
              {validationErrors.displayName && (
                <Text style={{ color: theme.colors.danger, fontSize: 12, marginTop: 4 }}>
                  {validationErrors.displayName}
                </Text>
              )}
              <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
                {displayName.length}/50
              </Text>
            </View>

            <View>
              <Text style={{ color: theme.colors.muted, marginBottom: 6 }}>系所/單位</Text>
              <TextInput
                value={department}
                onChangeText={handleFieldChange(setDepartment)}
                placeholder="例如：資訊工程系"
                placeholderTextColor="rgba(168,176,194,0.6)"
                maxLength={50}
                style={validationErrors.department ? errorInputStyle : inputStyle}
              />
              {validationErrors.department && (
                <Text style={{ color: theme.colors.danger, fontSize: 12, marginTop: 4 }}>
                  {validationErrors.department}
                </Text>
              )}
            </View>

            <View>
              <Text style={{ color: theme.colors.muted, marginBottom: 6 }}>學號/員工編號</Text>
              <TextInput
                value={studentId}
                onChangeText={handleFieldChange(setStudentId)}
                placeholder="例如：D1234567"
                placeholderTextColor="rgba(168,176,194,0.6)"
                autoCapitalize="characters"
                maxLength={20}
                style={validationErrors.studentId ? errorInputStyle : inputStyle}
              />
              {validationErrors.studentId && (
                <Text style={{ color: theme.colors.danger, fontSize: 12, marginTop: 4 }}>
                  {validationErrors.studentId}
                </Text>
              )}
            </View>

            <View>
              <Text style={{ color: theme.colors.muted, marginBottom: 6 }}>聯絡電話（選填）</Text>
              <TextInput
                value={phone}
                onChangeText={handleFieldChange(setPhone)}
                placeholder="例如：0912-345-678"
                placeholderTextColor="rgba(168,176,194,0.6)"
                keyboardType="phone-pad"
                maxLength={20}
                style={validationErrors.phone ? errorInputStyle : inputStyle}
              />
              {validationErrors.phone && (
                <Text style={{ color: theme.colors.danger, fontSize: 12, marginTop: 4 }}>
                  {validationErrors.phone}
                </Text>
              )}
            </View>

            <View>
              <Text style={{ color: theme.colors.muted, marginBottom: 6 }}>自我介紹</Text>
              <TextInput
                value={bio}
                onChangeText={handleFieldChange(setBio)}
                placeholder="簡單介紹自己、興趣、專長..."
                placeholderTextColor="rgba(168,176,194,0.6)"
                multiline
                maxLength={500}
                style={{
                  ...(validationErrors.bio ? errorInputStyle : inputStyle),
                  minHeight: 100,
                  textAlignVertical: "top",
                }}
              />
              {validationErrors.bio && (
                <Text style={{ color: theme.colors.danger, fontSize: 12, marginTop: 4 }}>
                  {validationErrors.bio}
                </Text>
              )}
              <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
                {bio.length}/500
              </Text>
            </View>
          </View>
        </AnimatedCard>

        {/* Privacy Settings */}
        <AnimatedCard title="隱私設定" subtitle="控制誰可以看到你的資料" delay={200}>
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>公開個人資料</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  允許同學校的成員查看你的資料
                </Text>
              </View>
              <ToggleSwitch value={isPublicProfile} onChange={(v) => { setIsPublicProfile(v); setHasChanges(true); }} />
            </View>

            <View style={{ height: 1, backgroundColor: theme.colors.border }} />

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>允許私訊</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  允許其他成員發送私訊給你
                </Text>
              </View>
              <ToggleSwitch value={allowDirectMessage} onChange={(v) => { setAllowDirectMessage(v); setHasChanges(true); }} />
            </View>
          </View>
        </AnimatedCard>

        {/* Account Info */}
        <AnimatedCard title="帳號資訊" subtitle="僅供顯示，無法在此修改" delay={300}>
          <View style={{ gap: 4 }}>
            <ListItem icon="mail-outline" title="Email" rightText={auth.user.email ?? "(無)"} />
            <ListItem icon="finger-print-outline" title="UID" rightText={`${auth.user.uid.slice(0, 12)}...`} />
            <ListItem icon="school-outline" title="學校" rightText={`${school.name}`} />
            <ListItem icon="shield-checkmark-outline" title="角色" rightText={auth.profile?.role ?? "student"} />
          </View>
        </AnimatedCard>

        {/* Save Button */}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              text={saving ? "儲存中..." : hasChanges ? "儲存變更" : "儲存"}
              kind="primary"
              disabled={saving || !hasChanges}
              onPress={onSave}
            />
          </View>
          <Button text="取消" onPress={() => nav?.goBack?.()} />
        </View>
      </ScrollView>
    </Screen>
  );
}
