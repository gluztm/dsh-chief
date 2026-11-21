/**
 * constants.js
 *
 * Static UI labels, permission meta, tab descriptors, and shared client constants.
 */

export const API = 'api/dsh-chief'

export const SIDE_ID = 'dsh-chief'

export const BRAND_NAME = 'DSH 参谋长'

export const EXPECTED_BACKEND_BUILD = '1.7.0'

export const CHIEF_PERMISSION_LABELS = {
  advisor: 'L0 · 顾问模式',
  assistant: 'L1 · 助手模式',
  strategist: 'L2 · 参谋模式',
  chief: 'L3 · 参谋长模式',
}

export const INTERVENTION_TIER_DESC = {
  advisor: 'L0 顾问档：只看并给建议。不改项目文件，也不打断主对话或子代理。',
  assistant: 'L1 助手档：会自动整理记忆、档案和看板。不改项目文件，也不插话主对话。',
  strategist: 'L2 参谋档：会起草改文件、递话和压缩操作，每项都弹窗问你同意后再执行。',
  chief: 'L3 参谋长档：直接带主对话和子代理干活、纠偏、压缩并续跑，带防死循环保护。',
}

export const RUN_MODE_OPTIONS = [
  { key: 'off', label: '⏸ 关停', shortLabel: '⏸ 关停', hint: '后台不调用模型，只在你提问或点按钮时回复。不会自动巡检、梦境漫游或续跑。' },
  { key: 'patrol', label: '🛡 巡检', shortLabel: '🛡 巡检', hint: '平时不耗后台额度，只在被拦截、报错或中断时唤醒。支持自动续跑。' },
  { key: 'managed', label: '🤖 托管', shortLabel: '🤖 托管', hint: '持续在后台盯进度，闲时用 🌙 梦境漫游整理档案。闲置 15 分钟满足条件后自动休眠。' },
]

export const THINKING_EFFORT_OPTIONS = [
  { key: 'auto', label: '🪄 自适应', shortLabel: '🪄 自动', badge: '🪄 自动换挡', hint: '按任务难易自动调思考深度。写摘要或梦境漫游时关闭，排查或设拦截规则时调高。' },
  { key: 'off', label: '⚡ 关闭思考', shortLabel: '⚡ 关', badge: '⚡ 关闭思考', hint: '直接输出回答，不做深度思考，速度最快。' },
  { key: 'low', label: '🔅 低强度', shortLabel: '🔅 低', badge: '🔅 低思考', hint: '简单检查和日常问答。' },
  { key: 'medium', label: '⚖️ 中强度', shortLabel: '⚖️ 中', badge: '⚖️ 中思考', hint: '日常推理、写代码和复盘。' },
  { key: 'high', label: '🔥 高强度', shortLabel: '🔥 高', badge: '🔥 高思考', hint: '处理复杂问题、设拦截规则、强介入和总结经验。' },
  { key: 'xhigh', label: '🧠 极高强度', shortLabel: '🧠 极高', badge: '🧠 极高思考', hint: '处理多条规则冲突、严重故障和复杂分析。' },
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
  { key: 'archive', label: '档案' },
  { key: 'boundaries', label: '边界' },
]

export const RELAY_MODES = [
  { key: 'steer', label: '插话', hint: '对方正在干活时，下一步立刻插进去提醒。' },
  { key: 'followup', label: '递话', hint: '排在当前话后面发，对方空闲时直接唤醒。' },
  { key: 'silent', label: '备忘', hint: '先放到收件箱里，不打断也不叫醒对方。' },
]

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
    label: '金别针（核心）',
    short: '核心',
    tip: '金别针：核心资料，优先留桌面（点一下切换）',
  },
  silver: {
    color: '#cbd5e1',
    pinStroke: '#cbd5e1',
    glow: 'none',
    bg: 'rgba(203, 213, 225, 0.13)',
    border: 'rgba(203, 213, 225, 0.38)',
    label: '银别针（日常）',
    short: '实录',
    tip: '银别针：日常记录和资料（点一下切换）',
  },
  copper: {
    color: '#9a583b',
    pinStroke: '#7c4329',
    glow: 'none',
    bg: 'rgba(124, 67, 41, 0.18)',
    border: 'rgba(124, 67, 41, 0.44)',
    label: '铜别针（旧档）',
    short: '归档',
    tip: '铜别针：旧资料，不够放先撤（点一下切换）',
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
