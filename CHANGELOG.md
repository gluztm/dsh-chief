# Changelog

All notable changes to **`dsh-chief`** (**DSH 参谋长**) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-11-27

> 里程碑大版本：参谋长真正“能听会说、能自己记事、能守边界、会真发令、还能手机远程报平安”。上线全链路**双模语音参谋长（DeepSeek / OpenAI 兼容 / 系统语音 TTS + SenseVoice / DeepSeek ASR 双通道识别 + 行内语音舞台 + 叫名唤醒 + 防空口支票实发闭环）**、**手机远程传呼（飞书 / 钉钉 / 企业微信 / Telegram / Discord / 自定义 Webhook）**、**「档案 → 🎙️ 手记」独立语音手记子页签 & 梦境自动消化引擎**、**双语 BM25 档案检索 + 卷宗演进快照回滚 + `[[双链]]` 暗铜失效联动预警**、**记忆工坊三协议通用向量客户端（OpenAI / Ollama / Gemini）**、**开箱即用参谋记忆本自主写入**、**工作边界「暂挂」开关**、**独立「外观与主题工坊」页面（精选 5 套 + DIY 工坊内含 `@iridiumgit` 在 Issue #7 贡献的「潮汐蓝」社区配色、配色 JSON 导入导出与服务端多端自动同步）**，以及面向非程序员用户的**全量体验瘦身与沙盒真机多轮打磨**。

### Added & Improved
- **双语 CJK + Latin BM25 工程档案检索全链路打通（`archive-core.js` / `archive-dossiers.js` / `src/client/tabs/archives.js`）**：
  - 升级 `scoreAndRankArchiveItems` 与 `listArchiveHeaders`，引入 `tokenizeArchiveBilingual` 双语切词与 BM25（`k1=1.35, b=0.6`）+ IDF 长度归一化，精准召回无空格中文长句与正文内容，彻底告别词频 `includes` 简单叠加；前端档案搜索框同步接入后端 BM25 防抖检索（含本地切词瞬时预匹配）；
  - 保留「三色曲别针」权威分层：亮金针（`gold`）微加成 `× 1.12`，暗铜针（`copper`）温和降权 `× 0.65`（保留作反面警示而不隐藏）。
- **卷宗演进版本快照 `history[]` 与前端一键回滚（`archive-core.js` / `archive-dossiers.js` / `src/client/tabs/archives-cards.js`）**：
  - 每次编辑保存、`sameTitle` 覆盖以及 `applyChiefArchiveCurations`（「✦ 请参谋长重拆此卷」/ 梦境漫游）前，自动将旧版标题、摘要、曲别针、正文章节压入最多 5 版的 `history[]` 快照；
  - 新增 `mutateArchive({ op: "rollbackHistory", id, versionIndex })` 并在卷宗展开卡片提供 `🕒 历史 (N)` 快照抽屉与 `⏪ 回滚` 按钮，无损回滚同时保留当前版本快照。
- **卷宗 `[[双链]]` 双向关联卡片、暗铜失效联动预警 & 幽灵双链根治（`archive-core.js` / `archive-dossiers.js` / `src/client/tabs/archives-cards.js`）**：
  - 自动解析正文与要点中的 `[[目标卷宗]]` 显式双链并持久化进 `links`（修复编辑/覆盖删光双链时旧链接残留的幽灵问题）；`getArchiveDetail` 返回 `relations`（`outgoing` 传出 / `incoming` 被引用 / `staleDependencies` 已作废依赖），展开卡片可直接展示并点击跳转；
  - 将某卷标为暗铜（`copper`）时自动返回并弹出受影响的活跃下游卷宗 `affectedDependents` 预警通知，引用方卡片顶部同步显示 `⚠️ 本档案引用了已作废（暗铜）档案` 警示条。
- **参谋记忆工坊三协议通用向量客户端与 UI 选择器（`state-schema.js` / `external-memory-studio.js` / `src/client/tabs/extmem.js`）**：
  - 在原有 OpenAI 兼容 `/embeddings` 基础上，新增 `provider`（`'openai' | 'ollama' | 'gemini'`）支持：原生适配本机 Ollama `/api/embed`（404 自动回退 `/api/embeddings`）与 Google Gemini `:embedContent`（密钥严格走 `x-goog-api-key` 请求头）；修复默认 `'openai'` 锁死 URL 自动识别的问题，在「记忆 → 接入与设置」上线协议切换开关、Ollama/Gemini 预设及友好中文连通报错；
  - 新增并接入 `tests/verify-v201-cross-pollination-gate.mjs`（`X1–X4`）至 `npm run test:ci` / `npm test` 全链路隔离回归验收。
- **🎙️ 语音参谋长、行内语音舞台与真实发令闭环（`chief-tts.js` / `voice-inbox.js` / `src/client/tts.js` / `src/client/voice-recorder.js` / `src/client/styles/tts.js` · `T1–T13`）**：
  - 支持 DeepSeek 原生 `/v1/tools/tts`（自动复用 DSH 宿主账号态）、OpenAI 兼容 `/v1/audio/speech` 与浏览器离线朗读，内置密钥、代码、路径口语脱敏；支持本地 SenseVoice 与云端 `/v1/tools/asr` 16kHz 语音转写。
  - 去除全屏毛玻璃遮罩，改为面板内联 **语音面聊舞台（`Alt+V` 一键呼出）**，支持免提连续 VAD 对话、无麦克风权限静默降级、中英文同音容错与打字叫名自动唤醒。
  - 加固语音模式防空口支票守卫：语音中让参谋长催办/push 主对话时强制走 L0–L3 权限门禁（L0/L1 弹出提权窗、L2 弹出逐项确认窗、L3 真实投递 `@lead`），权限未批时如实说明不撒谎。
- **📲 手机远程传呼与里程碑告警（`remote-pager.js` · `P1–P8`）**：
  - 支持 **飞书 / 钉钉 / 企业微信 / Telegram / Discord / 自定义 Webhook** 6 个通道，自动推送待审批/提权、安全拦停、高危急停、托管收工与预算熔断告警（脱敏推送、HMAC 加签、冷却去重）。
- **🎙️ 语音手记收件区 & 「档案 → 手记」独立子页签（`voice-inbox.js` / `src/client/tabs/archives.js`）**：
  - 语音输入与语音唠嗑先脱敏落盘 `~/.dsh/chief/voice-inbox/`，经「🌙 梦境整理」拆入长期记忆、用户画像、参谋日记与手记文稿（与 `@lead` 0 字节隔离）。
  - 在「档案」下新增第 5 个子页签 `🎙️ 手记`，统一收纳待整理语音与已归档手记文稿，使「全局 / 本局」专注于工程档案，「记忆」页保持纯粹清单。
