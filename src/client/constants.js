/**
 * constants.js
 *
 * Static UI labels, permission meta, tab descriptors, and shared client constants.
 */

export const API = 'api/dsh-chief'

export const SIDE_ID = 'dsh-chief'

export const BRAND_NAME = 'DSH 参谋长'

export const EXPECTED_BACKEND_BUILD = '1.5.0'

export const CHIEF_PERMISSION_LABELS = {
  advisor: 'L0 · 顾问模式',
  assistant: 'L1 · 助手模式',
  strategist: 'L2 · 参谋模式',
  chief: 'L3 · 参谋长模式',
}

export const INTERVENTION_TIER_DESC = {
  advisor: 'L0 顾问档：只读巡检诊断并在面板输出建议，不修改工作区或向主对话/子代理注入强推指令',
  assistant: 'L1 助手档：仅自主维护记忆/档案/看板与建议卡片，不改工作区文件且不直接插话主对话',
  strategist: 'L2 参谋档：自动分析并生成关键动作（工作区改动/递话/压缩），逐项弹窗授权后才执行',
  chief: 'L3 参谋长档：高自主闭环督导（直控主对话/子代理、纠偏、压缩与续跑），含防死循环熔断',
}

export const RUN_MODE_OPTIONS = [
  { key: 'off', label: '⏸ 关停', shortLabel: '⏸ 关停', hint: '0 后台消耗，仅显式 Q&A / 按钮触发；禁止自动巡检、梦境漫游或断线续跑' },
  { key: 'patrol', label: '🛡 巡检', shortLabel: '🛡 巡检', hint: '常规回合 0 Token；仅在阻墙拦截/异常/断流时精准唤醒，支持 Auto continue' },
  { key: 'managed', label: '🤖 托管', shortLabel: '🤖 托管', hint: '持续后台监工 + 🌙 梦境漫游整理卷宗织钩子 + 15 分钟 5 条件自动休眠' },
]

export const THINKING_EFFORT_OPTIONS = [
  { key: 'auto', label: '🪄 自适应', shortLabel: '🪄 自动', badge: '🪄 自动换挡', hint: '按当前任务复杂度自动升降挡（摘要/梦境漫游→关，诊断/筑墙→高/极高）' },
  { key: 'off', label: '⚡ 关闭思考', shortLabel: '⚡ 关', badge: '⚡ 关闭思考', hint: '极速低延迟文本输出，不开深度推理链' },
  { key: 'low', label: '🔅 低强度', shortLabel: '🔅 低', badge: '🔅 低思考', hint: '轻量校验与一般问答' },
  { key: 'medium', label: '⚖️ 中强度', shortLabel: '⚖️ 中', badge: '⚖️ 中思考', hint: '日常均衡推理与复盘' },
  { key: 'high', label: '🔥 高强度', shortLabel: '🔥 高', badge: '🔥 高思考', hint: '复杂排障、筑墙、强介入与经验沉淀' },
  { key: 'xhigh', label: '🧠 极高强度', shortLabel: '🧠 极高', badge: '🧠 极高思考', hint: '多边界碰撞、紧急危情诊断与全局深推演' },
]

export const STATUSES = ['todo', 'doing', 'blocked', 'done']

export const STATUS_LABEL = { todo: '待推进', doing: '推进中', blocked: '受阻', done: '已完成' }

export const STATUS_BADGE = { todo: '○ 待推进', doing: '推进中', blocked: '⚠ 受阻', done: '✓ 已完成' }

export const STATUS_HEX = {
  todo: '#8e8e93',
  doing: '#0a84ff',
  blocked: '#ff453a',
  done: '#30d158',
}

export const STATUS_BG = {
  todo: 'rgba(142, 142, 147, 0.16)',
  doing: 'rgba(10, 132, 255, 0.16)',
  blocked: 'rgba(255, 69, 58, 0.18)',
  done: 'rgba(48, 209, 88, 0.15)',
}

export const TABS = [
  { key: 'chief', label: '参谋' },
  { key: 'tasks', label: '任务' },
  { key: 'peers', label: '协同' },
  { key: 'plan', label: '规划' },
  { key: 'archive', label: '档案' },
  { key: 'boundaries', label: '边界' },
]

export const FACT_CATEGORIES = [
  { key: 'discipline', label: '纪律' },
  { key: 'architecture', label: '架构' },
  { key: 'team', label: '分工' },
  { key: 'progress', label: '进展' },
  { key: 'preference', label: '偏好' },
]

export const FACT_CAT_LABEL = FACT_CATEGORIES.reduce((acc, c) => {
  acc[c.key] = c.label
  return acc
}, {})

