export type PresetId = 'favicon' | 'app'

export interface Preset {
  id: PresetId
  label: string
  hint: string
  sizes: number[]
}

export const PRESET_ORDER: PresetId[] = ['favicon', 'app']

export const PRESETS: Record<PresetId, Preset> = {
  favicon: {
    id: 'favicon',
    label: '网站 Favicon',
    hint: '16 · 32 · 64',
    sizes: [16, 32, 64],
  },
  app: {
    id: 'app',
    label: 'Windows 应用图标',
    hint: '16 · 32 · 64 · 128 · 256',
    sizes: [16, 32, 64, 128, 256],
  },
}

export function resolveSizes(presetId: PresetId): number[] {
  return PRESETS[presetId].sizes
}
