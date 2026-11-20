/**
 * `assets/generated-game`：開發側預設以 Pillow 免費組圖：`python3 scripts/generate-campus-game-flux.py`
 *（可加 `--comfy` 試本機 ComfyUI；manifest 見 [scripts/campus-game-assets-manifest.json](../../../../scripts/campus-game-assets-manifest.json)）
 */
export const generatedGameAssets = {
  avatarF1: require('../../assets/generated-game/game-avatar-f1.png'),
  avatarF2: require('../../assets/generated-game/game-avatar-f2.png'),
  avatarF3: require('../../assets/generated-game/game-avatar-f3.png'),
  sceneCampus: require('../../assets/generated-game/game-scene-campus.png'),
} as const;

export const gameAvatarFrames = [
  generatedGameAssets.avatarF1,
  generatedGameAssets.avatarF2,
  generatedGameAssets.avatarF3,
] as const;