export const FACT_CAT_TONE = {
  discipline: { bg: 'rgba(245, 158, 11, 0.16)', fg: '#fbbf24', border: 'rgba(245, 158, 11, 0.34)' },
  preference: { bg: 'rgba(245, 158, 11, 0.16)', fg: '#fbbf24', border: 'rgba(245, 158, 11, 0.34)' },
  architecture: { bg: 'rgba(10, 132, 255, 0.14)', fg: '#409cff', border: 'rgba(10, 132, 255, 0.30)' },
  team: { bg: 'rgba(10, 132, 255, 0.14)', fg: '#409cff', border: 'rgba(10, 132, 255, 0.30)' },
  progress: { bg: 'rgba(10, 132, 255, 0.14)', fg: '#409cff', border: 'rgba(10, 132, 255, 0.30)' },
}

export const RELAY_MODES = [
  { key: 'steer', label: '插话', hint: '正在运行时立即在下一步切入' },
  { key: 'followup', label: '递话', hint: '排队或唤醒待命对话' },
  { key: 'silent', label: '备忘', hint: '静默放入信箱，不强行唤醒' },
]

export const MEMORY_SECTIONS = [
  { key: 'progress', label: '目标与进展' },
  { key: 'decision', label: '决策与结论' },
  { key: 'verify', label: '门禁与验证' },
  { key: 'open', label: '待办与风险' },
  { key: 'other', label: '其他要点' },
]

export const SECTION_LABEL = MEMORY_SECTIONS.reduce((all, section) => {
  all[section.key] = section.label
  return all
}, {})

export const BOUND_LISTS = [
  { field: 'allowed', label: '必做事项', dot: '#30d158' },
  { field: 'forbidden', label: '禁止红线', dot: '#ff453a' },
  { field: 'notes', label: '注意事项', dot: '#f59e0b' },
]

export const BOUND_CAP = 20

/* ------------------------------------------------------------------ store */

export const GENERIC_OWNERS = new Set(['', 'agent', 'lead', 'user', 'operator', 'chief', 'main', 'root'])

export const SEC_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export const SEC_MAX_IMAGES = 4

export const SESSION_PALETTE = [
  { dot: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.38)', text: '#60a5fa', label: '蓝' },
  { dot: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.38)', text: '#34d399', label: '绿' },
  { dot: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.38)', text: '#fbbf24', label: '橙' },
  { dot: '#a855f7', bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.38)', text: '#c084fc', label: '紫' },
  { dot: '#ec4899', bg: 'rgba(236,72,153,0.12)', border: 'rgba(236,72,153,0.38)', text: '#f472b6', label: '粉' },
  { dot: '#06b6d4', bg: 'rgba(6,182,212,0.12)', border: 'rgba(6,182,212,0.38)', text: '#22d3ee', label: '青' },
]

export const PAPERCLIP_META = {
  gold: {
    color: '#ffe033',
    pinStroke: '#ffe44d',
    glow: 'drop-shadow(0 0 3.5px rgba(255, 224, 51, 0.62))',
    bg: 'rgba(255, 224, 51, 0.17)',
    border: 'rgba(255, 224, 51, 0.56)',
    label: '璀璨金针',
    short: '核心',
    tip: '亮金曲别针：核心工程坐标与关键锚点（点击切换曲别针等级）',
  },
  silver: {
    color: '#cbd5e1',
    pinStroke: '#cbd5e1',
    glow: 'none',
    bg: 'rgba(203, 213, 225, 0.13)',
    border: 'rgba(203, 213, 225, 0.38)',
    label: '标准银针',
    short: '实录',
    tip: '亮银曲别针：标准排障与工程实录（点击切换曲别针等级）',
  },
  copper: {
    color: '#9a583b',
    pinStroke: '#7c4329',
    glow: 'none',
    bg: 'rgba(124, 67, 41, 0.18)',
    border: 'rgba(124, 67, 41, 0.44)',
    label: '暗古铜针',
    short: '归档',
    tip: '暗古铜曲别针：历史阶段沉淀备查（点击切换曲别针等级）',
  },
}

export const FOLDER_EAR_TAG = {
  coords: 'COORDS · 坐标',
  incidents: 'CASE · 实录',
  contracts: 'SPEC · 契约',
  ops: 'OPS · 运维',
  plans: 'PLAN · 蓝图',
  inbox: 'INBOX · 待分拣',
}

export const SIX_GOAL_ROWS_META = [
  { key: '总目标', aliases: ['总目标'], color: '#409cff', bg: 'rgba(10, 132, 255, 0.14)' },
  { key: '当前推进目标', aliases: ['当前推进目标', '当前推进'], color: '#10b981', bg: 'rgba(16, 185, 129, 0.14)' },
  { key: '受阻目标', aliases: ['受阻目标', '卡点', '受阻'], color: '#ff453a', bg: 'rgba(255, 69, 58, 0.15)' },
  { key: '需要什么', aliases: ['需要什么', '尚需条件'], color: '#a855f7', bg: 'rgba(168, 85, 247, 0.14)' },
  { key: '用户需要提供什么', aliases: ['用户需要提供什么', '用户需要提供', '需用户提供'], color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  { key: '参谋长建议', aliases: ['参谋长建议', '参谋长的建议'], color: 'var(--dnb-accent)', bg: 'rgba(10, 132, 255, 0.16)' },
]

export const DOCK_POLL_MS = 600
