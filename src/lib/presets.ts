export type PresetId = 'app' | 'favicon'

export interface Preset {
  id: PresetId
  label: string
  hint: string
  sizes: number[]
}

export const PRESETS: Record<PresetId, Preset> = {
  app: {
    id: 'app',
    label: 'Windows 应用图标',
    hint: '16 · 32 · 48 · 256',
    sizes: [16, 32, 48, 256],
  },
  favicon: {
    id: 'favicon',
    label: '网站 Favicon',
    hint: '16 · 32',
    sizes: [16, 32],
  },
}

export function resolveSizes(
  presetId: PresetId,
  includeFavicon48: boolean,
): number[] {
  if (presetId === 'favicon' && includeFavicon48) {
    return [16, 32, 48]
  }
  return PRESETS[presetId].sizes
}
