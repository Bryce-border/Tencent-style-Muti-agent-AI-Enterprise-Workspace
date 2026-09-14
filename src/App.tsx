import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, type IconName } from './icons'
import { agentMap, agents, navGroups, seededTasks } from './data'
import { activity, createTask, makeResult, wait } from './orchestrator'
import { SettingsDialog } from './components/SettingsDialog'
import { readProviderSettings, type ProviderSettings } from './lib/settings'
import type { Agent, AgentId, PlanStep, StepStatus, TaskStatus, ViewKey, WorkspaceTask } from './types'
import './styles.css'

const viewLabels: Record<ViewKey, string> = {
  dashboard: '工作台',
  team: 'AI 团队',
  tasks: '任务中心',
  knowledge: '知识库',
  documents: '文档',
  analytics: '数据分析',
  meetings: '会议',
  messages: '通讯助手',
}

const statusMeta: Record<TaskStatus, { label: string; className: string }> = {
  planning: { label: '规划中', className: 'status-planning' },
  running: { label: '协作中', className: 'status-running' },
  reviewing: { label: '审核中', className: 'status-reviewing' },
  completed: { label: '已完成', className: 'status-completed' },
  needs_input: { label: '待确认', className: 'status-input' },
}

const stepStatusMeta: Record<StepStatus, { label: string; className: string }> = {
  pending: { label: '等待中', className: 'step-pending' },
  working: { label: '执行中', className: 'step-working' },
  done: { label: '已完成', className: 'step-done' },
  needs_revision: { label: '需要补充', className: 'step-warning' },
}

function AgentAvatar({ agentId, size = 'small', active = false }: { agentId: AgentId; size?: 'tiny' | 'small' | 'medium' | 'large'; active?: boolean }) {
  const agent = agentMap[agentId]
  return (
    <span className={`agent-avatar avatar-${size} ${active ? 'avatar-active' : ''}`} style={{ background: agent.color, color: agent.accent }} title={agent.name}>
      {agent.initials}
      {active && <i className="avatar-pulse" />}
    </span>
  )
}

function StatusPill({ status }: { status: TaskStatus }) {
  const meta = statusMeta[status]
  return <span className={`status-pill ${meta.className}`}><i />{meta.label}</span>
}

function ProgressBar({ value, tone = 'purple' }: { value: number; tone?: 'purple' | 'green' }) {
  return <div className={`progress-track progress-${tone}`}><span style={{ width: `${value}%` }} /></div>
}

