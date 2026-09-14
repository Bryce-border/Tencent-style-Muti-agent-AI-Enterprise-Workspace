import type { ProviderSettings } from './settings'
import { normalizeBaseUrl } from './settings'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export class OpenAICompatibleClient {
  constructor(private readonly settings: ProviderSettings) {}

  async complete(messages: ChatMessage[], signal?: AbortSignal) {
    const response = await fetch(`${normalizeBaseUrl(this.settings.baseUrl)}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages,
        temperature: this.settings.temperature,
      }),
    })

    const payload = (await response.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[]
      error?: { message?: string }
    }

    if (!response.ok) {
      throw new Error(payload.error?.message || `模型服务返回 ${response.status}`)
    }

    return payload.choices?.[0]?.message?.content || ''
  }
}

/**
 * The UI uses the deterministic demo runtime by default. This adapter is kept
 * deliberately small so a real provider can be enabled without changing the
 * Supervisor/Worker contracts.
 */
export function createLlmClient(settings: ProviderSettings) {
  if (!settings.apiKey.trim()) return null
  return new OpenAICompatibleClient(settings)
}
