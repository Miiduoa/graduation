import React, { useState, useCallback, useEffect } from "react";
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as AuthSession from "expo-auth-session";
import { Screen, Button, AnimatedCard, SegmentedControl, SearchBar, Spinner } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useSchedule } from "../state/schedule";
import { useSchool } from "../state/school";
import { useAuth } from "../state/auth";
import { getDataSource, hasDataSource } from "../data";
import type { Course as DataCourse } from "../data/types";
import { analytics } from "../services/analytics";
import { ssoService, SSOProvider } from "../services/sso";

type SSOCourseSyncProps = {
  onCoursesImported: (courses: DataCourse[]) => void;
  schoolId: string;
  semester: string;
};

function SSOCourseSync({ onCoursesImported, schoolId, semester }: SSOCourseSyncProps) {
  const auth = useAuth();
  const { school } = useSchool();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "authenticating" | "fetching" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fetchedCourses, setFetchedCourses] = useState<DataCourse[]>([]);
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());

  const ssoConfig = (school as any)?.ssoConfig as { 
    provider?: SSOProvider;
    authUrl?: string;
    clientId?: string;
    courseApiUrl?: string;
  } | undefined;

  const handleSSOLogin = async () => {
    if (!auth.user) {
      Alert.alert("請先登入", "需要登入才能連結教務系統");
      return;
    }

    setLoading(true);
    setStatus("authenticating");
    setErrorMessage(null);

    try {
      if (!ssoConfig?.provider || !ssoConfig?.authUrl) {
        setStatus("fetching");
        
        if (hasDataSource()) {
          const ds = getDataSource();
          const enrollments = await ds.listEnrollments(auth.user.uid, semester);
          const courses: DataCourse[] = [];
          
          for (const enrollment of enrollments) {
            if (enrollment.status === "enrolled" || enrollment.status === "completed") {
              const course = await ds.getCourse(enrollment.courseId);
              if (course) {
                courses.push(course);
              }
            }
          }
          
          if (courses.length > 0) {
            setFetchedCourses(courses);
            setSelectedCourses(new Set(courses.map(c => c.id)));
            setStatus("success");
            analytics.logEvent("sso_courses_fetched", { count: courses.length });
          } else {
            const serverCourses = await ds.listCourses(schoolId, { limit: 50 });
            if (serverCourses.length > 0) {
              setFetchedCourses(serverCourses);
              setStatus("success");
            } else {
              setErrorMessage("目前沒有可匯入的課程資料");
              setStatus("error");
            }
          }
        } else {
          setErrorMessage("無法連接到伺服器");
          setStatus("error");
        }
        return;
      }

      const redirectUri = AuthSession.makeRedirectUri({
        scheme: "campus-app",
        path: "sso-callback",
      });

      const authResult = await ssoService.authenticate(ssoConfig.provider, {
        authUrl: ssoConfig.authUrl,
        clientId: ssoConfig.clientId || "",
        redirectUri,
        schoolId,
      });

      if (!authResult.success || !authResult.accessToken) {
        throw new Error(authResult.error || "SSO 認證失敗");
      }

      setStatus("fetching");

      const courseApiUrl = ssoConfig.courseApiUrl || `${ssoConfig.authUrl.replace("/oauth/authorize", "/api/courses")}`;
      
      const response = await fetch(courseApiUrl, {
        headers: {
          Authorization: `Bearer ${authResult.accessToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("無法從教務系統獲取課程資料");
      }

      const data = await response.json();
      const courses: DataCourse[] = (data.courses || data.data || []).map((item: any, index: number) => ({
        id: item.id || `sso-${Date.now()}-${index}`,
        schoolId,
        code: item.code || item.courseCode || `COURSE-${index}`,
        name: item.name || item.courseName || item.title || "未命名課程",
        instructor: item.instructor || item.teacher || item.teacherName || "未知",
        credits: parseInt(item.credits) || 3,
        semester: item.semester || semester,
        schedule: (item.schedule || item.times || []).map((s: any) => ({
          dayOfWeek: s.day ?? s.dayOfWeek ?? 1,
          startTime: s.startTime || s.start || "08:00",
          endTime: s.endTime || s.end || "09:00",
          location: s.location || s.room || s.classroom || "未指定",
        })),
        capacity: item.capacity || 0,
        enrolled: item.enrolled || item.studentCount || 0,
      }));

      if (courses.length === 0) {
        setErrorMessage("教務系統中沒有找到課程資料");
        setStatus("error");
        return;
      }

      setFetchedCourses(courses);
      setSelectedCourses(new Set(courses.map(c => c.id)));
      setStatus("success");
      
      analytics.logEvent("sso_courses_fetched", { 
        count: courses.length,
        provider: ssoConfig.provider,
      });

    } catch (error) {
      console.error("SSO course sync error:", error);
      setErrorMessage(error instanceof Error ? error.message : "同步失敗，請稍後再試");
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  const toggleCourse = (courseId: string) => {
    setSelectedCourses(prev => {
      const next = new Set(prev);
      if (next.has(courseId)) {
        next.delete(courseId);
      } else {
        next.add(courseId);
      }
      return next;
    });
  };

  const handleImport = () => {
    const coursesToImport = fetchedCourses.filter(c => selectedCourses.has(c.id));
    if (coursesToImport.length === 0) {
      Alert.alert("請選擇課程", "請至少選擇一門課程匯入");
      return;
    }
    onCoursesImported(coursesToImport);
  };

  const handleSelectAll = () => {
    if (selectedCourses.size === fetchedCourses.length) {
      setSelectedCourses(new Set());
    } else {
      setSelectedCourses(new Set(fetchedCourses.map(c => c.id)));
    }
  };

  if (status === "success" && fetchedCourses.length > 0) {
    return (
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: theme.colors.success, fontWeight: "600" }}>
            找到 {fetchedCourses.length} 門課程
          </Text>
          <Pressable onPress={handleSelectAll}>
            <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>
              {selectedCourses.size === fetchedCourses.length ? "取消全選" : "全選"}
            </Text>
          </Pressable>
        </View>

        <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled>
          <View style={{ gap: 8 }}>
            {fetchedCourses.map((course, idx) => (
              <Pressable
                key={course.id}
                onPress={() => toggleCourse(course.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 12,
                  borderRadius: theme.radius.md,
                  backgroundColor: selectedCourses.has(course.id) 
                    ? theme.colors.accentSoft 
                    : theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: selectedCourses.has(course.id) 
                    ? theme.colors.accent 
                    : theme.colors.border,
                  gap: 12,
                }}
              >
                <View style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  borderWidth: 2,
                  borderColor: selectedCourses.has(course.id) ? theme.colors.accent : theme.colors.muted,
                  backgroundColor: selectedCourses.has(course.id) ? theme.colors.accent : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  {selectedCourses.has(course.id) && (
                    <Ionicons name="checkmark" size={16} color="#fff" />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "600" }} numberOfLines={1}>
                    {course.name}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                    {course.code} · {course.instructor} · {course.credits} 學分
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <Button
          text={`匯入選中的 ${selectedCourses.size} 門課程`}
          kind="primary"
          onPress={handleImport}
          disabled={selectedCourses.size === 0}
        />
        
        <Button
          text="重新同步"
          onPress={() => {
            setStatus("idle");
            setFetchedCourses([]);
            setSelectedCourses(new Set());
          }}
        />
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {status === "error" && errorMessage && (
        <View style={{ 
          padding: 12, 
          backgroundColor: `${theme.colors.danger}15`, 
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: `${theme.colors.danger}30`,
        }}>
          <Text style={{ color: theme.colors.danger, fontSize: 13 }}>
            {errorMessage}
          </Text>
        </View>
      )}

      {status === "authenticating" && (
        <View style={{ alignItems: "center", padding: 20 }}>
          <Spinner size={24} />
          <Text style={{ color: theme.colors.muted, marginTop: 8 }}>正在連接學校系統...</Text>
        </View>
      )}

      {status === "fetching" && (
        <View style={{ alignItems: "center", padding: 20 }}>
          <Spinner size={24} />
          <Text style={{ color: theme.colors.muted, marginTop: 8 }}>正在獲取課程資料...</Text>
        </View>
      )}

      {(status === "idle" || status === "error") && !loading && (
        <>
          <View style={{ 
            padding: 12, 
            backgroundColor: theme.colors.surface2, 
            borderRadius: theme.radius.md,
            gap: 8,
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="shield-checkmark" size={18} color={theme.colors.success} />
              <Text style={{ color: theme.colors.text, fontWeight: "600" }}>安全連線</Text>
            </View>
            <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
              使用學校 SSO 單一登入，我們不會儲存您的學校密碼。
            </Text>
          </View>

          <Button
            text={auth.user ? "連結教務系統" : "請先登入"}
            kind="primary"
            onPress={handleSSOLogin}
            disabled={!auth.user || loading}
          />

          {!auth.user && (
            <Text style={{ color: theme.colors.muted, fontSize: 12, textAlign: "center" }}>
              需要登入才能使用此功能
            </Text>
          )}
        </>
      )}
    </View>
  );
}

type WeekDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

type CourseTime = {
  day: WeekDay;
  startPeriod: number;
  endPeriod: number;
};

type Course = {
  id?: string;
  name: string;
  instructor: string;
  location: string;
  credits: number;
  times: CourseTime[];
  color: string;
  notes?: string;
};

const DAYS: { key: WeekDay; label: string }[] = [
  { key: "mon", label: "週一" },
  { key: "tue", label: "週二" },
  { key: "wed", label: "週三" },
  { key: "thu", label: "週四" },
  { key: "fri", label: "週五" },
  { key: "sat", label: "週六" },
  { key: "sun", label: "週日" },
];

const PERIODS = [
  { num: 1, time: "08:10-09:00" },
  { num: 2, time: "09:10-10:00" },
  { num: 3, time: "10:20-11:10" },
  { num: 4, time: "11:20-12:10" },
  { num: 5, time: "13:10-14:00" },
  { num: 6, time: "14:10-15:00" },
  { num: 7, time: "15:20-16:10" },
  { num: 8, time: "16:20-17:10" },
  { num: 9, time: "17:20-18:10" },
  { num: 10, time: "18:30-19:20" },
  { num: 11, time: "19:25-20:15" },
  { num: 12, time: "20:20-21:10" },
  { num: 13, time: "21:15-22:05" },
];

const COURSE_COLORS = [
  "#EF4444",
  "#F97316",
  "#F59E0B",
  "#EAB308",
  "#84CC16",
  "#22C55E",
  "#10B981",
  "#14B8A6",
  "#06B6D4",
  "#0EA5E9",
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#A855F7",
  "#D946EF",
  "#EC4899",
];

const SAMPLE_COURSES = [
  { name: "微積分", instructor: "王教授", credits: 3 },
  { name: "程式設計", instructor: "李教授", credits: 3 },
  { name: "資料結構", instructor: "張教授", credits: 3 },
  { name: "線性代數", instructor: "陳教授", credits: 3 },
  { name: "物理學", instructor: "劉教授", credits: 3 },
  { name: "統計學", instructor: "黃教授", credits: 3 },
];

export function AddCourseScreen(props: any) {
  const nav = props?.navigation;
  const editCourse = props?.route?.params?.course;
  const schedule = useSchedule();
  const { schoolId } = useSchool();

  const [selectedTab, setSelectedTab] = useState(0);
  const [name, setName] = useState(editCourse?.name ?? "");
  const [instructor, setInstructor] = useState(editCourse?.instructor ?? "");
  const [location, setLocation] = useState(editCourse?.location ?? "");
  const [credits, setCredits] = useState(editCourse?.credits?.toString() ?? "3");
  const [notes, setNotes] = useState(editCourse?.notes ?? "");
  const [selectedColor, setSelectedColor] = useState(editCourse?.color ?? COURSE_COLORS[0]);
  const [times, setTimes] = useState<CourseTime[]>(editCourse?.times ?? []);

  const [selectingTime, setSelectingTime] = useState(false);
  const [tempDay, setTempDay] = useState<WeekDay>("mon");
  const [tempStartPeriod, setTempStartPeriod] = useState(1);
  const [tempEndPeriod, setTempEndPeriod] = useState(1);

  const [searchQuery, setSearchQuery] = useState("");
  const [serverCourses, setServerCourses] = useState<DataCourse[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    analytics.logScreenView("AddCourse");
  }, []);

  useEffect(() => {
    async function loadServerCourses() {
      if (!hasDataSource()) return;
      
      setLoadingCourses(true);
      try {
        const ds = getDataSource();
        const courses = await ds.listCourses(schoolId);
        setServerCourses(courses);
      } catch (error) {
        console.error("Failed to load server courses:", error);
      } finally {
        setLoadingCourses(false);
      }
    }
    
    loadServerCourses();
  }, [schoolId]);

  const TABS = ["手動輸入", "選課系統"];

  const handleAddTime = () => {
    if (tempEndPeriod < tempStartPeriod) {
      Alert.alert("時間錯誤", "結束節次不能小於開始節次");
      return;
    }
    setTimes([...times, { day: tempDay, startPeriod: tempStartPeriod, endPeriod: tempEndPeriod }]);
    setSelectingTime(false);
  };

  const handleRemoveTime = (idx: number) => {
    setTimes(times.filter((_, i) => i !== idx));
  };

  const dayKeyToNumber = (day: WeekDay): number => {
    const mapping: Record<WeekDay, number> = {
      sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
    };
    return mapping[day];
  };

  const periodToTime = (period: number): string => {
    const p = PERIODS.find((p) => p.num === period);
    return p?.time.split("-")[0] ?? "08:00";
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("請輸入課程名稱", "課程名稱為必填欄位");
      return;
    }
    if (times.length === 0) {
      Alert.alert("請選擇上課時間", "請至少新增一個上課時段");
      return;
    }

    setSaving(true);
    try {
      const courseData: DataCourse = {
        id: editCourse?.id ?? `c${Date.now()}`,
        schoolId,
        code: `CUSTOM-${Date.now().toString(36).toUpperCase()}`,
        name: name.trim(),
        instructor: instructor.trim(),
        credits: parseInt(credits) || 3,
        semester: schedule.currentSemester,
        schedule: times.map((t) => ({
          dayOfWeek: dayKeyToNumber(t.day),
          startTime: periodToTime(t.startPeriod),
          endTime: periodToTime(t.endPeriod + 1),
          location: location.trim(),
        })),
        capacity: 0,
        enrolled: 0,
      };

      await schedule.addCourse(courseData);
      
      analytics.logEvent("course_added", {
        course_name: courseData.name,
        credits: courseData.credits,
      });
      
      Alert.alert(
        editCourse ? "課程已更新" : "課程已新增",
        `${courseData.name} 已${editCourse ? "更新" : "加入"}您的課表`,
        [{ text: "好", onPress: () => nav?.goBack?.() }]
      );
    } catch (error) {
      Alert.alert("錯誤", error instanceof Error ? error.message : "無法新增課程");
    } finally {
      setSaving(false);
    }
  };

  const handleSelectFromSystem = async (sample: typeof SAMPLE_COURSES[0] | DataCourse) => {
    if ("schedule" in sample && sample.schedule) {
      try {
        setSaving(true);
        await schedule.addCourse(sample as DataCourse);
        analytics.logEvent("course_added_from_server", {
          course_id: sample.id,
          course_name: sample.name,
        });
        Alert.alert("課程已新增", `${sample.name} 已加入您的課表`, [
          { text: "好", onPress: () => nav?.goBack?.() },
        ]);
        return;
      } catch (error) {
        Alert.alert("錯誤", error instanceof Error ? error.message : "無法新增課程");
        return;
      } finally {
        setSaving(false);
      }
    }
    
    setName(sample.name);
    setInstructor("instructor" in sample ? sample.instructor : "");
    setCredits(sample.credits.toString());
    setSelectedTab(0);
    Alert.alert("已選擇", `${sample.name}，請繼續填寫上課時間和地點`);
  };

  const formatTime = (t: CourseTime) => {
    const dayLabel = DAYS.find((d) => d.key === t.day)?.label;
    if (t.startPeriod === t.endPeriod) {
      return `${dayLabel} 第 ${t.startPeriod} 節`;
    }
    return `${dayLabel} 第 ${t.startPeriod}-${t.endPeriod} 節`;
  };

  const filteredSamples = SAMPLE_COURSES.filter(
    (c) =>
      c.name.includes(searchQuery) ||
      c.instructor.includes(searchQuery)
  );

  const filteredServerCourses = serverCourses.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.instructor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <SegmentedControl options={TABS} selected={selectedTab} onChange={setSelectedTab} />

        <ScrollView style={{ flex: 1, marginTop: 12 }} showsVerticalScrollIndicator={false}>
          {selectedTab === 0 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <AnimatedCard title="基本資訊">
                <View style={{ gap: 14 }}>
                  <View>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 6 }}>
                      課程名稱 *
                    </Text>
                    <TextInput
                      value={name}
                      onChangeText={setName}
                      placeholder="例如：微積分"
                      placeholderTextColor={theme.colors.muted}
                      style={{
                        padding: 14,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        color: theme.colors.text,
                        fontSize: 15,
                      }}
                    />
                  </View>
                  <View>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 6 }}>
                      授課教師
                    </Text>
                    <TextInput
                      value={instructor}
                      onChangeText={setInstructor}
                      placeholder="例如：王教授"
                      placeholderTextColor={theme.colors.muted}
                      style={{
                        padding: 14,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        color: theme.colors.text,
                        fontSize: 15,
                      }}
                    />
                  </View>
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <View style={{ flex: 2 }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 6 }}>
                        上課地點
                      </Text>
                      <TextInput
                        value={location}
                        onChangeText={setLocation}
                        placeholder="例如：工程館 301"
                        placeholderTextColor={theme.colors.muted}
                        style={{
                          padding: 14,
                          borderRadius: theme.radius.md,
                          backgroundColor: theme.colors.surface2,
                          color: theme.colors.text,
                          fontSize: 15,
                        }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 6 }}>
                        學分
                      </Text>
                      <TextInput
                        value={credits}
                        onChangeText={setCredits}
                        keyboardType="number-pad"
                        placeholder="3"
                        placeholderTextColor={theme.colors.muted}
                        style={{
                          padding: 14,
                          borderRadius: theme.radius.md,
                          backgroundColor: theme.colors.surface2,
                          color: theme.colors.text,
                          fontSize: 15,
                          textAlign: "center",
                        }}
                      />
                    </View>
                  </View>
                </View>
              </AnimatedCard>

              <AnimatedCard title="上課時間" delay={50}>
                <View style={{ gap: 12 }}>
                  {times.map((t, idx) => (
                    <View
                      key={idx}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        gap: 12,
                      }}
                    >
                      <Ionicons name="time" size={20} color={theme.colors.accent} />
                      <Text style={{ color: theme.colors.text, flex: 1, fontWeight: "600" }}>
                        {formatTime(t)}
                      </Text>
                      <Pressable onPress={() => handleRemoveTime(idx)}>
                        <Ionicons name="close-circle" size={22} color={theme.colors.danger} />
                      </Pressable>
                    </View>
                  ))}

                  {selectingTime ? (
                    <View
                      style={{
                        padding: 14,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        gap: 12,
                      }}
                    >
                      <Text style={{ color: theme.colors.text, fontWeight: "700" }}>選擇時段</Text>

                      <View>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 6 }}>
                          星期
                        </Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          <View style={{ flexDirection: "row", gap: 6 }}>
                            {DAYS.map((day) => (
                              <Pressable
                                key={day.key}
                                onPress={() => setTempDay(day.key)}
                                style={{
                                  paddingHorizontal: 14,
                                  paddingVertical: 8,
                                  borderRadius: theme.radius.md,
                                  backgroundColor:
                                    tempDay === day.key ? theme.colors.accent : theme.colors.surface,
                                }}
                              >
                                <Text
                                  style={{
                                    color: tempDay === day.key ? "#fff" : theme.colors.text,
                                    fontWeight: "600",
                                  }}
                                >
                                  {day.label}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        </ScrollView>
                      </View>

                      <View style={{ flexDirection: "row", gap: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 6 }}>
                            開始節次
                          </Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                            <View style={{ flexDirection: "row", gap: 4 }}>
                              {PERIODS.map((p) => (
                                <Pressable
                                  key={p.num}
                                  onPress={() => setTempStartPeriod(p.num)}
                                  style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 18,
                                    backgroundColor:
                                      tempStartPeriod === p.num
                                        ? theme.colors.accent
                                        : theme.colors.surface,
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  <Text
                                    style={{
                                      color:
                                        tempStartPeriod === p.num ? "#fff" : theme.colors.text,
                                      fontWeight: "600",
                                      fontSize: 13,
                                    }}
                                  >
                                    {p.num}
                                  </Text>
                                </Pressable>
                              ))}
                            </View>
                          </ScrollView>
                        </View>
                      </View>

                      <View>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 6 }}>
                          結束節次
                        </Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          <View style={{ flexDirection: "row", gap: 4 }}>
                            {PERIODS.filter((p) => p.num >= tempStartPeriod).map((p) => (
                              <Pressable
                                key={p.num}
                                onPress={() => setTempEndPeriod(p.num)}
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 18,
                                  backgroundColor:
                                    tempEndPeriod === p.num
                                      ? theme.colors.accent
                                      : theme.colors.surface,
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <Text
                                  style={{
                                    color: tempEndPeriod === p.num ? "#fff" : theme.colors.text,
                                    fontWeight: "600",
                                    fontSize: 13,
                                  }}
                                >
                                  {p.num}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        </ScrollView>
                      </View>

                      <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                        <Button
                          text="取消"
                          onPress={() => setSelectingTime(false)}
                          style={{ flex: 1 }}
                        />
                        <Button
                          text="新增"
                          kind="primary"
                          onPress={handleAddTime}
                          style={{ flex: 1 }}
                        />
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => setSelectingTime(true)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 14,
                        borderRadius: theme.radius.md,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        borderStyle: "dashed",
                        gap: 8,
                      }}
                    >
                      <Ionicons name="add-circle-outline" size={20} color={theme.colors.accent} />
                      <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>
                        新增上課時段
                      </Text>
                    </Pressable>
                  )}
                </View>
              </AnimatedCard>

              <AnimatedCard title="顏色標籤" delay={100}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  {COURSE_COLORS.map((color) => (
                    <Pressable
                      key={color}
                      onPress={() => setSelectedColor(color)}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: color,
                        alignItems: "center",
                        justifyContent: "center",
                        borderWidth: selectedColor === color ? 3 : 0,
                        borderColor: theme.colors.text,
                      }}
                    >
                      {selectedColor === color && (
                        <Ionicons name="checkmark" size={22} color="#fff" />
                      )}
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>

              <AnimatedCard title="備註" delay={150}>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="其他備註資訊..."
                  placeholderTextColor={theme.colors.muted}
                  multiline
                  numberOfLines={3}
                  style={{
                    padding: 14,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surface2,
                    color: theme.colors.text,
                    fontSize: 15,
                    minHeight: 80,
                    textAlignVertical: "top",
                  }}
                />
              </AnimatedCard>

              <Button
                text={saving ? "儲存中..." : editCourse ? "儲存變更" : "新增課程"}
                kind="primary"
                onPress={handleSave}
                disabled={saving}
              />
            </View>
          )}

          {selectedTab === 1 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <AnimatedCard title="從選課系統匯入" subtitle="選擇課程後自動加入課表">
                <View style={{ gap: 12 }}>
                  <SearchBar
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="搜尋課程名稱、代碼或教師"
                  />
                </View>
              </AnimatedCard>

              {loadingCourses && (
                <View style={{ alignItems: "center", padding: 20 }}>
                  <Spinner />
                  <Text style={{ color: theme.colors.muted, marginTop: 8 }}>載入學校課程...</Text>
                </View>
              )}

              {!loadingCourses && filteredServerCourses.length > 0 && (
                <>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginLeft: 4 }}>
                    學校課程（{filteredServerCourses.length} 門）
                  </Text>
                  {filteredServerCourses.slice(0, 20).map((course, idx) => (
                    <AnimatedCard key={course.id} delay={idx * 20}>
                      <Pressable
                        onPress={() => handleSelectFromSystem(course)}
                        disabled={saving}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 14,
                          opacity: saving ? 0.5 : 1,
                        }}
                      >
                        <View
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 24,
                            backgroundColor: `${COURSE_COLORS[idx % COURSE_COLORS.length]}20`,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons name="school" size={24} color={COURSE_COLORS[idx % COURSE_COLORS.length]} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>
                            {course.name}
                          </Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                            {course.code}
                          </Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
                            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                              {course.instructor}
                            </Text>
                            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>·</Text>
                            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                              {course.credits} 學分
                            </Text>
                          </View>
                        </View>
                        <Ionicons name="add-circle" size={26} color={theme.colors.accent} />
                      </Pressable>
                    </AnimatedCard>
                  ))}
                </>
              )}

              {!loadingCourses && filteredServerCourses.length === 0 && searchQuery && (
                <Text style={{ color: theme.colors.muted, textAlign: "center", padding: 20 }}>
                  找不到符合「{searchQuery}」的課程
                </Text>
              )}

              <Text style={{ color: theme.colors.muted, fontSize: 12, marginLeft: 4, marginTop: 8 }}>
                範例課程
              </Text>
              {filteredSamples.map((sample, idx) => (
                <AnimatedCard key={sample.name} delay={idx * 30}>
                  <Pressable
                    onPress={() => handleSelectFromSystem(sample)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    <View
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 24,
                        backgroundColor: `${COURSE_COLORS[idx % COURSE_COLORS.length]}20`,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="book" size={24} color={COURSE_COLORS[idx % COURSE_COLORS.length]} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>
                        {sample.name}
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                          {sample.instructor}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>·</Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                          {sample.credits} 學分
                        </Text>
                      </View>
                    </View>
                    <Ionicons name="add-circle" size={26} color={theme.colors.accent} />
                  </Pressable>
                </AnimatedCard>
              ))}

              <AnimatedCard title="同步教務系統" delay={200}>
                <View style={{ gap: 12 }}>
                  <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>
                    一鍵同步您在學校教務系統的課表，省去手動輸入的麻煩。
                  </Text>
                  <SSOCourseSync 
                    onCoursesImported={async (courses) => {
                      for (const course of courses) {
                        try {
                          await schedule.addCourse(course);
                        } catch (error) {
                          console.warn(`Course ${course.name} conflict:`, error);
                        }
                      }
                      if (courses.length > 0) {
                        Alert.alert(
                          "匯入完成",
                          `已成功匯入 ${courses.length} 門課程到您的課表`,
                          [{ text: "好", onPress: () => nav?.goBack?.() }]
                        );
                      }
                    }}
                    schoolId={schoolId}
                    semester={schedule.currentSemester}
                  />
                </View>
              </AnimatedCard>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
