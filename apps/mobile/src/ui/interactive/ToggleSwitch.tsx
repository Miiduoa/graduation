import React, { useEffect } from "react";
import { Animated, Pressable } from "react-native";
import { useAnimatedValue } from "../../hooks/useAnimatedValue";
import { softShadowStyle, theme } from "../theme";

export function ToggleSwitch(props: {
  value: boolean;
  onChange?: (value: boolean) => void;
  onToggle?: (value: boolean) => void;
  disabled?: boolean;
  size?: "default" | "small";
}) {
  const handlePress = () => {
    if (props.disabled) return;
    const newValue = !props.value;
    props.onChange?.(newValue);
    props.onToggle?.(newValue);
  };

  const isSmall = props.size === "small";
  const width = isSmall ? 44 : 52;
  const height = isSmall ? 26 : 31;
  const thumbSize = isSmall ? 20 : 25;
  const translateX = useAnimatedValue(props.value ? width - thumbSize - 4 : 3);

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: props.value ? width - thumbSize - 4 : 3,
      useNativeDriver: true,
      friction: 8,
      tension: 65,
    }).start();
  }, [props.value, thumbSize, translateX, width]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="switch"
      accessibilityState={{ checked: props.value, disabled: props.disabled }}
      accessibilityLabel={props.value ? "開啟" : "關閉"}
      style={({ pressed }) => ({
        width,
        height,
        borderRadius: height / 2,
        backgroundColor: props.value ? theme.colors.accent : theme.colors.surface2,
        justifyContent: "center",
        opacity: props.disabled ? 0.4 : pressed ? 0.85 : 1,
      })}
    >
      <Animated.View
        style={{
          width: thumbSize,
          height: thumbSize,
          borderRadius: thumbSize / 2,
          backgroundColor: "#fff",
          transform: [{ translateX }],
          ...softShadowStyle(theme.shadows.soft),
        }}
      />
    </Pressable>
  );
}
