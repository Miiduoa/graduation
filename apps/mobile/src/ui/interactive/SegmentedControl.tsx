import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useAnimatedValue } from '../../hooks/useAnimatedValue';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { theme } from '../theme';
import { useThemeVersion } from '../useThemeStyleSheet';

type SegmentId = string | number;
type SegmentOption<Id extends SegmentId> =
  | Id
  | ({ label: string; disabled?: boolean } & ({ id: Id } | { key: Id }));

function optionId<Id extends SegmentId>(option: SegmentOption<Id>): Id {
  if (typeof option !== 'object') return option;
  return 'id' in option ? option.id : option.key;
}

export function SegmentedControl<const Id extends SegmentId>(props: {
  options: readonly SegmentOption<Id>[];
  selected?: NoInfer<Id>;
  disabled?: boolean;
  onSelect?: (id: NoInfer<Id>) => void;
  onChange?: (id: NoInfer<Id>) => void;
}) {
  useThemeVersion();
  const reducedMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const selected =
    props.selected ?? (props.options.length ? optionId(props.options[0]) : undefined);
  const handleChange = props.onSelect ?? props.onChange;

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        padding: 3,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surface2,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        gap: 2,
      }}
    >
      {props.options.map((option) => {
        const id = optionId(option);
        const label = typeof option === 'object' ? option.label : String(option);
        const isSelected = id === selected;
        const disabled = Boolean(props.disabled || (typeof option === 'object' && option.disabled));
        return (
          <Pressable
            key={id}
            onPress={() => {
              if (!disabled) handleChange?.(id);
            }}
            disabled={disabled}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: isSelected, disabled }}
            style={({ pressed }) => ({
              flexGrow: 1,
              flexBasis: 64 * Math.max(1, fontScale),
              maxWidth: '100%',
              minHeight: 44,
              paddingVertical: theme.space.sm,
              paddingHorizontal: theme.space.sm,
              borderRadius: theme.radius.sm,
              backgroundColor: pressed && !isSelected ? theme.colors.surfaceInteractiveStrong : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: disabled ? 0.5 : 1,
            })}
          >
            <SegmentHighlight selected={isSelected} reducedMotion={reducedMotion} />
            <Text
              style={{
                fontSize: 13,
                fontWeight: isSelected ? '600' : '500',
                color: isSelected ? theme.colors.accent : theme.colors.muted,
                textAlign: 'center',
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SegmentHighlight({
  selected,
  reducedMotion,
}: {
  selected: boolean;
  reducedMotion: boolean;
}) {
  const opacity = useAnimatedValue(selected ? 1 : 0);
  const previous = useRef(selected);
  useEffect(() => {
    const changed = previous.current !== selected;
    previous.current = selected;
    if (reducedMotion || !changed) {
      opacity.setValue(selected ? 1 : 0);
      return;
    }
    const transition = Animated.timing(opacity, {
      toValue: selected ? 1 : 0,
      duration: theme.animation.fast,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
      isInteraction: false,
    });
    transition.start();
    return () => transition.stop();
  }, [opacity, reducedMotion, selected]);

  return (
    <Animated.View
      accessible={false}
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: theme.radius.sm,
          backgroundColor: theme.colors.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          opacity,
        },
      ]}
    />
  );
}
