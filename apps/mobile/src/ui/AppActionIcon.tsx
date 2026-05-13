import { Image, type ImageStyle, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { generatedButtonIcons, type GeneratedButtonIconId } from './generatedButtonIcons';
import { GENERATED_ICON_IONICON } from './generatedButtonIonicons';
import { theme } from './theme';

export function AppActionIcon(props: {
  name: GeneratedButtonIconId;
  size: number;
  style?: StyleProp<ImageStyle | ViewStyle | TextStyle>;
  /** 使用 Ionicons 以提升小尺寸／網格內的語意辨識度 */
  fallback?: 'image' | 'ionicon';
  /** 僅在 fallback === 'ionicon' 時生效；預設跟隨主題主文字色 */
  color?: string;
}) {
  const fallback = props.fallback ?? 'image';
  if (fallback === 'ionicon') {
    const ionName = GENERATED_ICON_IONICON[props.name];
    const color = props.color ?? theme.colors.text;
    return (
      <Ionicons
        name={ionName}
        size={props.size}
        color={color}
        style={props.style as StyleProp<TextStyle>}
      />
    );
  }
  return (
    <Image
      source={generatedButtonIcons[props.name]}
      style={[{ width: props.size, height: props.size }, props.style as StyleProp<ImageStyle>]}
      resizeMode="contain"
    />
  );
}
