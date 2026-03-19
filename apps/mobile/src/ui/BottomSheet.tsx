import React, { useEffect, useRef, useCallback } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  Text,
  View,
  TouchableWithoutFeedback,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "./navigationTheme";
import { theme, softShadowStyle } from "./theme";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

function useSafeInsets() {
  const context = React.useContext(SafeAreaInsetsContext);
  return context ?? { top: 0, bottom: 0, left: 0, right: 0 };
}

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  snapPoints?: number[];
  enableDrag?: boolean;
  showHandle?: boolean;
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  footer?: React.ReactNode;
};

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  snapPoints = [0.5],
  enableDrag = true,
  showHandle = true,
  showCloseButton = false,
  closeOnBackdrop = true,
  footer,
}: BottomSheetProps) {
  const insets = useSafeInsets();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const currentSnapIndex = useRef(0);

  const heights = snapPoints.map((point) => SCREEN_HEIGHT * (1 - point));
  const maxHeight = SCREEN_HEIGHT * (1 - Math.max(...snapPoints));

  const animateToPosition = useCallback(
    (toValue: number, duration = 300) => {
      Animated.parallel([
        Animated.spring(translateY, { toValue, friction: 10, tension: 80, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: toValue >= SCREEN_HEIGHT ? 0 : 1, duration: duration / 2, useNativeDriver: true }),
      ]).start();
    },
    [backdropOpacity, translateY]
  );

  const close = useCallback(() => {
    animateToPosition(SCREEN_HEIGHT);
    setTimeout(onClose, 300);
  }, [animateToPosition, onClose]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => enableDrag,
      onMoveShouldSetPanResponder: (_, gs) => enableDrag && Math.abs(gs.dy) > 5,
      onPanResponderMove: (_, gs) => {
        const newY = heights[currentSnapIndex.current] + gs.dy;
        if (newY >= maxHeight) translateY.setValue(newY);
      },
      onPanResponderRelease: (_, gs) => {
        const currentY = heights[currentSnapIndex.current] + gs.dy;
        if (gs.vy > 0.5 || currentY > SCREEN_HEIGHT * 0.75) { close(); return; }
        if (gs.vy < -0.5 && currentSnapIndex.current < snapPoints.length - 1) {
          currentSnapIndex.current++;
          animateToPosition(heights[currentSnapIndex.current]);
          return;
        }
        let closestIndex = 0;
        let closestDistance = Math.abs(currentY - heights[0]);
        for (let i = 1; i < heights.length; i++) {
          const distance = Math.abs(currentY - heights[i]);
          if (distance < closestDistance) { closestDistance = distance; closestIndex = i; }
        }
        currentSnapIndex.current = closestIndex;
        animateToPosition(heights[closestIndex]);
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      currentSnapIndex.current = 0;
      translateY.setValue(SCREEN_HEIGHT);
      animateToPosition(heights[0]);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <TouchableWithoutFeedback onPress={closeOnBackdrop ? close : undefined}>
          <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.overlay, opacity: backdropOpacity }} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            maxHeight: SCREEN_HEIGHT - maxHeight,
            paddingBottom: insets.bottom,
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            borderWidth: 1,
            borderBottomWidth: 0,
            borderColor: theme.colors.border,
            ...softShadowStyle(theme.shadows.soft),
            transform: [{ translateY }],
          }}
          {...panResponder.panHandlers}
        >
          {showHandle && (
            <View style={{ alignItems: "center", paddingVertical: 12 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.colors.muted, opacity: 0.3 }} />
            </View>
          )}

          {(title || showCloseButton) && (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 22, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
              {title && <Text style={{ fontSize: 18, fontWeight: "700", color: theme.colors.text, flex: 1, letterSpacing: -0.2 }}>{title}</Text>}
              {showCloseButton && (
                <Pressable
                  onPress={close}
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

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 22, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }} showsVerticalScrollIndicator={false} bounces={false}>
            {children}
          </ScrollView>

          {footer && (
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12, paddingHorizontal: 22, paddingVertical: 18, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
              {footer}
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

type ActionSheetAction = {
  text: string;
  icon?: string;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

type ActionSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  actions: ActionSheetAction[];
  cancelText?: string;
};

export function ActionSheet({ visible, onClose, title, message, actions, cancelText = "取消" }: ActionSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoints={[0.35]} enableDrag showHandle>
      <View>
        {(title || message) && (
          <View style={{ alignItems: "center", paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border, marginBottom: 8 }}>
            {title && <Text style={{ fontSize: 16, fontWeight: "700", color: theme.colors.text, textAlign: "center" }}>{title}</Text>}
            {message && <Text style={{ fontSize: 13, color: theme.colors.muted, textAlign: "center", marginTop: 4, lineHeight: 19 }}>{message}</Text>}
          </View>
        )}

        <View style={{ marginBottom: 12 }}>
          {actions.map((action, index) => (
            <Pressable
              key={index}
              onPress={() => { action.onPress?.(); onClose(); }}
              disabled={action.disabled}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 15,
                paddingHorizontal: 16,
                borderRadius: theme.radius.md,
                backgroundColor: pressed ? theme.colors.surface2 : "transparent",
                opacity: action.disabled ? 0.4 : 1,
              })}
            >
              {action.icon && (
                <Ionicons
                  name={action.icon as any}
                  size={22}
                  color={action.destructive ? theme.colors.danger : theme.colors.text}
                  style={{ marginRight: 14 }}
                />
              )}
              <Text
                style={{
                  fontSize: 16,
                  color: action.destructive ? theme.colors.danger : theme.colors.text,
                  flex: 1,
                  fontWeight: "500",
                }}
              >
                {action.text}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={onClose}
          style={({ pressed }) => ({
            alignItems: "center",
            paddingVertical: 15,
            marginTop: 8,
            borderRadius: theme.radius.md,
            backgroundColor: pressed ? theme.colors.surface2 : theme.colors.bg,
          })}
        >
          <Text style={{ fontSize: 16, fontWeight: "600", color: theme.colors.accent }}>{cancelText}</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

type PickerOption<T> = {
  value: T;
  label: string;
  description?: string;
  icon?: string;
};

type BottomPickerProps<T> = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  options: PickerOption<T>[];
  value?: T;
  onSelect: (value: T) => void;
  multiple?: boolean;
  selectedValues?: T[];
};

export function BottomPicker<T>({
  visible, onClose, title, options, value, onSelect, multiple = false, selectedValues = [],
}: BottomPickerProps<T>) {
  const handleSelect = (v: T) => { onSelect(v); if (!multiple) onClose(); };
  const isSelected = (v: T) => multiple ? selectedValues.some((sv) => sv === v) : value === v;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} snapPoints={[0.5]} showCloseButton>
      <View>
        {options.map((option, index) => (
          <Pressable
            key={index}
            onPress={() => handleSelect(option.value)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 14,
              paddingHorizontal: 16,
              borderRadius: theme.radius.md,
              marginBottom: 4,
              backgroundColor: isSelected(option.value)
                ? theme.colors.accentSoft
                : pressed
                  ? theme.colors.surface2
                  : "transparent",
            })}
          >
            {option.icon && (
              <View style={{ width: 32, marginRight: 14 }}>
                <Ionicons
                  name={option.icon as any}
                  size={20}
                  color={isSelected(option.value) ? theme.colors.accent : theme.colors.muted}
                />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 16,
                  color: isSelected(option.value) ? theme.colors.accent : theme.colors.text,
                  fontWeight: isSelected(option.value) ? "600" : "400",
                }}
              >
                {option.label}
              </Text>
              {option.description && (
                <Text style={{ fontSize: 13, color: theme.colors.muted, marginTop: 2 }}>{option.description}</Text>
              )}
            </View>
            {isSelected(option.value) && <Ionicons name="checkmark" size={22} color={theme.colors.accent} />}
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}
