export type ViewKey =
  | 'dashboard'
  | 'team'
  | 'tasks'
  | 'knowledge'
  | 'documents'
  | 'analytics'
  | 'meetings'
  | 'messages'

export type AgentId =
  | 'supervisor'
  | 'project'
  | 'data'
  | 'knowledge'
  | 'document'
  | 'meeting'
  | 'writer'
  | 'reviewer'
  | 'communication'

export type AgentState = 'idle' | 'working' | 'done' | 'review'
export type TaskStatus = 'planning' | 'running' | 'reviewing' | 'completed' | 'needs_input'
export type StepStatus = 'pending' | 'working' | 'done' | 'needs_revision'

export interface Agent {
  id: AgentId
  name: string
  role: string
  description: string
  initials: string
  color: string
  icon: string
  skills: string[]
  state: AgentState
  completedTasks: number
  accent?: string
}

export interface PlanStep {
  id: string
  agentId: AgentId
  title: string
  description: string
  phase: 'planning' | 'parallel' | 'synthesis' | 'review' | 'delivery'
  group: number
  status: StepStatus
  duration?: string
  output?: string
}

export interface Activity {
  id: string
  agentId: AgentId
  message: string
  time: string
  tone?: 'default' | 'success' | 'warning'
}

export interface TaskResult {
  title: string
  summary: string
  bullets: string[]
  metrics: { label: string; value: string }[]
}

export interface WorkspaceTask {
  id: string
  title: string
  prompt: string
  status: TaskStatus
  progress: number
  createdAt: string
  updatedAt: string
  currentAgent?: AgentId
  agents: AgentId[]
  steps: PlanStep[]
  activities: Activity[]
  result?: TaskResult
  feedback?: string
  iteration: number
  channel: 'workspace' | 'wechat' | 'schedule'
}
