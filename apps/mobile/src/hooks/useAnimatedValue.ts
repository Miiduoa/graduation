import { useMemo } from "react";
import { Animated } from "react-native";
import { useConstant } from "./useLatestValue";

export function useAnimatedValue(initialValue: number): Animated.Value {
  return useConstant(() => new Animated.Value(initialValue));
}

export function useAnimatedAddition(
  left: Animated.Value,
  right: Animated.Value
): Animated.AnimatedAddition<number> {
  return useMemo(() => Animated.add(left, right), [left, right]);
}
