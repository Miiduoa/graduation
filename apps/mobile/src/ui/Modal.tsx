import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Modal as RNModal,
  Pressable,
  Text,
  View,
  StyleSheet,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "./navigationTheme";
import { theme, softShadowStyle } from "./theme";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

type ModalProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  animationType?: "fade" | "slide" | "none";
  size?: "small" | "medium" | "large" | "fullscreen";
  footer?: React.ReactNode;
};

export function Modal({
  visible,
  onClose,
  title,
  children,
  showCloseButton = true,
  closeOnBackdrop = true,
  animationType = "fade",
  size = "medium",
  footer,
}: ModalProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, friction: 9, tension: 80, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    }
  }, [visible]);

  const getSizeStyle = (): any => {
    switch (size) {
      case "small": return { width: "82%", maxHeight: SCREEN_HEIGHT * 0.4 };
      case "large": return { width: "94%", maxHeight: SCREEN_HEIGHT * 0.85 };
      case "fullscreen": return { width: "100%", height: "100%", borderRadius: 0 };
      default: return { width: "90%", maxHeight: SCREEN_HEIGHT * 0.7 };
    }
  };

  return (
    <RNModal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent accessibilityViewIsModal>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <TouchableWithoutFeedback onPress={closeOnBackdrop ? onClose : undefined} accessible={false}>
          <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.colors.overlay, opacity: fadeAnim }]} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.xl,
              borderWidth: 1,
              borderColor: theme.colors.border,
              overflow: "hidden",
              ...softShadowStyle(theme.shadows.soft),
            },
            getSizeStyle(),
            { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
          ]}
          accessible
          accessibilityRole="alert"
          accessibilityLabel={title || "對話框"}
          accessibilityViewIsModal
        >
          {(title || showCloseButton) && (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 22, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
              {title && (
                <Text style={{ fontSize: 18, fontWeight: "700", color: theme.colors.text, flex: 1, letterSpacing: -0.2 }} accessibilityRole="header">
                  {title}
                </Text>
              )}
              {showCloseButton && (
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="關閉"
                  style={({ pressed }) => ({
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: pressed ? theme.colors.surface2 : "transparent",
                    marginLeft: 12,
                  })}
                  hitSlop={8}
                >
                  <Ionicons name="close" size={20} color={theme.colors.muted} />
                </Pressable>
              )}
            </View>
          )}

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 22, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>

          {footer && (
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12, paddingHorizontal: 22, paddingVertical: 18, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
              {footer}
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

type AlertAction = {
  text: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
};

type AlertDialogProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  actions?: AlertAction[];
};

export function AlertDialog({
  visible,
  onClose,
  title,
  message,
  actions = [{ text: "確定", onPress: onClose }],
}: AlertDialogProps) {
  return (
    <Modal visible={visible} onClose={onClose} size="small" showCloseButton={false} closeOnBackdrop={false}>
      <View style={{ alignItems: "center", paddingTop: 4 }}>
        <Text style={{ fontSize: 18, fontWeight: "700", color: theme.colors.text, textAlign: "center", marginBottom: 8, letterSpacing: -0.2 }}>
          {title}
        </Text>
        {message && (
          <Text style={{ fontSize: 14, color: theme.colors.muted, textAlign: "center", lineHeight: 21, marginBottom: 22 }}>
            {message}
          </Text>
        )}
        <View style={{ flexDirection: "row", marginTop: 8, marginHorizontal: -22, marginBottom: -22, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          {actions.map((action, index) => (
            <Pressable
              key={index}
              onPress={() => { action.onPress?.(); onClose(); }}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 15,
                alignItems: "center",
                borderLeftWidth: index > 0 ? 1 : 0,
                borderLeftColor: theme.colors.border,
                backgroundColor: pressed ? theme.colors.surface2 : "transparent",
              })}
            >
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: action.style === "cancel" ? "400" : "600",
                  color: action.style === "destructive"
                    ? theme.colors.danger
                    : action.style === "cancel"
                      ? theme.colors.muted
                      : theme.colors.accent,
                }}
              >
                {action.text}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

type ConfirmDialogProps = {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

export function ConfirmDialog({
  visible, onClose, onConfirm, title, message,
  confirmText = "確定", cancelText = "取消", destructive = false,
}: ConfirmDialogProps) {
  return (
    <AlertDialog
      visible={visible}
      onClose={onClose}
      title={title}
      message={message}
      actions={[
        { text: cancelText, style: "cancel" },
        { text: confirmText, style: destructive ? "destructive" : "default", onPress: onConfirm },
      ]}
    />
  );
}

type LoadingModalProps = { visible: boolean; message?: string };

export function LoadingModal({ visible, message = "載入中..." }: LoadingModalProps) {
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      const animation = Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 800, useNativeDriver: true })
      );
      animation.start();
      return () => animation.stop();
    }
  }, [visible]);

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <RNModal visible={visible} transparent statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: "center", alignItems: "center" }}>
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.xl,
            padding: 28,
            alignItems: "center",
            minWidth: 130,
            borderWidth: 1,
            borderColor: theme.colors.border,
            ...softShadowStyle(theme.shadows.soft),
          }}
        >
          <Animated.View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              borderWidth: 3,
              borderColor: theme.colors.surface2,
              borderTopColor: theme.colors.accent,
              transform: [{ rotate: spin }],
              marginBottom: 14,
            }}
          />
          <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "500" }}>{message}</Text>
        </View>
      </View>
    </RNModal>
  );
}