function Sidebar({ view, onNavigate, open, onClose, onOpenSettings }: { view: ViewKey; onNavigate: (view: ViewKey) => void; open: boolean; onClose: () => void; onOpenSettings: () => void }) {
  return (
    <>
      {open && <button className="mobile-scrim" type="button" aria-label="关闭导航" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-symbol"><span /><span /><span /><span /></div>
          <div><strong>AI Workspace</strong><small>Enterprise Intelligence</small></div>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">A</div>
          <div><strong>Acme 产品中心</strong><span>团队工作空间</span></div>
          <Icon name="chevron" size={15} className="switcher-chevron" />
        </div>

        <nav className="main-nav" aria-label="主导航">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {group.items.map((item) => (
                <button className={`nav-item ${view === item.key ? 'nav-item-active' : ''}`} type="button" key={item.key} onClick={() => { onNavigate(item.key); onClose() }}>
                  <Icon name={item.icon as IconName} size={18} />
                  <span>{item.label}</span>
                  {'badge' in item && item.badge && <em>{item.badge}</em>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="plan-card">
          <div className="plan-card-heading"><span>本月 AI 额度</span><strong>68%</strong></div>
          <ProgressBar value={68} />
          <p>已完成 128 个任务</p>
          <button type="button" onClick={onOpenSettings}>管理模型连接 <Icon name="arrow" size={13} /></button>
        </div>
        <button className="sidebar-settings" type="button" onClick={onOpenSettings}><Icon name="settings" size={17} /> 工作空间设置</button>
        <div className="profile-row">
          <div className="profile-avatar">李</div>
          <div><strong>李想</strong><span>产品负责人</span></div>
          <Icon name="more" size={17} className="profile-more" />
        </div>
      </aside>
    </>
  )
}

function Topbar({ view, onMenu, onOpenSettings }: { view: ViewKey; onMenu: () => void; onOpenSettings: () => void }) {
  return (
    <header className="topbar">
      <button className="mobile-menu icon-button" type="button" aria-label="打开导航" onClick={onMenu}><Icon name="menu" /></button>
      <div className="breadcrumbs"><span>Acme 产品中心</span><Icon name="chevron" size={14} /><strong>{viewLabels[view]}</strong></div>
      <div className="topbar-actions">
        <label className="global-search"><Icon name="search" size={17} /><input placeholder="搜索任务、Agent 或文档" /><kbd>⌘ K</kbd></label>
        <button className="icon-button notification-button" type="button" aria-label="通知"><Icon name="bell" size={19} /><i /></button>
        <button className="top-avatar" type="button" aria-label="打开个人菜单">李</button>
        <button className="icon-button top-settings" type="button" aria-label="模型设置" onClick={onOpenSettings}><Icon name="settings" size={18} /></button>
      </div>
    </header>
  )
}

function Hero({ prompt, onPromptChange, onSubmit, onSuggestion }: { prompt: string; onPromptChange: (value: string) => void; onSubmit: (event: FormEvent) => void; onSuggestion: (value: string) => void }) {
  const suggestions = ['准备明天的客户会议', '分析本月销售数据', '生成项目周报并同步群聊']
  return (
    <section className="hero-card">
      <div className="hero-orb hero-orb-one" />
      <div className="hero-orb hero-orb-two" />
      <div className="hero-content">
        <span className="hero-kicker"><span className="live-dot" /> AI TEAM ONLINE</span>
        <h1>把复杂工作，交给<br /><span>你的 AI 团队。</span></h1>
        <p>说出你想完成的目标，AI 管家会自动拆解任务，组织专业 Agent 协作完成。</p>
        <form className="prompt-composer" onSubmit={onSubmit}>
          <div className="composer-icon"><Icon name="sparkles" size={19} /></div>
          <input value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="例如：帮我准备明天的客户会议…" aria-label="输入工作目标" />
          <button className="composer-attach" type="button" aria-label="添加附件"><Icon name="paperclip" size={18} /></button>
          <button className="composer-submit" type="submit" aria-label="启动任务"><Icon name="arrow" size={18} /></button>
        </form>
        <div className="suggestion-row"><span>试试这样说</span>{suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => onSuggestion(suggestion)}>{suggestion}</button>)}</div>
      </div>
      <div className="hero-side-note">
        <div className="mini-flow-header"><span className="mini-flow-icon"><Icon name="activity" size={15} /></span><span>实时协作</span><i>LIVE</i></div>
        <div className="mini-flow-line"><AgentAvatar agentId="supervisor" size="tiny" active /><div className="flow-dash" /><AgentAvatar agentId="data" size="tiny" /><div className="flow-dash" /><AgentAvatar agentId="writer" size="tiny" /><div className="flow-dash" /><AgentAvatar agentId="reviewer" size="tiny" /></div>
        <strong>4 个 Agent 正在协作</strong><span>平均完成时间 2.4 min</span>
      </div>
    </section>
  )
}

function StatCard({ label, value, delta, detail, icon, tone }: { label: string; value: string; delta?: string; detail: string; icon: IconName; tone: string }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}><Icon name={icon} size={19} /></div>
      <div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{delta && <em>{delta}</em>}{detail}</small></div>
      <Icon name="more" size={18} className="stat-more" />
    </div>
  )
}

function TaskRow({ task, selected, onClick }: { task: WorkspaceTask; selected: boolean; onClick: () => void }) {
  const agentIds = task.agents.filter((id) => id !== 'supervisor').slice(0, 4)
  return (
    <button className={`task-row ${selected ? 'task-row-selected' : ''}`} type="button" onClick={onClick}>
      <div className="task-row-main"><div className={`task-type-mark ${task.status === 'completed' ? 'type-complete' : 'type-running'}`}><Icon name={task.status === 'completed' ? 'check' : 'activity'} size={16} /></div><div><strong>{task.title}</strong><span>{task.prompt}</span></div></div>
      <div className="task-row-agents"><div className="avatar-stack">{agentIds.map((id) => <AgentAvatar key={id} agentId={id} size="tiny" active={task.currentAgent === id} />)}</div><span>{task.agents.length} agents</span></div>
      <div className="task-row-progress"><div><StatusPill status={task.status} /><span>{task.progress}%</span></div><ProgressBar value={task.progress} tone={task.status === 'completed' ? 'green' : 'purple'} /></div>
      <div className="task-row-time"><span>{task.updatedAt}</span><Icon name="chevron" size={16} /></div>
    </button>
  )
}

function ActivityItem({ item }: { item: WorkspaceTask['activities'][number] }) {
  return <div className="activity-item"><AgentAvatar agentId={item.agentId} size="tiny" /><div><p><strong>{agentMap[item.agentId].name}</strong>{item.message}</p><span>{item.time}</span></div>{item.tone === 'success' && <Icon name="check" size={14} className="activity-check" />}</div>
}

function WorkflowPanel({ task }: { task?: WorkspaceTask }) {
  if (!task) return <div className="surface workflow-panel empty-panel"><Icon name="sparkles" size={26} /><strong>选择一个任务</strong><span>查看 Agent 协作路径与实时产出</span></div>
  const groups = [...new Set(task.steps.map((item) => item.group))].sort((a, b) => a - b)
  return (
    <aside className="surface workflow-panel">
      <div className="panel-heading"><div><span className="eyebrow">COLLABORATION TRACE</span><h3>协作路径</h3></div><button className="icon-button" type="button" aria-label="更多操作"><Icon name="more" size={18} /></button></div>
      <div className="workflow-caption"><StatusPill status={task.status} /><span>第 {Math.max(task.iteration, 1)} 轮协作</span><span className="workflow-time"><Icon name="clock" size={13} /> {task.updatedAt}</span></div>
      <div className="workflow-graph">
        {groups.map((group, groupIndex) => {
          const items = task.steps.filter((item) => item.group === group)
          return <div className="workflow-group" key={group}>
            <div className="workflow-group-label">{group === 0 ? 'PLAN' : group === 1 ? 'PARALLEL' : group === 2 ? 'SYNTHESIS' : group === 3 ? 'REVIEW' : 'DELIVERY'}</div>
            <div className={`workflow-nodes ${items.length > 1 ? 'workflow-nodes-parallel' : ''}`}>
              {items.map((item) => <WorkflowNode key={item.id} step={item} />)}
            </div>
            {groupIndex < groups.length - 1 && <div className="workflow-connector"><span /></div>}
          </div>
        })}
      </div>
      {task.feedback && <div className="feedback-banner"><span><Icon name="refresh" size={15} /></span><div><strong>Reviewer 触发反馈闭环</strong><p>{task.feedback}</p></div></div>}
      <div className="activity-heading"><h4>实时动态</h4><span>{task.activities.length} 条事件</span></div>
      <div className="activity-list">{task.activities.slice(-4).reverse().map((item) => <ActivityItem item={item} key={item.id} />)}</div>
      {task.result ? <ResultCard result={task.result} /> : <div className="running-result"><div className="typing-dots"><i /><i /><i /></div><div><strong>AI 团队正在整理最终结果</strong><span>完成后会自动生成可分享的交付卡片</span></div></div>}
    </aside>
  )
}

function WorkflowNode({ step }: { step: PlanStep }) {
  const agent = agentMap[step.agentId]
  const meta = stepStatusMeta[step.status]
  return <div className={`workflow-node ${meta.className}`}><div className="workflow-node-top"><AgentAvatar agentId={step.agentId} size="tiny" active={step.status === 'working'} /><span className="node-state">{step.status === 'done' ? <Icon name="check" size={12} /> : step.status === 'working' ? <i className="node-spinner" /> : step.status === 'needs_revision' ? '!' : '·'}</span></div><strong>{agent.name}</strong><span>{step.title}</span><small>{meta.label}{step.duration && ` · ${step.duration}`}</small></div>
}

function ResultCard({ result }: { result: NonNullable<WorkspaceTask['result']> }) {
  return <div className="result-card"><div className="result-card-heading"><span className="result-check"><Icon name="check" size={15} /></span><div><span>FINAL OUTPUT</span><strong>{result.title}</strong></div><button type="button" aria-label="打开结果"><Icon name="external" size={15} /></button></div><p>{result.summary}</p><ul>{result.bullets.map((bullet) => <li key={bullet}><Icon name="check" size={13} />{bullet}</li>)}</ul><div className="result-metrics">{result.metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}</div><button className="result-action" type="button">打开完整结果 <Icon name="arrow" size={14} /></button></div>
}

function TeamPanel({ onNavigate }: { onNavigate: (view: ViewKey) => void }) {
  const featured = agents.filter((agent) => ['supervisor', 'data', 'knowledge', 'writer'].includes(agent.id))
  return <div className="surface team-panel"><div className="panel-heading"><div><span className="eyebrow">YOUR AI WORKFORCE</span><h3>AI 团队</h3></div><button className="text-button" type="button" onClick={() => onNavigate('team')}>查看全部 <Icon name="arrow" size={14} /></button></div><div className="team-list">{featured.map((agent) => <button className="team-list-row" type="button" key={agent.id} onClick={() => onNavigate('team')}><AgentAvatar agentId={agent.id} size="medium" active={agent.state === 'working'} /><div><strong>{agent.name}</strong><span>{agent.role.split('·')[1]?.trim() ?? agent.role}</span></div><span className={`agent-online ${agent.state === 'working' ? 'is-working' : ''}`}><i />{agent.state === 'working' ? '工作中' : '在线'}</span><Icon name="chevron" size={15} /></button>)}</div><button className="invite-agent" type="button" onClick={() => onNavigate('team')}><span><Icon name="plus" size={15} /></span> 创建新的 AI 员工</button></div>
}

function Dashboard({ tasks, selectedTaskId, onSelectTask, prompt, onPromptChange, onSubmit, onSuggestion, onNavigate }: { tasks: WorkspaceTask[]; selectedTaskId: string; onSelectTask: (id: string) => void; prompt: string; onPromptChange: (value: string) => void; onSubmit: (event: FormEvent) => void; onSuggestion: (value: string) => void; onNavigate: (view: ViewKey) => void }) {
  const selectedTask = tasks.find((task) => task.id === selectedTaskId)
  const activeTasks = tasks.filter((task) => task.status !== 'completed')
  return <>
    <Hero prompt={prompt} onPromptChange={onPromptChange} onSubmit={onSubmit} onSuggestion={onSuggestion} />
    <div className="stats-grid"><StatCard label="进行中的任务" value="03" delta="+2 " detail="较昨日" icon="activity" tone="stat-purple" /><StatCard label="今日已完成" value="18" delta="+24% " detail="完成效率" icon="check" tone="stat-green" /><StatCard label="AI 团队效率" value="94.6%" delta="+6.2% " detail="本周提升" icon="trend" tone="stat-orange" /><StatCard label="知识库资料" value="1,284" detail="份企业文档" icon="book" tone="stat-blue" /></div>
    <div className="section-heading"><div><span className="eyebrow">AT A GLANCE</span><h2>正在发生的协作</h2></div><button className="text-button" type="button" onClick={() => onNavigate('tasks')}>查看任务中心 <Icon name="arrow" size={14} /></button></div>
    <div className="dashboard-grid"><section className="surface tasks-panel"><div className="panel-heading"><div><h3>最近任务</h3><span className="panel-subtitle">AI 团队正在替你推进工作</span></div><button className="icon-button" type="button" aria-label="任务筛选"><Icon name="filter" size={17} /></button></div><div className="task-list">{[...activeTasks, ...tasks.filter((task) => task.status === 'completed')].slice(0, 4).map((task) => <TaskRow task={task} selected={task.id === selectedTaskId} onClick={() => onSelectTask(task.id)} key={task.id} />)}</div><button className="load-more" type="button" onClick={() => onNavigate('tasks')}>查看全部任务 <Icon name="arrow" size={14} /></button></section><WorkflowPanel task={selectedTask} /></div>
    <div className="below-grid"><TeamPanel onNavigate={onNavigate} /><div className="surface insight-panel"><div className="panel-heading"><div><span className="eyebrow">WORKSPACE INSIGHT</span><h3>本周协作趋势</h3></div><button className="icon-button" type="button" aria-label="更多操作"><Icon name="more" size={18} /></button></div><div className="insight-chart"><div className="chart-y-labels"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div><div className="chart-area"><div className="chart-grid-lines"><i /><i /><i /><i /><i /></div><svg viewBox="0 0 500 170" preserveAspectRatio="none" aria-label="本周协作趋势图"><defs><linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#7569dd" stopOpacity=".22" /><stop offset="1" stopColor="#7569dd" stopOpacity="0" /></linearGradient></defs><path d="M0 135 C38 128, 56 112, 84 118 S132 91, 164 106 S210 85, 240 91 S287 68, 318 78 S357 55, 391 65 S432 33, 500 38 V170 H0Z" fill="url(#areaFill)" /><path d="M0 135 C38 128, 56 112, 84 118 S132 91, 164 106 S210 85, 240 91 S287 68, 318 78 S357 55, 391 65 S432 33, 500 38" fill="none" stroke="#7569dd" strokeWidth="3" strokeLinecap="round" /></svg><div className="chart-x-labels"><span>周一</span><span>周二</span><span>周三</span><span>周四</span><span>周五</span><span>周六</span><span>周日</span></div></div></div><div className="insight-footer"><span><i className="legend-dot" />完成任务</span><strong>+32.8% <Icon name="trend" size={14} /></strong><small>相比上周</small></div></div></div>
  </>
}

function TeamPage({ onCreateTask }: { onCreateTask: () => void }) {
  return <div className="page-stack"><div className="page-intro team-intro"><div><span className="eyebrow">AI WORKFORCE</span><h1>认识你的 AI 团队</h1><p>每个 Agent 都有清晰的职责、工具和知识边界。AI 管家会在需要时自动组织他们协作。</p></div><button className="button primary" type="button" onClick={onCreateTask}><Icon name="plus" size={17} /> 创建协作任务</button></div><div className="team-summary-row"><div><strong>08</strong><span>个 AI 员工</span></div><div><strong>128</strong><span>已完成任务</span></div><div><strong>96.4%</strong><span>平均质量分</span></div><div className="team-summary-quote"><Icon name="sparkles" size={18} /><span>“你提出目标，团队负责交付。”</span></div></div><div className="agent-grid">{agents.map((agent) => <AgentCard agent={agent} key={agent.id} />)}</div></div>
}

function AgentCard({ agent }: { agent: Agent }) {
  return <article className="agent-card"><div className="agent-card-top"><AgentAvatar agentId={agent.id} size="large" active={agent.state === 'working'} /><button className="icon-button" type="button" aria-label={`${agent.name} 更多操作`}><Icon name="more" size={18} /></button></div><span className="agent-role">{agent.role}</span><h3>{agent.name}</h3><p>{agent.description}</p><div className="skill-row">{agent.skills.map((skill) => <span key={skill}>{skill}</span>)}</div><div className="agent-card-footer"><span><Icon name="check" size={13} /> {agent.completedTasks} 次完成</span><span className="agent-online"><i />{agent.state === 'working' ? '工作中' : '在线'}</span></div></article>
}

function TasksPage({ tasks, selectedTaskId, onSelectTask }: { tasks: WorkspaceTask[]; selectedTaskId: string; onSelectTask: (id: string) => void }) {
  const [filter, setFilter] = useState<'all' | TaskStatus>('all')
  const visible = filter === 'all' ? tasks : tasks.filter((task) => task.status === filter)
  return <div className="page-stack"><div className="page-intro"><div><span className="eyebrow">TASK CENTER</span><h1>任务中心</h1><p>所有由你发起、由 AI 团队推进的工作，都在这里留下清晰轨迹。</p></div><button className="button secondary" type="button"><Icon name="filter" size={16} /> 筛选与排序</button></div><div className="task-toolbar"><div className="filter-tabs">{([['all', '全部任务'], ['running', '进行中'], ['completed', '已完成'], ['needs_input', '待确认']] as const).map(([key, label]) => <button type="button" className={filter === key ? 'filter-tab-active' : ''} onClick={() => setFilter(key)} key={key}>{label}<em>{key === 'all' ? tasks.length : tasks.filter((task) => task.status === key).length}</em></button>)}</div><span className="toolbar-result">最近更新 <Icon name="chevron" size={14} /></span></div><div className="surface all-tasks-panel"><div className="all-tasks-head"><span>任务</span><span>协作团队</span><span>状态 / 进度</span><span>更新时间</span></div>{visible.map((task) => <TaskRow task={task} selected={task.id === selectedTaskId} onClick={() => onSelectTask(task.id)} key={task.id} />)}{visible.length === 0 && <div className="empty-state"><Icon name="tasks" size={28} /><strong>暂时没有匹配任务</strong><span>换一个筛选条件试试</span></div>}</div></div>
}

function ModulePage({ view, onCreateTask }: { view: Exclude<ViewKey, 'dashboard' | 'team' | 'tasks'>; onCreateTask: () => void }) {
  const content = {
    knowledge: { eyebrow: 'KNOWLEDGE HUB', title: '企业知识库', description: '让每一次回答都有依据，让团队经验可以被持续复用。', icon: 'book' as IconName, stat: '1,284', statLabel: '份已索引资料', accent: 'module-warm', cards: [['产品与技术', '486 份', '最近更新 12 分钟前'], ['项目与流程', '328 份', '最近更新 1 小时前'], ['制度与规范', '214 份', '最近更新 昨天'], ['客户与市场', '256 份', '最近更新 3 天前']] },
    documents: { eyebrow: 'DOCUMENTS', title: '文档工作台', description: '上传、整理、总结企业文档，把阅读时间还给真正重要的决策。', icon: 'file' as IconName, stat: '42', statLabel: '本周处理文档', accent: 'module-blue', cards: [['管理层周报模板.docx', 'Word · 2.4 MB', '刚刚由文档专家处理'], ['Q3 产品路线图.pdf', 'PDF · 8.1 MB', '今天 09:12 已索引'], ['客户会议纪要-0724.md', 'Markdown · 24 KB', '昨天 18:04 已同步'], ['销售数据字典.xlsx', 'Excel · 1.2 MB', '昨天 16:30 已索引']] },
    analytics: { eyebrow: 'DATA STUDIO', title: '数据分析', description: '用自然语言提问业务数据，快速得到有上下文、有证据的结论。', icon: 'chart' as IconName, stat: '18', statLabel: '本周分析任务', accent: 'module-green', cards: [['销售经营看板', '环比 +12.8%', '数据更新时间 09:30'], ['客户增长分析', '新增 248 人', '数据更新时间 昨天'], ['交付健康度', '健康度 86/100', '数据更新时间 周一'], ['异常订单监控', '3 个待跟进', '实时监控中']] },
    meetings: { eyebrow: 'MEETING ASSISTANT', title: '会议助手', description: '从会议记录到行动项，帮助团队把共识变成下一步。', icon: 'calendar' as IconName, stat: '16', statLabel: '本月整理会议', accent: 'module-purple', cards: [['产品评审会', '明天 10:00', '已生成会议 Brief'], ['周例会', '今天 14:00', '等待会议记录'], ['客户沟通会', '周四 15:30', '已准备议程'], ['研发同步会', '周五 11:00', '自动提取行动项']] },
    messages: { eyebrow: 'COMMUNICATION HUB', title: '通讯助手', description: '让 AI 结果自然抵达微信、项目群和团队成员。', icon: 'message' as IconName, stat: '06', statLabel: '个已连接渠道', accent: 'module-cyan', cards: [['AI Workspace 项目群', '工作台内置', '最近发送 2 分钟前'], ['研发协作群', '企业微信', '最近发送 今天 08:50'], ['管理层周报群', '微信适配器', '最近发送 昨天 18:00'], ['产品反馈频道', 'Slack 适配器', '最近发送 周一']] },
  }[view]
  return <div className="page-stack"><div className="page-intro"><div><span className="eyebrow">{content.eyebrow}</span><h1>{content.title}</h1><p>{content.description}</p></div><button className="button primary" type="button" onClick={onCreateTask}><Icon name="sparkles" size={16} /> 让 AI 开始工作</button></div><div className={`module-hero ${content.accent}`}><div className="module-hero-icon"><Icon name={content.icon} size={23} /></div><div><span>Workspace intelligence</span><strong>{content.stat}</strong><p>{content.statLabel}</p></div><div className="module-hero-quote">每一份资料，都会成为团队下一次决策的上下文。</div></div><div className="module-toolbar"><label className="module-search"><Icon name="search" size={17} /><input placeholder={`搜索${content.title}…`} /></label><button className="button secondary" type="button"><Icon name="plus" size={16} /> 新建</button></div><div className="module-card-grid">{content.cards.map(([title, meta, update]) => <article className="module-item" key={title}><div className="module-item-icon"><Icon name={content.icon} size={19} /></div><div><h3>{title}</h3><span>{meta}</span><small>{update}</small></div><button className="icon-button" type="button" aria-label="打开"><Icon name="external" size={15} /></button></article>)}</div></div>
}

export default function App() {
  const [view, setView] = useState<ViewKey>('dashboard')
  const [tasks, setTasks] = useState<WorkspaceTask[]>(seededTasks)
  const [selectedTaskId, setSelectedTaskId] = useState('task-001')
  const [prompt, setPrompt] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(readProviderSettings)
  const [toast, setToast] = useState('')
  const runningIds = useRef(new Set<string>())

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const updateTask = (id: string, updater: (task: WorkspaceTask) => WorkspaceTask) => {
    setTasks((current) => current.map((task) => task.id === id ? updater(task) : task))
  }

  const simulateTask = async (task: WorkspaceTask) => {
    if (runningIds.current.has(task.id)) return
    runningIds.current.add(task.id)
    const commit = (updater: (current: WorkspaceTask) => WorkspaceTask) => updateTask(task.id, updater)
    const addEvent = (agentId: AgentId, message: string, tone: WorkspaceTask['activities'][number]['tone'] = 'default') => commit((current) => ({ ...current, activities: [...current.activities, activity(agentId, message, tone)], updatedAt: '刚刚' }))
    const setStepStatus = (ids: string[], status: StepStatus, output?: string) => commit((current) => ({ ...current, steps: current.steps.map((item) => ids.includes(item.id) ? { ...item, status, output: output ?? item.output, duration: status === 'done' ? `${(0.8 + Math.random() * 1.6).toFixed(1)}s` : item.duration } : item) }))
    const phaseIds = (phase: PlanStep['phase']) => task.steps.filter((item) => item.phase === phase).map((item) => item.id)
    const planningIds = phaseIds('planning')
    const parallelIds = phaseIds('parallel')
    const synthesisIds = phaseIds('synthesis')
    const reviewIds = phaseIds('review')
    const deliveryIds = phaseIds('delivery')
    try {
      await wait(650)
      setStepStatus(planningIds, 'done', '已确定协作节点')
      commit((current) => ({ ...current, status: 'running', progress: 14, currentAgent: parallelIds.length ? task.steps.find((item) => parallelIds.includes(item.id))?.agentId : 'writer' }))
      addEvent('supervisor', `计划已生成，启动 ${parallelIds.length || 1} 个并行协作节点`, 'success')
      setStepStatus(parallelIds, 'working')
      await wait(1100)
      setStepStatus(parallelIds, 'done', '已完成结构化信息采集')
      commit((current) => ({ ...current, progress: 43, currentAgent: synthesisIds.length ? task.steps.find((item) => synthesisIds.includes(item.id))?.agentId : 'reviewer' }))
      if (parallelIds.length) addEvent(task.steps.find((item) => parallelIds.includes(item.id))?.agentId ?? 'knowledge', '并行信息采集完成，结果已交给内容创作师', 'success')
      setStepStatus(synthesisIds, 'working')
      await wait(1000)
      setStepStatus(synthesisIds, 'done', '已生成结构化初稿')
      commit((current) => ({ ...current, status: reviewIds.length ? 'reviewing' : 'completed', progress: reviewIds.length ? 68 : 100, currentAgent: reviewIds.length ? 'reviewer' : undefined }))
      if (synthesisIds.length) addEvent(task.steps.find((item) => synthesisIds.includes(item.id))?.agentId ?? 'writer', '初稿已生成，交给 Reviewer 做事实与表达审核', 'success')
      setStepStatus(reviewIds, 'working')
      await wait(900)
      if (reviewIds.length) {
        setStepStatus(reviewIds, 'needs_revision', '发现 1 项需要补充的证据')
        commit((current) => ({ ...current, status: 'running', progress: 76, feedback: '补充一条历史数据来源后重新审核', iteration: 1, currentAgent: parallelIds[0] ? task.steps.find((item) => parallelIds.includes(item.id))?.agentId : 'writer' }))
        addEvent('reviewer', '发现 1 项结论缺少历史对照，已反馈给 Supervisor', 'warning')
        await wait(600)
        setStepStatus(synthesisIds, 'working')
        await wait(750)
        setStepStatus(synthesisIds, 'done', '已补充历史对照与来源')
        setStepStatus(reviewIds, 'working')
        commit((current) => ({ ...current, status: 'reviewing', progress: 88, currentAgent: 'reviewer' }))
        addEvent('supervisor', '已根据反馈重新规划，补充历史数据后再次审核')
        await wait(700)
        setStepStatus(reviewIds, 'done', '通过 · 证据链完整')
        addEvent('reviewer', '复审通过，证据链完整，可信度 96%', 'success')
      }
      if (deliveryIds.length) {
        commit((current) => ({ ...current, status: 'running', progress: 92, currentAgent: 'communication' }))
        setStepStatus(deliveryIds, 'working')
        await wait(700)
        setStepStatus(deliveryIds, 'done', '已准备交付')
        addEvent('communication', '结果已准备好，可发送到工作台或已连接的消息渠道', 'success')
      }
      commit((current) => ({ ...current, status: 'completed', progress: 100, currentAgent: undefined, feedback: undefined, result: makeResult(current), iteration: Math.max(current.iteration, 1), updatedAt: '刚刚' }))
      setToast(`「${task.title}」已完成`)
    } finally {
      runningIds.current.delete(task.id)
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const cleanPrompt = prompt.trim()
    if (!cleanPrompt) return
    const nextTask = createTask(cleanPrompt)
    setTasks((current) => [nextTask, ...current])
    setSelectedTaskId(nextTask.id)
    setPrompt('')
    setView('dashboard')
    setToast(`已启动「${nextTask.title}」，AI 管家正在拆解任务`)
    void simulateTask(nextTask)
  }

  const handleSuggestion = (value: string) => {
    setPrompt(value)
    window.setTimeout(() => document.querySelector<HTMLInputElement>('.prompt-composer input')?.focus(), 0)
  }

  const createTaskFromPage = () => {
    setView('dashboard')
    window.setTimeout(() => document.querySelector<HTMLInputElement>('.prompt-composer input')?.focus(), 0)
  }

  const content = useMemo(() => {
    if (view === 'dashboard') return <Dashboard tasks={tasks} selectedTaskId={selectedTaskId} onSelectTask={setSelectedTaskId} prompt={prompt} onPromptChange={setPrompt} onSubmit={handleSubmit} onSuggestion={handleSuggestion} onNavigate={setView} />
    if (view === 'team') return <TeamPage onCreateTask={createTaskFromPage} />
    if (view === 'tasks') return <TasksPage tasks={tasks} selectedTaskId={selectedTaskId} onSelectTask={setSelectedTaskId} />
    return <ModulePage view={view} onCreateTask={createTaskFromPage} />
  }, [view, tasks, selectedTaskId, prompt])

  return <div className="app-shell"><Sidebar view={view} onNavigate={setView} open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} onOpenSettings={() => setSettingsOpen(true)} /><main className="main-content"><Topbar view={view} onMenu={() => setMobileNavOpen(true)} onOpenSettings={() => setSettingsOpen(true)} /><div className="content-scroll"><div className="content-inner">{content}</div></div></main><SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={(next) => { setProviderSettings(next); setToast(`已切换到 ${next.providerName || 'OpenAI Compatible'} · ${next.model}`) }} />{toast && <div className="toast"><span><Icon name="check" size={15} /></span>{toast}<button type="button" aria-label="关闭提示" onClick={() => setToast('')}><Icon name="x" size={14} /></button></div>}<span className="sr-only">当前模型：{providerSettings.model}</span></div>
}
