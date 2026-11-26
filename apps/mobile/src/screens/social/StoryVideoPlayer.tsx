import React from 'react';
import type { VideoProps } from 'expo-av';

// Older app installations can still open text and photo stories without this native module.
const nativeVideo = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- expo-av throws at import time when its native module is absent.
    return require('expo-av') as typeof import('expo-av');
  } catch {
    return null;
  }
})();

export const supportsStoryVideo = !!nativeVideo?.Video;

export function StoryVideoPlayer(props: VideoProps) {
  return nativeVideo ? (
    <nativeVideo.Video resizeMode={nativeVideo.ResizeMode.CONTAIN} {...props} />
  ) : null;
}
