import { useEffect, useState } from 'react'
import { Icon } from '../icons'
import {
  defaultProviderSettings,
  maskApiKey,
  normalizeBaseUrl,
  readProviderSettings,
  saveProviderSettings,
  type ProviderSettings,
} from '../lib/settings'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  onSaved: (settings: ProviderSettings) => void
}

type TestState = 'idle' | 'testing' | 'success' | 'error'

export function SettingsDialog({ open, onClose, onSaved }: SettingsDialogProps) {
  const [settings, setSettings] = useState<ProviderSettings>(defaultProviderSettings)
  const [showKey, setShowKey] = useState(false)
  const [testState, setTestState] = useState<TestState>('idle')
  const [testMessage, setTestMessage] = useState('')

  useEffect(() => {
    if (!open) return
    setSettings(readProviderSettings())
    setTestState('idle')
    setTestMessage('')
  }, [open])

  if (!open) return null

  const update = (patch: Partial<ProviderSettings>) => setSettings((current) => ({ ...current, ...patch }))

  const save = async () => {
    const next = { ...settings, baseUrl: normalizeBaseUrl(settings.baseUrl) }
    saveProviderSettings(next)
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
    } catch {
      // The browser-only demo is intentionally usable without starting the API.
    }
    onSaved(next)
    onClose()
  }

  const testConnection = async () => {
    setTestState('testing')
    setTestMessage('正在连接模型服务…')
    try {
      const response = await fetch('/api/provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, baseUrl: normalizeBaseUrl(settings.baseUrl) }),
      })
      const payload = (await response.json().catch(() => ({}))) as { message?: string }
      if (!response.ok) throw new Error(payload.message || '连接测试失败')
      setTestState('success')
      setTestMessage(payload.message || '连接成功，模型服务可用')
    } catch (error) {
      setTestState('error')
      setTestMessage(error instanceof Error ? error.message : '暂时无法连接 API 服务')
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">WORKSPACE SETTINGS</span>
            <h2 id="settings-title">模型与连接</h2>
            <p>随时切换第三方模型，保存后新的任务立即使用最新配置。</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭设置" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="provider-callout">
          <div className="provider-mark"><Icon name="sparkles" size={19} /></div>
          <div>
            <strong>{settings.providerName || 'OpenAI Compatible'}</strong>
            <span>支持 OpenAI-compatible API，包括自建网关、DeepSeek、通义千问等。</span>
          </div>
          <span className="connection-dot"><i /> 可配置</span>
        </div>

        <div className="settings-form">
          <label className="field wide">
            <span>Provider 名称</span>
            <input value={settings.providerName} onChange={(event) => update({ providerName: event.target.value })} placeholder="例如：公司模型网关" />
          </label>
          <label className="field wide">
            <span>Base URL</span>
            <input value={settings.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" spellCheck={false} />
            <small>填写到 <code>/v1</code> 层级，不要包含 <code>/chat/completions</code>。</small>
          </label>
          <label className="field">
            <span>Model Name</span>
            <input value={settings.model} onChange={(event) => update({ model: event.target.value })} placeholder="例如：deepseek-chat" spellCheck={false} />
          </label>
          <label className="field">
            <span>Temperature <em>{settings.temperature.toFixed(1)}</em></span>
            <input className="range-input" type="range" min="0" max="1" step="0.1" value={settings.temperature} onChange={(event) => update({ temperature: Number(event.target.value) })} />
          </label>
          <label className="field wide">
            <span>API Key</span>
            <div className="secret-input">
              <input type={showKey ? 'text' : 'password'} value={settings.apiKey} onChange={(event) => update({ apiKey: event.target.value })} placeholder={maskApiKey(settings.apiKey)} autoComplete="off" spellCheck={false} />
              <button type="button" onClick={() => setShowKey((visible) => !visible)}>{showKey ? '隐藏' : '显示'}</button>
            </div>
            <small><Icon name="shield" size={13} /> v1 默认保存在当前浏览器；接入后端代理时密钥不会返回前端明文。</small>
          </label>
        </div>

        {testState !== 'idle' && <div className={`test-message ${testState}`}><span className="test-icon">{testState === 'testing' ? '…' : testState === 'success' ? '✓' : '!'}</span>{testMessage}</div>}

        <div className="dialog-footer">
          <span className="saved-hint">当前配置：{settings.apiKey ? maskApiKey(settings.apiKey) : '本地演示模式'}</span>
          <div className="footer-actions">
            <button className="button secondary" type="button" onClick={testConnection}><Icon name="activity" size={16} /> 测试连接</button>
            <button className="button primary" type="button" onClick={save}>保存配置 <Icon name="arrow" size={16} /></button>
          </div>
        </div>
      </section>
    </div>
  )
}
