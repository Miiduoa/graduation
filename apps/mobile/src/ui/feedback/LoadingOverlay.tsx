import React, { useEffect, useMemo } from "react";
import { Animated, Easing, Text, View } from "react-native";
import { useAnimatedValue } from "../../hooks/useAnimatedValue";
import { softShadowStyle, theme } from "../theme";

export function LoadingOverlay(props: { visible: boolean; message?: string }) {
  const spinAnim = useAnimatedValue(0);

  useEffect(() => {
    if (!props.visible) {
      spinAnim.stopAnimation();
      spinAnim.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    animation.start();

    return () => {
      animation.stop();
      spinAnim.setValue(0);
    };
  }, [props.visible, spinAnim]);

  const spin = useMemo(
    () =>
      spinAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ["0deg", "360deg"],
      }),
    [spinAnim]
  );

  if (!props.visible) return null;

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.colors.overlay,
        justifyContent: "center",
        alignItems: "center",
        zIndex: 1000,
      }}
      accessibilityRole="alert"
      accessibilityLabel={props.message ?? "載入中"}
    >
      <View
        style={{
          padding: 28,
          borderRadius: theme.radius.xl,
          backgroundColor: theme.colors.surfaceElevated,
          alignItems: "center",
          gap: 14,
          minWidth: 120,
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
            borderColor: theme.colors.accent,
            borderTopColor: "transparent",
            transform: [{ rotate: spin }],
          }}
        />
        {props.message ? (
          <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "500" }}>
            {props.message}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