- **🎨 独立「外观与主题工坊」页面 & 社区诉求响应（感谢 `@iridiumgit` · [Issue #7](https://github.com/gluztm/dsh-chief/issues/7)）**：
  - 将主题选择由悬浮气泡升级为独立工坊页（标明多端同步）：`精选预设 (5)` 保留 5 套官方皮肤；`DIY 工坊` 内嵌顶部「🌊 社区配色」收纳 `@iridiumgit` 贡献的深浅双模 **「潮汐蓝 (`tide`)」**（支持一键启用或拿来微调），同时支持图片提色、高清壁纸、参谋长 AI DIY 及 **配色 JSON 导入/导出**。
  - 选中主题（`uiSkin`）与自定义配色（`customSkin`）同步持久化到服务端 `~/.dsh/chief/`（支持 `127.0.0.1` / 局域网 / Tailnet / 多浏览器一致）。
- **⏸ 工作边界「暂挂」与开箱参谋记忆自主写入**：
  - 边界条文新增「暂挂」勾选框，可随时暂挂与恢复而无需删改重写；参谋内置长期记忆本（`builtin-md`）改为默认开箱启用，对话产出的 `memoryChanges` 实时同步写入 `MEMORY.md`。

### Improved & Fixed
- **小白体验全量瘦身与沙盒多轮实机打磨**：
  - 底部 `+` 控制面板砍掉 18 格百分比矩阵，精简为 4 项高频开关 + 3 档预设（`65% / 80% / 90%`）；提权弹窗与回执清洗代码术语、批准后自动清理过期 L0 提示；
  - 修复设置页「常用场景预设」3 列卡片横向溢出裁切、「档案 → 手记」窄屏顶栏重叠、进入档案时初始角标滞后刷新、DIY 4 槽标题竖向折行、L2 权限メニュー贴底微裁、气泡里孤立「思考关」与粗体 `**` 未解析、以及「按需可查 / 标记重要程度」等晦涩行话；
  - 恢复 `autoDistill.minTurns: 2` 修复后台自动提炼竞态；全量门禁与 8 轴红队审计零回归，10 个安全内核模块 MD5 严格锁定未改。

## [1.9.0] - 2026-11-26

> 里程碑大版本：推出全新**参谋专属「记忆工作台」与外部记忆桥接（`dsh-chief.provider/v1` · 对 `@lead` 严格 0 字节隔离）**（开箱 `MEMORY.md` 纯文本记事本 + 2D/3D 星云星图与艾宾浩斯遗忘曲线 + 5 维可锁定 `USER_PROFILE.md` 用户画像 + 提示词工坊 + X-Ray 召回测试 + Embedding API 语义重排，并开放接入 `mcp-http` / `chief-http` 双槽含独立心境槽位 / `markdown-vault` 只读 Obsidian / `cordis-provider`）；同步带来零依赖**第 6 套「自定义 DIY 主题工坊」（本地图片提色 + 25MB 高清壁纸 + 参谋长 AI DIY）**、全新默认**「极简左侧边栏」工作台布局 & 护眼浅色主题**、开箱即用**「安全拦截预设包 v2」（事前物理硬拦截）**、认知桌面扩容、梦境漫游跨作用域路由与品牌彩蛋联动；并在发版前完成**隔离沙盒全链路真机实测与三波边测边修，将实机暴露的 21 项大小问题全部清零**（`M1–M17` 回归门禁全绿，10 个 MD5 锁定安全内核零改动）。

### Added
- **🧠 参谋专属「记忆工作台」与外部记忆桥接（`external-memory.js` / `external-memory-connectors.js` / `external-memory-studio.js` / `src/client/tabs/extmem.js` / `extmem-starfield.js` / `extmem-studio.js` / `styles/extmem.js` · `M1–M10`, `M15`, `M16`）**：
  - **严格 0 字节 `@lead` 硬隔离**：全部记忆检索、用户画像、提示词工坊与可选心境/关系槽位仅在参谋模型侧运行，绝不向主对话 `@lead` 系统提示词、摘要或子代理注入任何字节，也绝不激活普通未启用会话。
  - **开箱即用纯文本记事本（`MEMORY.md`）+ 4 类开放连接协议**：默认内置零配置 `builtin-md` 记事本（透明 Markdown 纯文本，支持随时用记事本或 Obsidian 编辑）；开放接入 `mcp-http`（MCP Streamable HTTP，`initialize` + `tools/list` 自动发现）、`chief-http`（主记忆槽位 + 可选独立 `moodSlot` 心境/关系槽位，工作模式自动静默且对模型隐藏裸数值）、`markdown-vault`（本地 Obsidian / 笔记目录严格只读中英双语 BM25 召回，跳过 `README` / `CHANGELOG` 并脱敏）及 `cordis-provider`（宿主 `chiefMemoryHost` 服务，支持工作区 `读写 / 只读 / 关闭` 三级策略）。
  - **精简 3 栏记忆工作台、2D/3D 星云星图与艾宾浩斯遗忘曲线**：主入口默认展示极简「记忆清单」（5 类色点标签、活力进度条、单点强化、常驻固定、编辑与忘记）并支持一键切换「2D SVG / 3D Canvas 星云星图」（主星团 + 4 卫星星团、年轮时间轴回放、检索高亮与关联弧线）；「用户画像（`USER_PROFILE.md`）」5 维结构化画像支持锁定单条防后台覆盖；「接入与设置」整合可选 OpenAI 兼容 **Embedding API 语义重排**（失败静默降级、API Key 对 UI 脱敏）、可选「情感记忆独立分栏（`emotionSplitView`）」、提示词工坊（`PROMPTS.json`）、X-Ray 召回测试与里程碑日记（`DIARY.md`）。
  - **KV Cache 友好与工程防噪**：提示词采用静态前置 + 动态召回后置结构保障前缀缓存命中；内置无信号短句门卫（拦截“好的 / 继续 / ok”等低信息触发）、硬超时 + 3 次熔断静默降级、后台自动提炼自动剔除例行压缩流水账噪声（绝不生成水字数流水日记）、全局本机扫描不抓取 `node_modules` 与敏感凭据，出口全链路自动脱敏。
- **🎨 第 6 套皮肤「自定义 DIY 主题工坊」（`src/client/custom-theme.js` / `src/client/components/modals/theme-diy.js` / `chief-theme-diy.js` · `M14`）**：
  - **纯前端 HSL/WCAG 色彩引擎**：仅凭主强调色 / 辅助点缀色 / 暖色高光 / 底调色 4 枚基准色，自动推导出同时适配 DSH 深色与浅色宿主的完整 `--dnb-*` 样式令牌与清晰文本对比度，支持实时整面板预览与取消安全回滚。
  - **本地图片一键提色 & 高清壁纸持久化**：纯前端 `<canvas>` 像素量化提取 6 枚主色色卡（0 Token），支持导入最高 25MB 高清壁纸存入 `IndexedDB`（不污染 `localStorage`），支持透明度与磨砂模糊调节（`blur=0` 时保持 1:1 锐利像素显示，卡片自动切换半透毛玻璃质感）。
  - **✨ 参谋长 AI DIY（`op: 'theme.diy'`）**：用大白话描述想要的风格（内置「赛博雨夜樱花 / 京都雨抹茶 / 敦煌石青金 / 北欧冰川极光」等灵感胶囊）或附带参考图，即可生成和谐双模配色方案，并带离线国风/潮流兜底与严格 Hex 白名单防 CSS 注入。
- **🧭 默认「极简左侧边栏」工作台布局 & 护眼浅色主题精修（`src/client/components/Panel.js` / `store.js` / `styles/skins.js` / `components/common.js` · `M15`, `M16`）**：
  - 宽屏默认采用「左侧边栏（`sidebar`）」主导航 + 二级子菜单（窄右侧栏自动切换顶部 6 页签 `参谋 / 任务 / 协同 / 档案 / 记忆 / 边界`），设置中仍支持随时切回「顶部页签（`top`）」。
  - 全面调优 5+1 套皮肤的浅色防过曝低眩光底色配比，并补全 `user` / `heart` 线性矢量图标。
- **🛡️ 开箱即用「安全拦截预设包 v2」（`guard-wall-presets.js` · `M17`）**：
  - 精简收拢为 3 套开箱事前物理硬拦截预设，全新安装自动默认开启「涉密文件防泄露（`.env` / 密钥 / 凭据）」与「高危操作防误删（`git push --force` / `reset --hard` 等）」，并按需一键切换「只读看代码模式」；幂等初始化不覆盖用户手动暂停，自动清理 v1 废弃旧预设并完整保留用户自定义拦截规则。
- **✨ 认知桌面扩容、梦境漫游跨作用域路由与品牌彩蛋（`archive-core.js` / `chief-archives.js` / `src/client/constants.js` · `M11–M13`）**：
  - 认知桌面支持扩大容量上限（支持 `7+` 份档案上桌并带安全边界夹紧），梦境漫游支持跨本局/全局作用域自动路由整理与清理陈旧观察项；新增品牌彩蛋联动（特定参谋称呼与模型匹配触发专属皮肤/彩蛋昵称滚动），并新增 17 项 `v1.9.0` 自动化回归门禁（`tests/verify-v190-external-memory-gate.mjs` · `M1–M17`）全面接入 `test:ci` / `test`。

### Fixed（发版前沙盒真机实测 · 核心缺陷清零）
- **修复右侧栏「在主页面全屏打开」无效（`src/client/store.js`）**：移除仅激活组装器而未切换 UI 视图的 `uiConversation.binding(sid).activate()` 错误短路逻辑，精准锁定 `[data-conversation-tabs] [role="tab"]` 并触发真实视图切换（含右侧栏挤压折叠时的异步重尝试与面板回退），点击后主区「参谋长」视图立即打开且右侧栏同步收起。
- **修复参谋本地关键词路由误劫持正常业务提问（`command-helpers.js` / `chief-commands.js`）**：收窄 `asksBounds` 判定，将代码领域常见的「边界情况 / 边界条件 / 边界用例 / 边界测试 / 边界值」排除出本地规矩查询，并澄清空规矩提示文案与离线模型兜底横幅，防止日常代码分析被误拐进静态模板。
- **修复参谋给主对话「工作流递话」提及 `.env` 被误判为终端命令拦截（`command-helpers.js` / `chief-commands.js` / `chief-approvals.js` / `runtime-hooks.js`）**：新增 `shouldInspectRelayAsCommand(text)`，仅当递话包含真实 Shell/CLI 命令意图时触发 `command` 护栏，纯自然语言沟通保留 `content` 禁止红线与敏感信息检查而不再误触发 `sensitive_credential_cmd`。
- **修复巡检模式撞墙连环弹出重复提权弹窗（`command-ops.js`）**：阻止 `isWallBlockerEscalation` 只读拆墙评估落入重复 `L0 -> L2` 提权弹窗，并在 `permRank < 2` 下复用已有 `pendingElevation`，消除 16ms 连弹两张提权弹窗锁死界面的情况。
- **修复任务流画布子代理「幻影运行中」状态残留（`board-schema.js` / `src/client/tabs/tasks-flow.js`）**：当宿主子代理实际已进入等待/结束状态时，不再沿用陈旧任务的 `doing` 状态冒充运行中，画布实时回归「等待中」。
- **修复托管模式下缺失显眼紧急刹车控件（`chief-state.js` / `src/client/tabs/chief.js`）**：在 `🤖 托管` 模式下于参谋面板展示 `🤖 托管中` 徽标与红色 `⏹ 急停` 按钮，点击后一键硬刹回 `⏸ 关停` 并同步清空 `autoPilot` 与托管节奏状态。
- **修复任务交接单内容重复拼接（`handoff.js`）**：自动去重 `item.title` 与 `item.text` 重叠前缀，消除「这一程记住的」预览单条文本重复两遍的问题。
- **修复左侧「全局参谋长」未绑定会话视图点击边界开关报 HTTP 400（`board-actions.js`）**：将 `wall.list / wall.save / wall.setScope / wall.remove / wall.merge` 动作提前至 `!session && !shared` 校验之前处理。
- **修复「左侧边栏」布局下「任务 → 主线计划」下方空白（`src/client/styles/skins.js`）**：解除窄侧边栏误隐藏 `tasks-board` 的样式规则，并补齐窄容器响应式列排。
- **修复窄右侧栏页签偶发跳回与「记忆」高亮/闪烁问题（`src/client/api/transport.js` / `src/client/api/chief.js` / `src/client/components/Panel.js` / `src/client/styles/base.js`）**：禁止后台 4s 轮询 `activeWork` 擅自覆盖用户当前手动切换的页签、`askChief` 仅在用户仍停留参谋页时按需自动跳转、切页签同步收起悬空浮层、并为第 6 个 `extmem`（「记忆」）页签补齐深浅双模高亮配色。

### Security & Reliability（安全与模型协议加固）
- **净化模型原生工具控制标签泄漏（`state-schema.js` / `chief-state.js` / `chief-commands.js` / `chief-view.js` / `command-ops.js` / `command-helpers.js`）**：针对部分模型（如 `swe-2`）偶发吐出的 `<|open|>tools<|sep|>...<|close|>message<|sep|>` 控制协议片段，新增不触碰安全内核的纯清洗函数 `stripModelControlMarkup`，同步接入实时回答、目标建议、历史消息读取与纯控制标签自动纠偏重试通道，确保界面零协议碎片残留。

### Improved（界面排版与交互打磨）
- **窄栏排版防重叠与建议卡自适应折叠（`src/client/components/modals/pickers.js` / `src/client/styles/modals.js` / `src/client/styles/base.js` / `src/client/styles/skins.js` / `src/client/tabs/archives-cards.js`）**：顶部「参谋长建议」默认折叠为首 2 条并带展开收起与限高滚动；超长建议标题与原因默认两行省略（点「详情」完整展示）；补全窄栏 `Bento` 单列退让、`flex-wrap`、档案大屏 `.dnb-textarea` 全宽，以及窄栏顶栏 `.dnb-model-pill` 型号精简与自适应换行（避免被截断成 `DeepS`）。
- **记忆去前缀提炼与 2D 星图零重叠（`external-memory-studio.js` / `src/client/tabs/extmem-starfield.js` / `src/client/tabs/extmem.js`）**：新增 `distillOralMemoryText` 自动剥离「记住一条我的个人习惯：」等口语触发前缀再写入 `MEMORY.md` 与 `USER_PROFILE.md`；2D 记忆星图小规模星团扩大分布半径并升级为标签包围盒感知 28 轮排斥；存储源卡片实时同步记忆总条数。
- **可访问性与细节文案校正（`src/client/entry.js` / `src/client/components/modals/safety.js` / `src/client/tabs/boundaries.js` / `src/client/tabs/tasks-flow.js` / `src/client/styles/tasks-flow.js`）**：支持 `Escape` 一键关闭权限/节奏/模型/战术/边界浮层；修正 `L0 -> L1` 提权弹窗降档按钮文案逻辑倒挂；运行环境信息优先展示当前会话真实工作目录；为 SVG 流光画布阶段节点与子代理节点补齐 `role="button"`、`tabIndex={0}`、`aria-label` 与键盘焦点高亮框。

## [1.8.0] - 2026-11-25

> 新增**任务页 Route C Apple Bento 目标圆环全景卡 + 还原经典暗夜点阵 SVG 流程画布 / 流光节点图及全前端 5 套主题视觉统一重构**（默认「晨雾琉璃」，支持「温润纸感 / 静谧森系 / 星夜幻想 / 原生简约」一键秒切、随皮肤自适应变形的可拖拽扇形思考深度仪表盘 `EffortFanGauge`、5 页签/顶栏/输入条/协同 2.0/弹窗深浅双模全量统一与矢量图标降噪）；同时保留轻量全局自定义参谋长取名（对主对话 0 字节隔离）、彻底剥离试验性私有脑、修复协同名录幻影归属、协同摩擦与跨会话断流恢复（`B13–B15`），升级 **✦ 智选压缩** 4 档压力决策与 `40%+` 高水位兜底（`B16`）、新增参谋长**近 6 轮轻量短期记忆滑窗**治好连续追问失忆（`B17`）、加固安全内核混用引号拼接拦截并锁新指纹，以及「协同系统 2.0」（`Gemini CLI` / 实时流 / 2 棒接力）与左上角**真状态同步 GitHub Star 按钮**。

### Added
- **任务页 Bento 目标圆环全景卡 + 流程画布与流光节点合一视图与全前端 5 套主题系统（`src/client/constants.js` / `store.js` / `i18n.js` / `styles/skins.js` / `styles.js` / `components/common.js` / `components/Panel.js` / `tabs/tasks-flow.js` / `tabs/tasks.js` / `tabs/chief.js` / `tabs/boundaries.js` / `tabs/plan.js`）**：
  - **5 套双模主题皮肤（深/浅宿主全自动适配）**：新增 `晨雾琉璃`（默认，Apple × Arc 磨砂空气感）、`温润纸感`（Claude × Craft 书卷手帐风）、`静谧森系`（MUJI × Things 3 松烟和纸护眼感）、`星夜幻想`（紫夜星金樱粉温柔陪伴风）与 `原生简约`（中性极简兜底）。支持从**顶栏调色盘按钮气泡**或**设置页 2 列主题卡片**零刷新秒切并持久化到 `localStorage`，顶部游标条与全局弹窗在深/浅色宿主均保纯不透明及清晰层级。
  - **任务页 Route C + Route B 合一旗舰级重构与全前端减法瘦身**：顶部将核心目标整合为双砖 **Apple Bento 目标圆环全景卡**（`.dnb-bento-hero`，左卡显示清爽可读目标正文、点击即改并附 `战报 / 设为目标 / 拆成步骤`；右卡呈现动态 SVG 进度圆环与推进焦点提示）；下方将原「流程画布」与「流光节点」合一为单一「**任务流光图**」（`TaskBeamFlowView`），去除顶栏常驻版本号与重复弹窗、去掉任务页重复子代理横条/重复进度条/重复按钮、将参谋页操作区合入首卡标题栏并仅在高危/强介入时显示底栏紧急条、将设置页收拢为「3 张常开 + 4 张默认折叠」（合并「外观与基础」），同时彻底删除旧版管道/缩放画布、`NotesTab`、`TaskRow`、`ObjectiveRadarStrip`、`SubagentFleetBar`、`PacePickerPopover`、`styles/tasks-pyramid.js` 与 `tabs/brain.js`（前端模块精简为 `39` 个）。
  - **思考深度控件还原升级（`EffortFanGauge`）与全前端统一精修**：还原可拖拽指针扇形仪表盘并随 5 套皮肤自适应配色，彻底洗去 5 页签（`参谋 / 任务 / 协同 / 档案 / 边界`）、协同 2.0 气泡竞技场、底部输入条与弹窗中遗留的高饱和霓虹框与散落原生 Emoji，全面收敛为低饱和主题色与克制线性 SVG 图标。
- **轻量全局参谋长自定义取名 & 私有脑剥离（`state-schema.js` / `chief-state.js` / `chief-view.js` / `chief-commands.js` / `api-routes.js` / `src/client/tabs/plan.js`）**：
  - **参谋长专属取名（对主对话 0 字节隔离）**：可在设置页直接为参谋长取名（如「哈基米」「贾维斯」），一键恢复默认；经敏感凭据正则硬拦截后写入全局配置，不激活普通聊天会话，实时同步顶栏标题、输入条、外协落款与参谋自身系统提示词身份，严守对 `@lead` 主对话提示词 0 字节隔离。
  - **剥离试验性私有脑**：移除 `private-brain.js` 与整页私有脑视图及相关内部 `brain.*` 接口，待后续以「仅在参谋模型运行的开放外部记忆插件接口」方式重新架构，避免锁定用户记忆数据格式。
- **协同闭环名录与防自回旋投递修复（`subagent-runtime.js` / `chief-network.js` / `digest.js` / `model-tools.js` / `src/client/tabs/peers.js`）**：
  - **禁止看板任务 `owner` 冒充原生子代理**：`refreshSubagentTree` / `getSubagentRoster` 不再将 `board.tasks` 上的 `t.session`（主对话根会话 ID）伪造为子代理 `id` 或假报 `running`，无原生实例或诊断项统一标为 `kind: 'stale'`（`routable: false`, `id: ''`）；与已联动 `peer-session` 同名的遗留任务不再产生同名 `subagent` 幻影。
  - **Path B 防自回旋铁闸与 `readBy` 铁律**：`deliverSinglePeer` 拦截所有 `stale` 目标、`id === rootId/fromSession` 的子代理回旋以及跨 `rootId` 绑定错配并记为 `unrouted` / `stale_target`，拒绝写入 `readBy` 且记录 `mail_routing` 审计日志（保留合法 `Chief -> lead` 递话通道），同时在 `mail.send` / `mail.inbox` 回显准确路由状态与实例 ID。
- **左上角真状态同步 GitHub Star 按钮与边界安全模板包（`github-star.js` / `api-routes.js` / `src/client/api/chief.js` / `src/client/components/Panel.js` / `src/client/tabs/boundaries.js` / `src/client/styles/v180.js`）**：
  - **双模真实 GitHub Star（方案 1）**：通过 `github-star.js` 公开拉取 `gluztm/dsh-chief` 全网真实 Star 数展示在顶栏左上角；若用户本机已安装且登录官方 GitHub CLI（`gh`），通过宿主沙箱 `subprocess.spawn` 读取个人 `/user/starred/gluztm/dsh-chief` 真状态并支持点击直接 `PUT` 点星（`Shift+点击` 取消）；无 `gh` 或未登录时优雅降级为打开 GitHub 仓库页并在回切窗口时自动刷新计数，且绝不触发未启用普通聊天的自动激活。
  - 「边界」页 `🚧 自定义拦截规则` 新增 **「📦 模板包」**（4 套一键防翻车规则包 + JSON 导出/导入备份，重复规则自动跳过）。
- **「协同系统 2.0」与 `Gemini CLI` 直连（`state-schema.js` / `network-harness.js` / `api-routes.js` / `src/client/tabs/peers.js`）**：
  - 本机外协探测新增 **`Gemini CLI`**（含 `DSH_CHIEF_GEMINI_BIN`、`~/.gemini` 与密钥环境识别及前端四芒星官方图标）；
  - 新增 **「📡 外协实时输出流」** 终端视窗，运行期间实时滚动展示脱敏后的尾部日志并保留近期运行回看；
  - 外协派单条新增 **「🔗 完工自动转交」** 2 棒链式接力（支持如 `Codex → Claude Code / Gemini CLI` 交卷摘要接力、深度 `<= 1` 防死循环、失败或急停不触发下一棒）。
  - **回归门禁（`tests/verify-v180-brain-collab-gate.mjs` / `tests/verify-v130-release-gate.mjs`）**：
  - 全量覆盖 `B1 / B1.5 / B6 / B7 / B10 / B12 / B13 / B14 / B15 / B16 / B17` 与 `G8` 混用引号盲测，全部接入 `test:ci` / `test`。
- **任务页还原经典点阵 SVG 流程画布 / 流光节点图（`src/client/tabs/tasks-flow.js` / `tasks.js` / `styles/tasks-flow.js` / `styles/skins.js`）**：
  - 在 Bento 目标卡之下回归深色暗夜点阵 SVG 流程画布与跨步弯弧连线，支持点击节点或子代理芯片原地展开内联详情抽屉。
- **协同闭环摩擦、断流恢复与防自回旋加固（`auto-continue.js` / `idle-guard.js` / `runtime-hooks.js` / `chief-network.js` / `model-tools.js` / `B14–B15`）**：
  - 禁止唤醒已完成的子代理、静默续跑精准避让正在运行的子代理与跨会话外部等待状态、同前缀重名子代理强制消歧并用精确 `targetKind`/`crossSession` 回执标注。
  - 修复辅助会话中途断流导致状态脱节：回合中 `dsh-chief-relay` 插话自动清空旧回合输出状态、未回复跨会话来信免受“看板全完成”误拦截、断流异常时向等待方同步推送去重断流告警并在对方新回合启动时自动清标。
- **✦ 智选压缩灵敏度升级与参谋长轻量短期记忆滑窗（`chief-review.js` / `digest.js` / `command-helpers.js` / `chief-commands.js` / `B16–B17`）**：
  - 重构 `✦ 智选压缩` 为 4 档水位决策与提示（轻载禁压 / 中轻度 / ⚡ 中高压甜点区 / 🔥 高水位），修复巡检 12 秒冷却期丢弃复盘，并新增 `≥40%` 或 `≥180K` 高水位防漏压兜底（完整保留 `<20%` 轻载禁压与空转预告防误压底线）。
  - 为右侧参谋聊天新增「近 6 轮轻量短期记忆滑窗」（自动剔除系统回执与敏感片段、单条限长、总预算 2,800 字封顶）与指代锚定指引，解决 Flash 等轻量模型连续追问“转头失忆”的问题。
- **安全内核混用引号拼接加固（`safety/command-analyzer.js`）**：
  - 将引号拼接折叠升级为支持单双引号/反引号多轮交叉混合拼接还原（如 `cat '.'+"env"`），零误杀并同步更新锁定防篡改 MD5 指纹。

## [1.7.1] - 2026-11-23

> 紧急修复 DSH `0.2.3-alpha.2`（Cordis `4.2.0-alpha.1`）升级后系统提示词注册失败、严格无损 JSON 校验拦截及主对话断链吞错问题；同时根治安全拦截开关死锁、将安全/规矩概念缩减统一为简明大白话，并优化空转守卫与智选压缩配合。

### Fixed
- **适配 DSH `0.2.3-alpha.2`（Cordis `4.2.0-alpha.1`）提示词注入与事件监听（`runtime-hooks.js`）**：
  - 修复 `ctx.inject(['systemPrompt' | 'llm' | 'subprocess'], ...)` 中对未注入上下文属性的直接点号访问导致系统提示词「参谋看板」段落静默注册失败的问题，全部改为 `ctx.get(...)` 安全读取。
  - 会话活跃时间戳刷新补齐对 `0.2.3-alpha.2` `user/message` 事件名的识别。
- **适配严格无损 JSON 校验与预设隔离域压缩（`chief-network.js` / `subagent-runtime.js`）**：
  - `buildMessageEnvelope` 自动清理 `source` 中的 `undefined` / `NaN` / `Infinity` 字段并规整 `-0`，消除被宿主 `walkJsonValue` 拒收的风险。
  - `executeHostSessionCompaction` 优先通过 `agentPresets.serviceFor(ag, 'compaction')` 穿透隔离预设调用压缩，并在失败时带出真实错误详情。
- **修复主对话递话吞错与空白会话误判劫持（`chief-network.js` / `subagent-runtime.js` / `chief-commands.js` / `chief-approvals.js`）**：
  - 解除 `deliverSinglePeer` 中 `agentsSvc` 前置门控，真实透传 `sessionController.resolveAgent` 返回的错误（如预设不可用 `agent-preset/not-found`），上层如实展示未送达原因与 `⚠️ 未送达主对话` 标识。
  - 收紧 `isBlankContext` 判定（校验任务、记忆、日志、活跃记录、`lastCompactedSeq` 与实时会话状态），并在明确投递失败时禁止写入 `pending-transfer.json` 劫持后续新会话。
- **修复安全拦截开关死锁与确认弹窗失灵（`chief-state.js` / `src/client/tabs/chief.js` / `src/client/api/chief.js` / `src/client/components/modals/safety.js` / `src/client/components/modals/intervention.js`）**：
  - 修复控制面板开关变更透传全量 `...tm` 导致关闭安全拦截后其余开关全部被拒的死锁问题（改为仅发送变更字段，且后端仅在开关真实从开启变为关闭时要求风险确认）。
  - 在 `updateSecConfig` 的 `catch` 分支补齐 `requireSafetyGuardConfirm` 弹窗唤起，避免只弹顶部红条却无法打开确认窗。
  - 新增控制面板「🛡️ 安全拦截（自动防误操作）」一键开关，确认关闭弹窗用大白话说明风险，支持原地切换「仅关闭当前对话 / 关闭全部对话」并可勾选同时暂停「自定义拦截规则」；按实际触发源拆分 `safety_guard_blocked` 与 `guard_wall_blocked` 告警，拦截回执常驻记录。
- **概念缩减与全界面大白话统一（`src/client/*` / `runtime-hooks.js` / `chief-review.js` / `board-actions.js` / `chief-approvals.js` / `chief-commands.js` / `README*.md`）**：
  - 将原先重叠的「安全卫兵 / 红线哨兵 / 物理驻墙 / 禁止红线 / 必做事项」收束为仅 2 个互不重叠的大白话概念：**`🛡️ 安全拦截`**（程序直接拦住，AI 绕不过：包含「自动防误操作」内置防线 + `🚧 自定义拦截规则`）与 **`📝 给 AI 的规矩`**（每轮提醒 AI 照着做：分为 `✅ 必须做`、`🚫 不要做`、`💡 注意` 三栏）；移除控制面板与底栏中多余的「红线哨兵 / 拦截播报与巡检」开关。
  - 优化顶栏 `⏸ 关停 / 🛡 巡检 / 🤖 托管` 悬停大白话说明，并在「边界」页顶部新增「自动防误操作」状态卡与「自定义拦截规则」的 `⏸ 全部暂停 / ▶ 全部启用` 一键按钮；保留全部后端字段以兼容既有工作区预设。
- **优化空转守卫与智选压缩配合（`idle-guard.js` / `chief-review.js`）**：
  - 扩充 `detectPrematurePromiseText` 对「现在执行 / 补充验证 / 确认…一致性」等口头预告词的检测并放宽句数扫描（最后 4 句、380 字内）。
  - 为 `smartCompact` 增加低上下文（`<20%` 且 `<35K tokens`）与空转停顿双防线，避免 10% 上下文时抢在续跑前发起 `/compact`，并在无强介入时给出 `⏸ 空转提醒` 一键催跑建议卡。
- **回归测试补强（`tests/verify-v170-dsh023-compat.mjs` / `package.json`）**：
  - 覆盖 Cordis 4.2 严格代理、严格无损 JSON、错误透传、防交接单劫持、压缩态判断、`user/message` 与隔离域压缩（S1–S6），以及开关防死锁、空转守卫扩充与智选压缩防早产/拦截分类（S7–S9），全面接入 `test:ci` / `test`。

## [1.7.0] - 2026-11-22

> 全新「协同系统」直连本机 `Codex` / `Claude Code`、主页面大屏模式、会话级按需启用、人类专控安全卫兵开关，以及模块拆分与文档更新（Fixes [#5](https://github.com/gluztm/dsh-chief/issues/5), [#6](https://github.com/gluztm/dsh-chief/issues/6)）。

### Added
- **「协同系统」与本机 `Codex` / `Claude Code` 直连（`tabs/peers.js` / `styles/bubble.js` / `network-harness.js` / `chief-network.js` / `chief-view.js`）**：
  - **可视化编队画布**：主对话、卫星子代理、跨窗口与本机外部代理同屏连线；空闲时画面完全静止，工作时对应图标和 SVG 连线高亮流动，编队运行期间自动锁定防止误拆（HTTP 409）并支持一键 `⏹ 急停解体`。
  - **本机外部代理直连**：免 `ccSwitch` 跨平台探测本机安装的 `Codex` / `Claude Code`（含 Windows `.cmd` shim、脱敏环境变量直连），派单前自动附带当前红线与物理驻墙。
  - **待命池刷新与 `@lead` 编队视野**：新增「刷新扫描」一键免切窗发现工作区内的休眠会话并过滤后台干扰；让 `@lead` 看到完整编队列表并打通 L2/L3 桌面取档。
- **主页面大屏模式 (`conversation.view`) 与入口开关（Fixes [#5](https://github.com/gluztm/dsh-chief/issues/5)，`entry.js` / `store.js` / `components/Panel.js` / `tabs/plan.js` / `styles/base.js`）**：
  - 在对话顶部注册 `参谋长 / Chief` 主页面页签（`order: 1`），切过去后居中宽屏展示并自动隐藏宿主底部原生主输入框与 `CC` 用量条（切回对话恢复），并通过 `--dsh-conversation-viewport-height` 适配 DSH `0.2.2-rc.3` 贴底高度。
  - 设置页新增「🖥️ 面板显示位置（主页面 / 右侧栏）」：`右侧栏 + 主页面 / 仅主页面 / 仅右侧栏`、独立关闭「输入框旁快捷按钮 (`showComposerEntry`)」与「右下角浮动按钮 (`showCornerTrigger`)」，以及「子代理窗口隐藏参谋长页面」提示卡片。
- **会话级按需启用（普通窗口不介入，Fixes [#6](https://github.com/gluztm/dsh-chief/issues/6)，`state-schema.js` / `chief-state.js` / `runtime-hooks.js` / `chief-view.js` / `api-routes.js` / `components/Panel.js` / `tabs/plan.js`）**：
  - 参谋长改为会话级按需启用（`sessionEnabled`）：新开的普通聊天窗及其子代理在未启用时，`systemPrompt.section`、`tools/pre-execute`、`agent/pre-step`、`tools/result`、`session/event`、`agent/turn-stopping`、`agent/created` 与 `watchdogTimer` 这 8 处后端钩子直接放行，不注提示词、不拦工具、不写空白看板。
  - 未启用会话打开面板时，顶部提供一键「在本会话启用」提示条；设置页提供「本会话启用参谋长」与「新会话默认自动启用」（默认关闭）；改语言或通知等全局设置不会顺带激活普通会话，已有配置或数据的老会话自动保持启用。
- **安全卫兵单会话 / 全局人类专控开关（Fixes [#6](https://github.com/gluztm/dsh-chief/issues/6)，`safety/invariant-guards.js` / `safety/guard-walls.js` / `safety/tool-gate.js` / `chief-executor.js` / `state-schema.js` / `chief-state.js` / `runtime-hooks.js` / `api-routes.js` / `tabs/plan.js` / `tabs/boundaries.js` / `modals/safety.js`）**：
  - 设置页新增「🛡️ 内置安全卫兵（越界 / 凭据 / 高危命令）」卡片，提供本会话开关与全局总开关（默认开启，与右侧栏「红线哨兵」和手工「物理驻墙」互不影响）。
  - 关闭任一开关须经人类风险确认弹窗（非人类调用或未勾选确认被后端拒绝并记入 `chief-audit.jsonl`）；开关配置在 `normalizeTacticalModes` 与 `evaluatePreExecuteDefense` / `evaluateSafetyGuardHardRules` 全路径持久化生效；关闭时边界页顶部显示警示条与一键恢复按钮，切换全局开关不激活未启用会话。

### Changed & Fixed
- **子代理对话默认改为在现有右侧栏加页签（Fixes [#5](https://github.com/gluztm/dsh-chief/issues/5)，`store.js` / `tabs/peers.js` / `tabs/plan.js`）**：
  - 去掉 `openSubagentChat()` 默认的 `preferNewPane: true`，改为 `{ revealIfOpened: true }` 在现有右侧栏开新标签页并去重，同时在设置页保留「`现有栏加页签` / `新开分屏`」可切换；协同水泡子代理胶囊默认文案改为「查看」。
- **清理待命池幽灵会话与后台任务（`chief-network.js`）**：
  - 移除 `listPeerDirectory` 全盘孤儿扫描，只从有效 `workspaceRegistry` 发现候选；过滤掉 `Mnemon · Memory maintenance` 等插件后台任务、无标题无任务的空白空壳、读取失败快照与 `.v4` 子代理。
- **修复 `destructive_command` 对文档 heredoc 与只读查询的误判（Fixes [#6](https://github.com/gluztm/dsh-chief/issues/6)，`safety/invariant-guards.js`）**：
  - `isDestructiveShellCommand` 对不送入危险管道的纯文档 heredoc（如 `cat > ".../交付说明.md" <<'DOCEOF'`）、`export ...=` 前缀、`grep`/`rg`、`git log/show/diff/status/commit`（保留 `-c` 等危险参数检查）及未接管道的 `echo`/`printf` 不再误拦截；同时收紧 `shutdown`/`diskpart`/`mkfs` 匹配条件，补上 `python3 -c "os.system('rm -rf /')"` 检测，并继续拦截 `.sh` 可执行 heredoc 与管道执行脚本。
- **修复 `board.cursor.blocked` 红色「受阻」告警条误报（Fixes [#6](https://github.com/gluztm/dsh-chief/issues/6)，`board-schema.js` / `board-actions.js` / `digest.js` / `model-tools.js` / `src/client/utils.js` / `components/Panel.js` / `components/common.js`）**：
  - 新增前后端 `normalizeCursorBlocked` 归一化，自动把「无」「无（已获用户批准执行）」「已解除」「用户已接受…」「None / N/A / Resolved」等非阻塞陈述转成空串，避免顶部误亮红条；保留「无法 / 无权限 / 没有找到 / 等待用户批准 / 但仍缺少…」等真实阻塞信息，并更新 `cursor.set.blocked` 参数提示。
- **外部代理消息统一归入「跨窗」（`network-harness.js` / `chief-state.js` / `chief-network.js` / `tabs/peers.js`）**：
  - 外部 Harness 派单和回执改用 `channelType: 'pair'` 与 `harness:<provider>` 根标记，在协同消息区统一归进「跨窗 · 外协」折叠列表，同时修掉双 `@@` 前缀。
- **浅色主题适配、界面精简与源码拆分（`src/` / `tools/`）**：
  - 协同卡片更名为「协同系统」，去掉多余开关及次级页「连接其他对话窗口」「长期规矩」；全页适配 DSH 桌面浅色主题（含浮窗、扇形表盘、协同画布与提示条），去掉任务完成删除线；将超过 2,000 行的源文件拆分为 **44 个后端模块（含 9 个安全模块）+ 39 个前端模块**，版本号升至 `1.7.0`。

## [1.6.0] - 2026-11-21

> 5 页签整合、SVG 流程画布、顶栏齿轮设置、离桌托管告警/预算熔断与中英双语。

### Added

#### 🧭 可视化工作拓扑、5 页签整合与卡片折叠 (`board-schema.js` / `board-actions.js` / `digest.js` / `subagent-runtime.js` / `tabs/tasks-flow.js` / `tabs/tasks.js` / `components/common.js`)
- **工程实现**：
  - **5 页签整合**：将原「规划」页签并入「任务」页签（顶栏保持 `参谋 / 任务 / 协同 / 档案 / 边界` 5 个页签），按「核心目标 → 流程画布 / 组织树 → 推进任务板 → 跨会话接力与部署」排列。
  - **工作流推进流与跨步回指 (`planStepId` / `targetPlanStepId` / `derivePlanFlowProgress`)**：任务卡片支持关联规划步骤及目标回指步骤（对历史看板基于 `graph.plan` 自动回填）；「流程画布」用 SVG 绘制主线顺序节点、子代理分支与跨步回指连线。
  - **统一卡片折叠组件 (`AccCard`)**：推进任务板默认折叠已完成任务分组；「组织树」默认收起，移除全局 `全部收起 / 全展开` 按钮，点击 `👑 主代理` 卡片整卡即可展开或收起子代理树，并补齐 DSH 浅色主题样式。
- **用户感知**：打开「任务」页即可在一屏内看懂主代理和子代理现在推到第几步、卡在哪步、谁做完会向哪步交卷；平时层级保持收起干净，需要排查哪一条再点开即可。

#### 🌙 离桌托管闭环：关键节点告警、LLM 调用账本与硬预算熔断、复盘战报导出 (`chief-state.js` / `chief-models.js` / `chief-review.js` / `runtime-hooks.js` / `src/client/notify.js` / `src/client/report.js`)
- **工程实现**：
  - **7 类关键里程碑告警与静默基线引擎**：后端在 `pending_approval`、`pending_elevation`、`guard_wall_blocked`、`auto_continue_rescue`、`managed_auto_sleep`、`budget_circuit_break`、`hazard_halt` 事件写入 `alertEvents`（5s 同键去重、20 条滚动上限）；前端 `notify.js` 为每个会话建立首次静默基线（绝不重放历史旧告警），后续增量推送按开关触发系统桌面 `Notification` 与双音阶 WebAudio 轻柔提示音。
  - **参谋长 LLM 分类账本与硬预算熔断 (`llmLedger` / `checkManagedBudgetBeforeCall` / `recordChiefLlmUsage`)**：按 `问答(chat) / 巡检(review) / 梦境漫游(dream) / other` 统计调用次与输入/输出 Token（对累计统计字段施加 `1M calls / 1B tokens` 安全上限夹紧）；在 `托管` 模式下触及单轮次数上限（默认 30 次，可设 `3–500` 或 `0=不限`）或 Token 上限（默认 `300K`，可选 `100K/300K/500K/1M/不限`）立即触发硬熔断并退回 `⏸ 关停`，同时确保人类主动 `ask_chief` 问答永远豁免阻断。
  - **Markdown 复盘战报导出 (`report.js`)**：汇集核心目标、规划进度、任务验收证据、子代理名册、参谋摘要、红线/物理驻墙及账本消耗生成结构化中/英文 `.md` 战报（自动脱敏 `sk-` / `ghp_` / `AKIA` / `AIza` / `Bearer` 及私钥块），支持一键下载 `.md` 文件或复制剪贴板。
- **用户感知**：离开电脑挂机时，遇到必须拍板或触发熔断会第一时间在桌面收到提醒，再也不用担心后台循环烧光额度；回来点一下就能导出或复制脱敏干净的整局战报交差归档。

#### ⚙️ 顶栏旋转齿轮「设置」页、3 档开箱情景预设与中英双语 (`components/Panel.js` / `tabs/plan.js` / `tabs/boundaries.js` / `src/client/i18n.js` / `locale/zh.json` / `locale/en.json`)
- **工程实现**：
  - **顶栏齿轮入口与边界页减负**：将设置页从「边界」二级页签移至顶栏 `DSH 参谋长` 与版本号 `v1.6.0` 之间的旋转齿轮按钮（点击顺滑旋转 `180°` 切换设置页），让「边界」页专注物理驻墙、红线列表与运行环境信息。
  - **3 档情景预设 (`CHIEF_SCENARIO_PRESETS`)**：支持一键切换「👁 只读旁观 (`L0 · 关停`) / 🤝 日常协作 (`L2 · 巡检 + 红线哨兵`) / 🚀 离桌托管 (`L3 · 托管 + 80% 压缩 + 30次/300K 熔断 + 桌面告警`)」；切换离桌托管必须经过弹窗双重风险确认（后端硬拦截无确认直传）。
  - **全界面中英双语 (`i18n.js`)**：补全 `locale/zh.json` 与 `locale/en.json`，支持 `跟随宿主 (auto) / 简体中文 (zh) / English (en)` 运行时无刷新切换并覆盖全部 5 个页签、弹窗及导出战报。
- **用户感知**：新装用户点顶栏齿轮就能 1 秒选好合身的协作挡位，也可以随时一键切换中英文界面。

### Fixed
- **修复 `--format` 选项误触发破坏性磁盘格式化拦截 (`safety/invariant-guards.js`)**：将命令行参数里的 `--format` 与真实磁盘格式化命令（如 `format C:`、`format.com D:`、`cmd /c format ...`）精确区分，`git log --format=...` 等高频开发命令零误杀，真实格式化命令仍 100% 硬拦截。
- **加固强介入防空转与冷却期接续 (`idle-guard.js` / `chief-review.js`)**：新增回合中途卡死/重复打转与连续工具报错空转识别 `detectMidTurnSpin`（写入规划操作豁免计数）；修复 `off` / `patrol` 模式下开启强介入被忽略、4 秒冷却期内跳过不重排、以及 LLM 未给出 `interventionText` 但存在 `goalMissing` 时漏发督导续推的问题。
- **修复硬预算熔断后的滞后调用拦截 (`chief-state.js`)**：`checkManagedBudgetBeforeCall` 在 `mr.tripped` 为真且未切入 `patrol` 时直接拦截滞后后台 `review` / `dream` 调用，防止熔断瞬间仍有在途定时器漏跑；显式切回 `patrol` / `managed` 或点击重置计数时同步清除熔断标记。

## [1.5.0] - 2026-11-20

### Added

#### 🗂️ 认知桌面、三层钩子与折叠卷宗 UI (`archive-core.js` / `archive-dossiers.js` / `tabs/archives.js`)
- **工程实现**：
  - **三层钩子可见性模型**：本局档案柜未整理草稿对主对话不可见、参谋随时可读，经参谋整理写入 `hookKeywords`/`hookCue`/`hasHook: true` 后仅向主对话注入轻量 `🪝` 索引并新增 `chief_board({ action: "archive.pull", id })` 按需拉阅（点亮 `leadPulledSessions` 与 `📖 主代理已拉阅` 徽章）；全局档案柜未织钩草稿对主对话和参谋不可见，织钩后仅向参谋开放 `globalHookIndex` 与 `pull_global` 拉阅（主对话保持 0 字节）；冷藏档案柜（`precipitated`）新增 `precipitatedFolders` 折叠抽屉及人类速览钩子，对主对话和参谋保持 0-byte 隔离并拦截参谋 `archiveOps` 访问。
  - **认知桌面预算与双通道注入**：`digest.js` 与 `board-actions.js` 移除 `sessionArchiveBriefs` 全文注入，确立置顶 `desktop`（上限 `2,400 Tokens / 6 份`）为唯一全文注入源；超额自动按 `copper < silver < gold`/Pin 时间退入 `recentlyUnpinnedWatch` 观察队列；新增 `executeChiefArchiveInjectionOp` 双通道（`pin_to_desktop`/`unpin_from_desktop` 通道 A、`deliver_to_lead` 一次性执行信封通道 B，记入 `chiefDeliveredSessions`），服从 L0–L3 权限控制。
  - **折叠纸质卡片 UI**：新增 `.dnb-desktop-zone`（含实时 Token 占用条与「🌙 交参谋梦境漫游归入抽屉」快捷按钮）、`.dnb-vault-banner` 谁在看总览横幅、全三层 `.dnb-drawer-box` 折叠抽屉及 `.dnb-paper-dossier` 折叠卷宗卡（折叠态仅显示标题、关键词钩子与谁在看徽章，点击后展开操作栏与分块记忆点）。
- **用户感知**：打开档案页顶部即见置顶「认知桌面」和 Token 额度条，三层档案未点开时只看标题和关键词钩子，谁能看、谁在看一眼了然，主对话上下文不再被无关历史档案挤满。

#### 🤖 运行模式与权限解耦、托管「🌙 梦境漫游」、5 条件自动休眠与连续执行 (`chief-review.js` / `auto-continue.js` / `runtime-hooks.js`)
- **工程实现**：
  - **三态运行模式 (`runMode: 'off' | 'patrol' | 'managed'`)**：统一替代旧版零散开关；`off` 后台 0 review LLM 消耗；`patrol` 常规回合 0 Token，仅在 `guard_wall_blocked`、`turn_error`、`stream_interrupted` 等异常事件唤醒巡检；`managed` 启用持续督导。
  - **托管后台「🌙 梦境漫游」 (`runManagedDreamRoam`)**：托管态 L1+ 权限时自动分拣未织钩草稿与 `recentlyUnpinnedWatch` 入抽屉并生成钩子，同时显示紫蓝毛玻璃遮罩 `data-tone="dream"`（`'🌙 参谋长正在梦境漫游 · 轻拢卷宗与织就钩子中...'`），不改写工作区代码或回推桌面。
  - **5 条件自动休眠守护**：`checkAndStopIdleAutoPilot` 仅在（1）闲置达 `managedIdleTimeoutMs`（默认 15 分钟）且无运行中代理、（2）0 `doing` 任务、（3）0 待审批/提权、（4）0 未结 `inquiries`、（5）0 待复盘定时器且 `recentlyUnpinnedWatch` 清空时自动切回 `'off'`。
  - **`Auto continue` 双模式唤醒与 L3 批量建议收口**：`patrol` 与 `managed` 下断流事件过红线与物理墙检查后按 L0–L3 分级处置（L3 下发 `[EXECUTION_REQUEST #taskId]`）；`L3 + 强介入` 时 `executeBatchSuggestions` 自动执行安全建议（跳过 `guard_wall`、`goal_approval` 及 `pinGlobal`）并产出 `isOneStopReport: true` 合并战报卡片 `'🏁 一站式战报回执'`。
- **用户感知**：关停即零消耗，巡检只在真出事或断线时介入，开启托管后参谋长会在空闲期运行「🌙 梦境漫游」归整卷宗并织好检索钩子，忙完 15 分钟所有待办归零后自动退回关停休眠。

#### 🧠 思考强度、自适应换挡与跨模型每角色 `🔒 锁挡` 保护 (`chief-models.js` / `subagent-runtime.js` / `tabs/chief.js`)
- **工程实现**：
  - **6 档配置与模型能力对齐 (`thinkingEffort`)**：支持 `auto / off / low / medium / high / xhigh`，调用 `llm.resolveModelInfo` 自动降级或对非推理模型剥离参数；`decideAdaptiveChiefEffort` 在 `chat_summary` / `dream_roam` / `quick_status` 自动降为 `off`，常规复盘为 `medium`，`blank_explore` / `wall_blocked` / `craft_wall` / `precipitate` / `strong_intervention` 升为 `high`，`hazard_diagnosis` 升为 `xhigh`，并在聊天与回执卡落盘 `thinkingEffort` 与 `thinkingEffortMode` 角标元数据。
  - **L2/L3 跨代理热调挡与 `🔒 锁挡` 拦截**：通过 `effortOps`、看板 `task.dispatch({ reasoningEffort })` 与 `controlMainAgent({ op: 'set_effort' })` 静默热调 `@lead` 与子代理下一轮推理深度；新增 `lockedModelEfforts` 每角色锁挡，用户一键锁定后参谋 L2/L3 自动改挡被拦截并记入审计。
- **用户感知**：可在模型选择器与参谋回复右上角直接看清每条回答使用的推理强度，默认「🪄 自适应」把高推理留给复杂排障与筑墙；也能直接在前端一键锁定主对话或任意子代理的思考挡位，防止参谋越权改动。

### Fixed
- **加固模型思考锁挡 (`lockedModelEfforts`) 权限隔离与 `toggleLockAgentEffort` 落地 (`chief-state.js` / `api-routes.js`)**：封堵非人类调用方通过 `updateChiefConfig` 直接篡改 `lockedModelEfforts` 或已锁挡 `chief` 思考强度的旁路（Fail-Closed 拦截并写入 `model_effort_lock` 审计日志）；仅允许经宿主鉴权面板路由 (`/chief/config`) 或显式 `byUser: true` 人工操作修改。
- **拦截 `inquiry.reply` 重复重放 (`chief-state.js`)**：`answerChiefInquiry` 校验问询当前状态，对已 `answered` 结案的 `inquiryId` 幂等拒绝并写入 `inquiry_reply_replay_rejected` 审计记录，杜绝覆盖原答案及重复写入聊天回执、审计日志与任务账本。
- **修复 DSH 浅色主题下弹层仍为深色问题（Fixes [#3](https://github.com/gluztm/dsh-chief/issues/3)，`styles.js`）**：将 `--dnb-popover` 从固定深色的 `--dsw-alias-hovercard-bg` 切换为随主题变的 `--dsw-alias-bg-elevated`，并显式适配 `html[data-ds-theme-source="light"]` 与 `[data-ds-theme="light"]`（独立于系统 `prefers-color-scheme`，覆盖四级权限弹层、战术驾驶舱、更多菜单、流光毛玻璃与俯视角纸质卷宗，并防止系统浅色误染 DSH 深色主题）。
- **子代理会话自动隐藏参谋长入口与防会话污染（Fixes [#4](https://github.com/gluztm/dsh-chief/issues/4)，`store.js` / `api.js` / `components/Panel.js`）**：新增 `isSubagentSessionId` 复用宿主 `sessions.subagentAddress` 与快照元信息识别子代理会话，在子代理对话框内自动隐藏输入框参谋长按钮（`ComposerEntry`）及主视口右下角悬浮入口（`CornerTrigger`），并阻止 `adoptSession` 被子代理窗格覆盖主会话焦点。
- **自适应顶栏版本号、锁挡状态同步、强介入先锁目标即推与极低概率请示拆墙（`Panel.js` / `tasks.js` / `modals.js` / `chief.js` / `chief-commands.js` / `chief-approvals.js` / `api-routes.js`）**：
  - 使用 `@container dnb-head` 在宽敞面板展示版本号、窄面板自动隐藏（未同步警示始终亮显）；
  - 修复子代理/主对话思考强度 `🔒 锁挡` 按钮因 `effortLocked` 缓存及别名键导致的无法切换/解锁问题，并区分清晰锁定态图标文案；
  - 开启「主动强介入」必须先填写并点选锁定核心总目标（未锁点击则目标框红框闪烁提醒），确认开启后按当前权限自动立即唤醒/审批首轮推进，无需再发“继续”；
  - 参谋长请示拆墙机制落地（`kind: 'wall_removal'`）：仅当主/子代理真实撞墙无法绕过并上报、参谋独立复核确认无替代方案时方可提交审批单，任何 L0–L3 权限均不可自拆或由自动流水线跳过，必须人类点击批准才暂挂/拆除目标墙；
  - 参谋摘要页新增「💡 咨询」按钮，坦诚给出建议或直接说明暂无建议/管不了的外部事项，不强行凑执行按钮，可执行项按标准权限与审批流程推进。
- **扇形思考强度仪表盘、固定高度防抽搐、弹窗实底防透与团队思考强度「自动 / 手动」简洁切换（`chief-state.js` / `chief-commands.js` / `subagent-runtime.js` / `api-routes.js` / `components/common.js` / `components/modals.js` / `tabs/chief.js` / `tabs/tasks.js` / `styles.js`）**：
  - 将模型选择器与战术驾驶舱中的思考强度替换为 180° 扇形档位表（`EffortFanGauge`）：支持拖拽/点击切换固定挡位或点按中心一键切回 `🪄 自动调节`，移除自动扫掠循环动画与底部自适应说明栏，保持原生气泡解释且彻底消除鼠标跨档悬停导致的弹窗高度抽搐；
  - 取消针对单个主/子代理的思考档位下拉调控与 `锁挡` 按钮，改为在扇形表盘下方提供「团队思考强度（主/子代理）：自动 / 手动」一键切换（`teamEffortMode`，默认 `auto` 由参谋长按当前权限范围自动调节，切换 `manual` 则由人类掌控且参谋主动调挡门禁与执行均严格拦截）；
  - 精简移除战术驾驶舱顶部 `拉起 / 复位` 把手，保留主代理与子代理卡片及调度标签前置 `agentLead` / `agentSub` 矢量图标，并为 `.dnb-tactical-pop` / `.dnb-perm-pop` / `.dnb-more-menu` / `.dnb-menu` 补充深/浅色实底背景修复深色模式下弹层半透明透底叠字问题。
- **支持鼠标单击毛玻璃遮罩收起并保留外框提示 (`components/Panel.js` / `styles.js`)**：当后台「🌙 梦境漫游」或自动审查打开毛玻璃遮罩时，显示 `点击任意处收起遮罩继续操作 · 外框流光表示仍在运作` 提示；点击遮罩任意位置可立刻收起模糊层恢复面板操作，外框继续保留直到后台动作结束。

## [1.4.0] - 2026-11-19

### Added

#### 🧱 全会话事前物理驻墙与独立安全内核 (`pkg/safety/` + `tools/pre-execute`)
- **事前物理硬拦截**：主对话、子代理与参谋调用文件或命令落地前统一经过 `tools/pre-execute` 门禁，撞墙直接拒止并写入 `chief-audit.jsonl`。
- **随身复用的动态物理墙**：边界页新增「🧱 物理驻墙」（持久化于 `~/.dsh/chief/guard-walls.json`），支持 `global`（跨窗口自动跟随）/ `workspace`（仅本工程）/ `paused`（暂挂备用）一键切换。
- **大白话手搓与同类合并**：对参谋说白话即可生成 `wallProposals` 草案（人工确认后落锁），支持多选或一键合并相同 `ruleType` 的物理墙（跨类型混选自动拦截）。
- **9 模块独立安全内核**：将硬守卫、命令拆解、路径穿透检测、能力引擎与审计拆为 `pkg/safety/` 9 个零业务依赖模块，与 `chief-executor.js` 全集 MD5 锁定。

#### 🤝 参谋懒介入协同、无感问询与自动续跑 (`chief-commands.js` + `chief-state.js`)
- **主对话优先（懒介入）**：高权限下只要未点名让参谋亲自操刀，工作区改动与命令统一发 `[EXECUTION_REQUEST]` 委派 `@lead` 动手，绝不冒充用户发言。
- **空白新窗口先探路定计划**：新开空白会话直接找参谋时，默认先引导 `@lead` 只读看代码 → `graph.plan` 排计划 → `chief.request` 汇报结论。
- **后台优先问询零打断**：参谋缺细节时经 `agent/pre-step` 递出 `[INQUIRY #id]`，主对话顺手调 `inquiry.reply` 秒回后继续原工作，不打断当前步骤。
- **审批/提权后自动续跑 (`TaskLedger`)**：点完「允许」后按持久化账本自动接上未走完的步骤；异常重启时自动将半途任务安全置为 `interrupted`，不偷偷重跑。

#### 🔒 细粒度能力模型与只紧不松策略 (`policy-engine.js` + `policy-plugin.js`)
- **`role + capabilities` 双层解耦**：界面保持 `advisor / assistant / strategist / chief` 四档，底层放开 `assistant` 低风险看板与档案整理免弹窗，依然严锁文件写入。
- **单次授权防复用与只紧不松插件**：逐项授权绑定目标路径/命令 `capabilityScope`；可选 `policyPlugins` 仅允许收紧规则，试图关闭硬守卫的配置直接拒绝。

### Changed
- **前后台流光舞台提示 (`activeWork`)**：参谋在前台或后台自动巡检、收档、维护边界或刷摘要时，面板自动切页并点亮流动渐变 + 双束光线边框与毛玻璃跃动字提示。
- **强介入双防线核对窗 (`InterventionConfirmModal`)**：开启前并排核对当前生效的「🧱 物理驻墙」与「🚫 禁止红线」，右上角改为「管理边界」并支持一键收起/拉开。
- **问答分组框、红盾哨兵与顺势刷摘要**：每轮提问与回执包进高对比分组外框并支持一键折展，按钮统一靠右下对齐；「🛡 红线哨兵」开启时变红并点亮双层红盾图标；每次聊完按 60 秒节流后台顺势刷新顶部摘要。

### Fixed
- **适配 DSH `0.2.2-rc.5` 原生工具与弹窗审批**：对齐 `dsh-tool-fs`（`read` / `read_image` / `write` / `edit` / `apply_patch`），修复仅禁写路径墙误拦 `str_replace_editor` 只读 `view` 模式的问题，接入 `tools/pre-execute` 原生 `{ kind: 'ask' }` 单次审批弹窗，并兼容多代际 `session(.vN).jsonl(.zstd)` 日志检索。
- **封堵复合管道、内联脚本与多反斜杠凭据变形**：补齐 `&& / || / | / ;`、嵌套 Shell、`node -e / python -c / pwsh / iex`（含 Base64）及引号多反斜杠绕过（如 `copy x ".\\"env`），对 `node .\env\setup.js`、`process.env.NODE_ENV` 与 `$env:TEMP` 保持 0 误杀；`bounds.*` 与驻墙删改强制校验 `HUMAN_BOUNDS_CONFIRM_TOKEN`。

## [1.3.0] - 2026-11-18

### Added

#### 🧩 模块化低耦合架构与双版本 CI (`ARCHITECTURE.md` + `build-client.mjs`)
- **前后端模块化拆分**：将 4 个超长单体文件拆为 **29 个后端模块 + 16 个前端源码模块**，`index.js`、`chief.js`、`archives.js`、`client.js` 公开导出保持 100% 兼容。
- **静态边界与双版本门禁**：强制零 `export let/var` 可变导出、零循环依赖，新增 GitHub Actions Node `22 / 24` 自动门禁。

#### 🔄 审批续跑、独立审计与对话流筛选 (`chief-executor.js` + `chief-state.js`)
- **点完允许自动接着跑 (`resumeTasks`)**：点击「允许本次操作」或完成提权后，按 30 分钟 TTL 与深度熔断自动续接未走完的多步任务，拒绝或超时自动取消不空转。
- **独立只追加审计账本 (`chief-audit.jsonl`)**：权限判定、放行/拒绝与安全拦截统一追加写入 `~/.dsh/chief/chief-audit.jsonl`，不受状态文件截断影响。
- **顶栏版本号与对话流筛选**：标题栏常驻显示当前版本徽章（`v1.3.0`）；参谋页支持 `全部 / 💬 问答 / 📋 回执` 筛选，待定建议统一收拢至顶部「`▶ 执行建议`」。

### Changed
- **跨进程与多线程文件锁加固 (`O_EXCL`)**：`board-store.js`、`chief-state.js`、`archive-core.js` 引入 `threadId` 唯一临时文件与 Windows NTFS `EPERM / EACCES / EBUSY` 随机抖动自旋重试，消除高并发丢写。
- **模型上下文窗口异步回写 (`subagent-runtime.js`)**：兼容同步与异步 `resolveModelInfo` 查询，及时缓存并刷新会话 Token 窗口统计。

### Fixed
- **命令与路径安全卫兵反混淆 (`chief-executor.js`)**：检查前统一执行 NFKC 规范化、PowerShell `-EncodedCommand` 解码、引号拼接与 `^` 插入符折叠；拦截越界写入、凭据符号链接与 NTFS ADS 流（如 `safe.txt:.env`）；待批操作绑定 SHA-256 `payloadHash`，同源 `guard()` 异常默认返回 `403`。
- **修复关闭右侧栏后每 3.2 秒自动弹回**：区分首次启动自动展开与用户手动收起状态，底部入口点击恢复真实折叠/展开（Toggle）。
- **修复档案页「一键收纳入柜」漏收与不刷新**：补齐会话看板、根会话看板与共享便签三路收纳，疑似密钥自动 `[REDACTED]` 脱敏入柜，并即时同步前端分柜计数。

## [1.2.1] - 2026-11-17

### Added

#### 🛡️ 四档会话权限与逐项操作授权 (`chief-executor.js`)
- **四档会话权限**：`advisor`（只读 · 默认）/ `assistant`（助手）/ `strategist`（逐项授权）/ `chief`（高自主）。
- **新会话一律只读起步**：新开窗口与跨窗投递进来的会话统一落在 `advisor`，只观察、只分析、只给方案，不改工作区、不打断主对话。
- **受控操作先弹窗**：改文件、跑命令、调子代理工作流前强制弹出「🛡️ 操作授权请求」，写明做什么 / 改谁 / 为什么 / 有什么影响。
- **单次授权不放永久权**：只有亲手点「允许本次操作」才执行；权限不够时模型主动打报告申请提权，不会自行升档。
- **提权申请闭环**：新增 `request_permission_elevation` 执行工具与 `chief_board permission.request` 动作，弹窗展示申请方、原因与目标档位，高自主档申请时可选择只提到逐项授权档。
- **旧配置自动降级**：未经风险勾选校验的旧版或异常配置一律回落到 `advisor`。

#### 🔒 统一安全流水线与审计日志
- **6 级流水线**：`用户模式 → 操作请求 → 安全卫兵硬性规则 → 权限判定 → 执行器 → 审计日志`。
- **红线对全档位硬兜底**：删库、`git reset --hard`、`.env` 与密钥泄露、全局禁止红线不因放权而松开。
- **高自主档先读风险**：进入前强制弹出「⚠️ 高权限模式风险告知」并勾选确认，后端复核 `confirmedChiefRisk === true`，切回低档或新建对话后自动失效。
- **全程留审计账本**：权限判定与执行结果均写入会话审计日志，支持前端弹窗检索。
- **随时急停**：输入栏红色 `⏹ 急停` 一键切断后台自驱，回到人工接管。

### Changed
- **`⚡ 主动强介入` 随档位差异化**：
  - `advisor`：仅只读巡检诊断与建议输出，不改写工作区，不注入 `@lead` 强推指令。
  - `assistant`：仅自动维护参谋记忆、档案与建议卡，不干预主对话执行流。
  - `strategist`：每轮强介入产生的关键受控动作、递话与压缩均队列化，逐条弹出授权请求，允许后单次执行。
  - `chief`：高自主闭环督导（直控主对话与子代理、纠偏、压缩前抢救与 `auto-continue.js` 续跑），配合死循环熔断与人工结项门禁。

### Fixed
- **修复「🚀 新建窗口并部署参谋长」按钮在深色与标准主题下发白看不清文字**：原 `--dnb-accent` 绑定宿主 `--dsw-alias-brand-primary`（标准深色主题下接近白色 `#f9fafb`），白字按钮对比度崩掉；现改用 `--dsw-alias-state-business-primary` 并引入独立的 `--dnb-primary-bg` / `--dnb-primary-fg` 高对比主按钮令牌，同时补齐暗色 `<select option>` 下拉配色。
- **修复「🚀 新建窗口并部署参谋长」创建会话未绑定当前 `workspaceId`、不自动跳转新窗**：`transferChief('create')` 现会继承当前会话工作区，前端同时兼容 `sessions.open(created)` 切换视图。

## [1.2.0] - 2026-11-16

### Added

#### ✦ 许愿框一站式执行器与四档权限门禁 (`chief-executor.js`)
- **内置多步实权工具循环**：用户可在右侧「✦ 许愿框」一句话直达查改工作区文件、目录搜索、运行安全命令、维护看板、整理档案与主动触发压缩。
- **四档精细权限控制**：支持 `read-only`（仅可查看）、`workspace-write`（工作区内修改）、`auto-review`（自动审查 EXP）与 `danger-full-access`（完全权限）。
- **空白新对话开场即战力**：无历史对话时也能主动定位工作区并下场勘察，无需等主对话先发送消息。
- **空白新对话待领交接暂存**：在空白上下文中拆发指令给尚未创建的 `@lead` 时，自动调用 `stagePendingTransfer` 写入 `pending-transfer.json`，主对话首轮发送即自动衔接。

#### 🏛️ 三层 0-Token 档案金库与双向差分
- **💬 本会话档案柜 (`session`)**：按 `rootSessionId` 实现 1:1 严格会话隔离，仅用户、当前会话代理与参谋长可见。
- **🌐 系统全局档案柜 (`global`)**：系统级 0-Token 冷库（`global-vault/vault-chief-global.json`），默认不随会话自动挂载，绝不自动迁移旧版遗留档案。
- **⇄ 本地 ↔ 全局实时双向差分**：自动标记「仅本地 / 已同步 / 本地已改 / 全局独有」差异，支持一键 `⤵️ 引入本会话`、`提炼入全局` 与增量覆盖更新。
- **🏛️ 沉淀档案柜 (`precipitated`)**：跨对话通用经验冷库（`precipitated/vault-global.json`），默认对主对话与参谋长**双盲 0 字节读取**。
- **📌 摆上桌面聚光灯与组合递话**：支持将任意三库卷宗点亮为「📌 摆上桌面（主+参谋可见）」并支持跨库复选卷宗、附带用户具体指令一键「组合递话」。
- **参谋专属按需检索**：支持逐会话切换 `👁️ 供本会话参谋参阅` / `📥 收回冷存`，或在参谋问答中按需检索全局冷库，用后即走。

#### 🗜️ `✦ 智选压缩` 与长任务自动续推
- **✦ 智选压缩 (`smartCompact`)**：可独立生效或协同 `autoCompact` 跳过固定百分比阈值，待阶段收口且主代理收敛空闲后自动抢救并静默压缩。
- **可见压缩回执卡片**：每次 `✦ 智选压缩` 真实执行后，自动向参谋对话流写入带 `✦ 智选压缩` 徽章的回执卡片（记录档案编号与压前 Token 占比）。
- **手动指令确定性压缩**：用户直说「压缩吧 / 压缩一下 / `/compact`」时绕过纯状态查询通道，确定性执行「先落盘抢救校验 → 再宿主静默压缩」。
- **长任务自动续推模块 (`auto-continue.js`)**：接入宿主 `autoContinue` 协同与参谋急停联动清理机制。

#### 🎯 强介入目标锁定、无限轮数与双安全门禁
- **核心目标目的地锁定**：开启 `⚡ 主动强介入` 后直接锁定核心目标作为唯一终局，防止后台督导跑偏。
- **无限轮次与防卡死熔断**：`maxInterventionTurns` 支持设为 `0 = ∞`（无限轮），同时保留连续无进展兜底熔断与风险弹窗确认。
- **高危操作急停弹窗**：检测高危干预时先弹窗提示风险，搭配输入栏红色 `⏹ 急停` 随时一键切断后台自驱。
- **必做事项结项核验门禁 (`allowed`)**：强介入或 `/goal` 收口前强制逐项核查 `allowed` 必做清单，未验证并获人工点击 `✅ 批准结项` 绝不退出督导模式。

#### 🌐 跨窗协同网、彩色信箱与可定住交接单
- **跨窗互连污染提醒与彻底脱离净化**：接入邻居会话前先弹窗提醒互享进展风险；断开协同立即校验 `clusterSig` 并清除摘要缓存、外部团队记忆与离线信箱残留。
- **彩色可折叠抽屉信箱与广播去重**：按会话固定配色，`@all` 广播自动去重归并，支持按全网广播 / 多方 / 双边 / 内部渠道折叠检索。
- **可手改与 `📌 定住防改` 交接单**：规划页支持手工编辑、一键定住冻结 `[自动渲染]` 快照（并同步锁定 `同步交接单` 开关防覆写）与发车前过期提醒弹窗。

### Changed
- **压缩触发区间全面放宽**：百分比自动压缩阈值由 `50%–95%` 调整为 `10%–95%`（低于 `25%` 弹出琥珀低阈值提示），并新增 `>= 8,000` 精确 Token 阈值模式。
- **交互入口与工作区布局重排**：战术驾驶舱 `+` 按钮收拢至输入栏居左，状态胶囊与权限档位直显于输入栏上方，跨会话接力区与 `📌 定住防改` 统一收口至「规划」页底部。
- **三层冷库晋升梯度规范化**：严格确立 `💬 本会话 → 🌐 系统全局 → 🏛️ 沉淀冷库` 单向逐级晋升规则（禁止本会话越级直接沉淀），并支持无损向下引入。
- **后端接口与打包边界扩展**：后端 `/api/dsh-chief/*` 同源环回保护接口扩展至 25 条；`package.json` `files` 清单补入 `chief-executor.js` 与 `auto-continue.js`。

### Fixed
- **修复手动与自动压缩报 `dsh-compaction service unavailable`**：绕过 Cordis 子分组对 `compaction` 服务的隔离限制，找不到直连服务时自动通过宿主官方 `commands.execute(ag, '/compact', ...)` 执行真压缩。
- **修复休眠会话无法触发压缩**：当 `agents.get(sid)` 未唤醒时，通过 `sessionController.resolveAgent(sid)` 自动恢复空闲会话句柄后再压缩；运行中会话继续安全拦截。
- **修复 `✦ 智选压缩` 静默失效与次数虚增**：重构 `executeHarvestAndCompact` 为严格原子提交——仅在真实压缩成功且非免压时递增 `autoCompactCount`、`lastCompactedSeq` 与 `lastCompactedAt`，报错或无历史免压绝不虚增，并将异常明细写入看板日志。
- **修复 `✦ 智选压缩` 因主代理未收敛空闲而错过触发**：在 `runTurnReview` 判断需要压缩时先等待最多 8 秒直到代理空闲后再执行，减少无谓滞后队列堆积。
- **修复空白新对话发送消息吐出 `<｜｜DSML｜｜ calls>` 源码**：扩展 `chief-executor.js` 解析与剥离正则覆盖双全角竖线、混合空格、单双引号及未闭合残缺标签，并在 `getChiefView` 返回历史记录前再次清洗净化。
- **修复空白新对话工作区路径丢失**：升级 `getSessionCwd` 在无活会话与空板卡时通过 `workspaceRegistry.list()`（优先匹配 `sessionIds`，否则按最新活跃时间兜底）与近期非内部配置文件板卡定位真实项目目录。
- **修复权限模式切换持久化与旧版宿主内存告警**：持久化保存 4 档 `permissionMode`，同步对齐前后端构建标（`1.2.0-r7`），在宿主仍运行旧内存模块或未挂载新版全局变量时友好提示重启客户端。
- **修复本地↔全局冷库前后端防串味问题**：前端独立拆分 `globalVaultItems` 存储状态，并拦截旧版后端误将本地档案当作全局冷库返回的非合规响应。

## [1.1.0] - 2026-11-15

### Added
- **Tactical Cockpit & Per-Workspace Intervention Gate**:
  - Workspace-isolated tactical controls (`intervention` strong-intervention gate with risk confirmation modal, consecutive turn cap & stalls circuit breaker, `strictVerify` empirical evidence enforcement, `redlineSentinel` boundary interceptor, and `conciseBrief` bulleted reporting).
- **Pre-Compaction Harvest-Verify-Compact**:
  - Automatic fact harvesting and disk verification prior to session context compaction without touching sealed cold precipitation vaults.
- **`/goal` Human Approval Gate**:
  - Pending approval cards before agents mutate long-running `/goal` objectives.
- **Dual-Vault Archive Architecture**:
  - Multi-cabinet switching (`cabinets`) for active engineering archives alongside a zero-token cold historical precipitation vault (`~/.dsh/chief/precipitated/`) with explicit per-entry unseal/seal (`翻牌启用/封存`).
- **One-Click Chief Deployment & Media Persistence**:
  - Cross-session Chief deployment cloning safe facts, narrative summary, and workspace preferences (forcing `intervention: false` and `flippedPrecipitatedIds: []`), with 4 archive transfer policies (`none`, `active`, `drawer`, `all`), plus `.dsh-chief-media/` image persistence with path fallback.

### Fixed
- **DSH Host Compatibility & Subagent API Guardrails (Fixes [#1](https://github.com/gluztm/dsh-chief/issues/1), thanks `@edz017`)**:
  - Tightened `package.json` `engines.dsh` constraint from `">=0.2.0"` to `">=0.2.2-rc.2"` so pre-refactor `subagents` hosts (such as `0.2.2-rc.1`) do not silently fail at runtime.
  - Added `probeSubagentSupport(runtime)` runtime capability detection in `index.js` (exposed via `/api/dsh-chief/snapshot` `hostCompat` + startup warning log) and a dismissible amber banner in `client.js`, while `task.dispatch`, `team.steer`, and `team.interrupt` now return clear Chinese upgrade guidance when `subagents.resolveName` is unavailable.
  - Fixed `sidebarRight.openResource` option key from `preferSeparatePane: true` to `preferNewPane: true` in `client.js`.
  - Added a DSH Host Version Compatibility Matrix to both `README.md` and `README.en.md`.

## [1.0.0] - 2026-11-14

### Added
- **Executive Chief Cockpit (`参谋` Tab)**:
  - Human-paced 3-gear briefing control (`⏸ 按需` default with zero background LLM calls, `⚡ 巡检`, and `🤖 托管`), preventing silent token drain.
  - Full `provider/model` channel alignment so the Chief follows the exact provider channel (e.g. CommandCode vs. Official) of the active root conversation.
  - Natural-language dispatch bar supporting `@主对话`, `@子代理`, `@跨窗会话`, and `@全体` broadcast across `steer` (插话), `followup` (递话), and `silent` (备忘) delivery modes.
- **Full-Spread Pyramid Task Topology (`任务` Tab)**:
  - Expanded hierarchical DAG layout placing the Root Coordinator at the apex and subagent squads across clean columns without cramped drag-scroll viewports.
  - Direct inline controls on every node for status transitions (`todo` / `doing` / `blocked` / `done`), plain-language explanation, subagent dispatch, and split-pane live stream inspection.
- **4-Tier Cold Engineering Archive Cabinet (`档案` Tab)**:
  - Dedicated cold-storage vault (`~/.dsh/chief/archives.json`) organized as **Filing Drawers → Paperclipped Dossiers (`璀璨金针` / `标准银针` / `暗古铜针`) → Memory Points → Unfoldable Sub-point Details**.
  - Strict 3-stage lazy loading (`Stage-0` `< 80B` metadata in `/snapshot`, `0` bytes injected into model system prompts while sealed; instant opt-in via `取出备查` or explicit `archive.search`).
  - One-click lossless Chief curation (`请参谋长整理收纳` / `请参谋长重拆此卷`) preserving 100% of raw markdown text.
- **Dual-Tier `/goal` & Interactive Step Board (`规划` Tab)**:
  - Dedicated top `/goal` long-running objective supervisor paired with a bottom step checklist.
  - Click-to-ask context menu on every step (`这条是什么意思 / 为什么有这步` & `让参谋长当场解读（不打断主对话）`).
- **Cross-Session SuperAgent Relay (`协同` Tab)**:
  - Undirected peer-session linking across independent DSH windows with unified directory discovery and shared collaboration mailbox.
- **Global Thumbtack Redline Governance & Self-Contained Handoff (`边界` Tab)**:
  - `📌` thumbtack toggle promoting rules to cross-session global boundaries vs. task-scoped rules, plus human-in-the-loop approval for agent-proposed rules and rule consolidation (`零散总结成一条`).
  - One-click self-contained markdown session handoff (`新建会话并交接`) with automatic frontend session navigation and `idle-guard` premature-stop protection.
- **Model Tool Suite & Local Security Hardening**:
  - Registered 4 structured model tools: `chief_board`, `chief_memory`, `chief_boundaries`, and `chief_handoff`.
  - Loopback + same-origin HTTP route protection across all `/api/dsh-chief/*` endpoints and regex secret blocking against accidental API key / private key persistence.
  - Zero external npm runtime dependencies; licensed under `AGPL-3.0-only`.

