import { agentMap } from './data'
import type { AgentId, Activity, PlanStep, TaskResult, WorkspaceTask } from './types'

const nowLabel = () =>
  new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())

const unique = <T,>(items: T[]) => [...new Set(items)]

function classifyPrompt(prompt: string) {
  if (/会议|客户|brief|会前/i.test(prompt)) return 'meeting'
  if (/销售|数据|指标|日报|分析|异常/i.test(prompt)) return 'sales'
  if (/竞品|竞争|市场|调研/i.test(prompt)) return 'research'
  if (/制度|报销|知识|政策|查找/i.test(prompt)) return 'knowledge'
  if (/周报|项目|进展|汇报|报告/i.test(prompt)) return 'report'
  return 'general'
}

export function titleFromPrompt(prompt: string) {
  const kind = classifyPrompt(prompt)
  const titles: Record<typeof kind, string> = {
    meeting: '准备客户会议 Brief',
    sales: '分析业务数据并定位异常',
    research: '生成竞品与市场分析',
    knowledge: '检索企业知识并整理答案',
    report: '生成项目进展周报',
    general: '完成一项新的工作任务',
  }
  return titles[kind]
}

const step = (
  id: string,
  agentId: AgentId,
  title: string,
  description: string,
  phase: PlanStep['phase'],
  group: number,
): PlanStep => ({ id, agentId, title, description, phase, group, status: 'pending' })

export function buildPlan(prompt: string): PlanStep[] {
  const kind = classifyPrompt(prompt)
  const start = step('plan', 'supervisor', '理解目标并生成计划', `识别任务类型：${titleFromPrompt(prompt)}`, 'planning', 0)

  if (kind === 'meeting') {
    return [
      start,
      step('crm', 'knowledge', '检索客户历史资料', '查找客户画像、订单和近期互动记录', 'parallel', 1),
      step('minutes', 'document', '整理上次会议纪要', '提取决策、异议和未完成行动项', 'parallel', 1),
      step('agenda', 'meeting', '梳理会议议程', '根据资料生成讨论重点和提问建议', 'synthesis', 2),
      step('write', 'writer', '生成客户会议 Brief', '把事实和议程组织成会前简报', 'synthesis', 2),
      step('review', 'reviewer', '审核信息与表达风险', '核验客户信息、数字和敏感表达', 'review', 3),
    ]
  }

  if (kind === 'sales') {
    return [
      start,
      step('metrics', 'data', '计算核心业务指标', '聚合销售额、客户数、转化率与退款率', 'parallel', 1),
      step('context', 'knowledge', '补充业务口径与历史趋势', '检索指标定义和历史分析报告', 'parallel', 1),
      step('insight', 'writer', '生成分析结论', '整理增长来源、异常和行动建议', 'synthesis', 2),
      step('review', 'reviewer', '检查数字与结论', '核验数据口径、引用和异常判断', 'review', 3),
      step('deliver', 'communication', '交付分析结果', '准备工作台卡片和可分享的摘要', 'delivery', 4),
    ]
  }

  if (kind === 'research') {
    return [
      start,
      step('market', 'knowledge', '收集市场与竞品资料', '从企业知识和已接入来源中检索信息', 'parallel', 1),
      step('compare', 'data', '构建竞品对比矩阵', '统一维度并识别差异化机会', 'parallel', 1),
      step('research-write', 'writer', '生成竞品分析报告', '整理结论、证据与建议', 'synthesis', 2),
      step('research-review', 'reviewer', '审核来源与结论', '检查证据充分性和推断边界', 'review', 3),
    ]
  }

  if (kind === 'knowledge') {
    return [
      start,
      step('retrieve', 'knowledge', '检索企业知识', '从制度、项目和产品资料中召回相关片段', 'parallel', 1),
      step('extract', 'document', '整理来源与关键信息', '提炼答案并保留可追溯引用', 'parallel', 1),
      step('answer', 'writer', '生成清晰答复', '用简洁语言回答问题并标注适用范围', 'synthesis', 2),
      step('answer-review', 'reviewer', '审核答案可信度', '检查是否存在过度推断或缺少来源', 'review', 3),
    ]
  }

  return [
    start,
    step('project', 'project', '聚合项目进展', '读取任务、里程碑和风险状态', 'parallel', 1),
    step('context', 'knowledge', '补充企业上下文', '检索相关会议纪要和历史文档', 'parallel', 1),
    step('draft', 'writer', '生成工作成果', '把结构化结果组织成可交付内容', 'synthesis', 2),
    step('review', 'reviewer', '审核事实与表达', '检查数字、来源和结论完整性', 'review', 3),
    step('deliver', 'communication', '交付给相关成员', '准备工作台、群聊或微信适配器的消息', 'delivery', 4),
  ]
}

