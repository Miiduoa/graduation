import React from 'react';
import {
  ImageBackground,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from './theme';
import { generatedUiAssets } from './generatedUiAssets';
import type { WeatherAmbientTone } from '../services/weather';

type Variant = 'dashboard' | 'drawer' | 'personal';

function lightOverlayForAmbient(tone: WeatherAmbientTone): readonly [string, string, string] {
  switch (tone) {
    case 'clear':
      return ['rgba(255,253,248,0.93)', 'rgba(255,247,235,0.38)', 'rgba(255,255,255,0)'] as const;
    case 'cloud':
      return ['rgba(248,250,255,0.93)', 'rgba(234,241,252,0.42)', 'rgba(255,255,255,0)'] as const;
    case 'rain':
      return ['rgba(244,248,255,0.94)', 'rgba(228,238,255,0.48)', 'rgba(255,255,255,0)'] as const;
    default:
      return ['rgba(255,255,255,0.94)', 'rgba(255,255,255,0.42)', 'rgba(255,255,255,0)'] as const;
  }
}

function sourceForVariant(v: Variant): ImageSourcePropType {
  switch (v) {
    case 'dashboard':
      return generatedUiAssets.heroDashboard;
    case 'drawer':
      return generatedUiAssets.heroDashboardTall;
    case 'personal':
      return generatedUiAssets.heroPersonal;
    default:
      return generatedUiAssets.heroDashboard;
  }
}

/**
 * Flux 品牌圖為底、主題化漸層疊加，保持 `theme` 留白與對比。
 */
export function BrandFluxImageHeader(props: {
  variant: Variant;
  children: React.ReactNode;
  paddingTop: number;
  paddingBottom?: number;
  /** 依天氣的淺色疊色微調（深色模式維持既有對比） */
  ambientTone?: WeatherAmbientTone;
  /** 額外包在內容外層的 style（寬度、陰影等） */
  style?: StyleProp<ViewStyle>;
}) {
  const isDark = theme.mode === 'dark';
  const padB = props.paddingBottom ?? theme.space.md;
  const tone = props.ambientTone ?? 'default';
  const overlayColors = (
    isDark
      ? (['rgba(21,18,30,0.92)', 'rgba(21,18,30,0.55)', 'rgba(21,18,30,0.12)'] as const)
      : lightOverlayForAmbient(tone)
  );
  const source = sourceForVariant(props.variant);

  return (
    <ImageBackground
      source={source}
      resizeMode="cover"
      accessibilityIgnoresInvertColors
      imageStyle={{
        alignSelf: 'stretch',
      }}
      style={[{ width: '100%', paddingTop: props.paddingTop, paddingBottom: padB }, props.style]}
    >
      <LinearGradient
        colors={[...overlayColors]}
        locations={[0, 0.45, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <View style={{ position: 'relative' }}>{props.children}</View>
    </ImageBackground>
  );
}
