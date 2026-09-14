export interface ProviderSettings {
  providerName: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
}

export const defaultProviderSettings: ProviderSettings = {
  providerName: 'OpenAI Compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.2,
}

const storageKey = 'ai-enterprise-workspace.provider-settings'

export function readProviderSettings(): ProviderSettings {
  if (typeof window === 'undefined') return defaultProviderSettings
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return defaultProviderSettings
    return { ...defaultProviderSettings, ...JSON.parse(raw) }
  } catch {
    return defaultProviderSettings
  }
}

export function saveProviderSettings(settings: ProviderSettings) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey, JSON.stringify(settings))
}

export function maskApiKey(apiKey: string) {
  if (!apiKey) return '尚未设置'
  if (apiKey.length <= 8) return `${apiKey.slice(0, 2)}••••${apiKey.slice(-2)}`
  return `${apiKey.slice(0, 4)}••••••••${apiKey.slice(-4)}`
}

export function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, '')
}