export function createTask(prompt: string): WorkspaceTask {
  const plan = buildPlan(prompt)
  const ids = unique(plan.map((item) => item.agentId))
  const created = new Date()
  return {
    id: `task-${Date.now()}`,
    title: titleFromPrompt(prompt),
    prompt,
    status: 'planning',
    progress: 4,
    createdAt: '刚刚',
    updatedAt: nowLabel(),
    currentAgent: 'supervisor',
    agents: ids,
    steps: plan,
    activities: [
      {
        id: `activity-${Date.now()}`,
        agentId: 'supervisor',
        message: '已收到目标，正在生成动态协作计划',
        time: nowLabel(),
      },
    ],
    iteration: 0,
    channel: 'workspace',
  }
}

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function makeResult(task: WorkspaceTask): TaskResult {
  if (/会议|客户/i.test(task.prompt)) {
    return {
      title: '客户会议 Brief 已准备完成',
      summary: '基于客户历史、会议纪要和企业知识，生成了一份可直接用于明天会议的会前简报。',
      bullets: ['梳理本次会议的 3 个核心目标', '标记上次会议遗留的 2 项待跟进事项', '生成议程、提问建议和风险提示'],
      metrics: [{ label: '引用资料', value: '5 份' }, { label: '可信度', value: '95%' }, { label: '阅读时长', value: '6 min' }],
    }
  }
  if (/销售|数据|指标|异常/i.test(task.prompt)) {
    return {
      title: '业务数据分析已完成',
      summary: '销售额环比增长 12.8%，增长主要来自华南区域和 A 产品线；深圳退款率需要跟进。',
      bullets: ['华南区域贡献新增销售额的 46%', 'A 产品转化率较上月提升 8.4%', '深圳区域退款率上升 4.1%，建议核查履约环节'],
      metrics: [{ label: '订单样本', value: '12,864' }, { label: '核心指标', value: '18 项' }, { label: '可信度', value: '98%' }],
    }
  }
  if (/知识|制度|报销|政策/i.test(task.prompt)) {
    return {
      title: '企业知识答案已整理',
      summary: '已从 4 份制度文档中找到相关依据，并按“结论—适用范围—来源”结构整理答案。',
      bullets: ['给出直接可执行的结论', '保留文档名称与章节引用', '标记可能因部门或时间变化的规则'],
      metrics: [{ label: '召回片段', value: '12 条' }, { label: '引用来源', value: '4 份' }, { label: '可信度', value: '97%' }],
    }
  }
  return {
    title: '项目工作成果已生成',
    summary: '项目管家、知识专家和内容创作师已经完成协作，结果通过质量审核，可继续分享或导出。',
    bullets: ['汇总当前进展与关键里程碑', '识别需要关注的风险和阻塞项', '生成下一步行动建议'],
    metrics: [{ label: '协作 Agent', value: `${unique(task.agents).length} 个` }, { label: '引用资料', value: '8 份' }, { label: '可信度', value: '96%' }],
  }
}

export function activity(agentId: AgentId, message: string, tone: Activity['tone'] = 'default'): Activity {
  return { id: `activity-${Date.now()}-${Math.random()}`, agentId, message, time: nowLabel(), tone }
}

export function agentLabel(id: AgentId) {
  return agentMap[id]?.name ?? id
}
