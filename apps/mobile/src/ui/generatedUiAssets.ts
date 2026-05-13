import type { ImageSourcePropType } from 'react-native';

/**
 * ComfyUI Flux.1-dev UI 插畫（`/apps/mobile/assets/generated-ui`）
 * 再生：`AI圖像本地引擎/.venv/bin/python scripts/generate-flux-ui-asset-pack.py --out-dir apps/mobile/assets/generated-ui`
 *
 * 約略尺寸（像素，實際以生成腳本為準）：
 * - flux-hero-dashboard: 1216×512
 * - flux-hero-dashboard-tall: 832×704
 * - flux-hero-personal: 1024×584
 * - flux-empty-{relaxed|spark|route}: 592×416
 * - flux-pattern-soft: 384×384（可平鋪）
 *
 * 並行產物可含 `.webp`；App 仍以 PNG `require` 以維持 Metro 相容。
 */
export const generatedUiAssets = {
  heroDashboard: require('../../assets/generated-ui/flux-hero-dashboard.png'),
  heroDashboardTall: require('../../assets/generated-ui/flux-hero-dashboard-tall.png'),
  heroPersonal: require('../../assets/generated-ui/flux-hero-personal.png'),
  emptyRelaxed: require('../../assets/generated-ui/flux-empty-relaxed.png'),
  emptySpark: require('../../assets/generated-ui/flux-empty-spark.png'),
  emptyRoute: require('../../assets/generated-ui/flux-empty-route.png'),
  patternSoft: require('../../assets/generated-ui/flux-pattern-soft.png'),
} satisfies Record<string, ImageSourcePropType>;
