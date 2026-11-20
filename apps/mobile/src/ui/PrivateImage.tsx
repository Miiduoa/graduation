import React from 'react';
import { Image, Text, type ImageProps } from 'react-native';
import { usePrivateMedia } from '../services/usePrivateMedia';

export function PrivateImage(props: ImageProps & { uri: string }) {
  const url = usePrivateMedia(props.uri);
  if (!url) return <Text accessibilityRole="text">照片暫時無法顯示</Text>;
  return <Image {...props} source={{ uri: url }} />;
}
