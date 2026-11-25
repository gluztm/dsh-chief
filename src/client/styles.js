/**
 * src/client/styles.js — DSH Chief 客户端样式总装配门面与 <Style /> 注入器
 *
 * 【核心职责】
 *   按既定级联顺序聚合 `src/client/styles/*.js` 各专题样式模块，经由 `expandLightThemeSelectors()`
 *   自动展开 DSH 浅色主题选择器后注入单个 `<style data-dnb="3">` 标签；同时 re-export
 *   `detectHostTheme` 与 `isHostLightTheme` 供外部组件使用，并监听宿主主题变化同步 `data-dnb-theme`。
 *
 * 【模块组成（`src/client/styles/`）】
 *   - `styles/theme.js`          主题探测 & `html[data-ds-theme-source="light"]` 多选择器展开引擎
 *   - `styles/base.js`           全局令牌、顶栏（含 `.dnb-ver-chip`）、通用控件、浮层与手风琴基础样式
 *   - `styles/modals.js`         战术舱、目标审批、冷库弹窗与四档权限审批卡片样式
 *   - `styles/archives.js`       工程记忆档案柜、回形针卷宗与“一沓纸”叠放档案样式
 *   - `styles/chief.js`          图钉戳、DS-Bot 叙事卡、参谋工作态流光 FX、思考深度仪与预算账本
 *   - `styles/tasks-flow.js`     工作流任务抽屉、子代理卡片、交卷角标与任务板亮色适配样式
 *   - `styles/bubble.js`         Option A 液态融合协同水泡、官方 Logo 徽标与待命池样式
 *
 * 【未来新增页签样式的 3 步接入指南】
 *   1. 在 `src/client/styles/` 下新建专题模块（如 `styles/<new-tab>.js`），导出 `export const CSS_<NEW_TAB> = `...` `，
 *      并在该文件顶部补齐职责边界注释；浅色适配规则请统一使用 `html[data-ds-theme-source="light"] .xxx` 前缀。
 *   2. 在本文件导入该常量，并按级联优先级追加到 `STYLE_SHEETS` 数组中（一般置于末尾即可）。
 *   3. 运行 `npm run build:client` 与 `npm run check:client`，打包器会自动完成单包聚合与多选择器浅色展开。
 */

import { React, h } from './react-runtime.js'
import { detectHostTheme, isHostLightTheme, expandLightThemeSelectors } from './styles/theme.js'
import { CSS_BASE } from './styles/base.js'
import { CSS_MODALS } from './styles/modals.js'
import { CSS_ARCHIVES } from './styles/archives.js'
import { CSS_CHIEF } from './styles/chief.js'
import { CSS_TASKS_FLOW } from './styles/tasks-flow.js'
import { CSS_BUBBLE } from './styles/bubble.js'
import { CSS_V180 } from './styles/v180.js'
import { CSS_SKINS } from './styles/skins.js'

export { detectHostTheme, isHostLightTheme }

const STYLE_SHEETS = [
  CSS_BASE,
  CSS_MODALS,
  CSS_ARCHIVES,
  CSS_CHIEF,
  CSS_TASKS_FLOW,
  CSS_BUBBLE,
  CSS_V180,
  CSS_SKINS,
]

const RESOLVED_CSS = expandLightThemeSelectors(STYLE_SHEETS.join('\n'))

export function Style() {
  if (typeof document !== 'undefined' && document.documentElement) {
    const initial = detectHostTheme()
    if (document.documentElement.getAttribute('data-dnb-theme') !== initial) {
      document.documentElement.setAttribute('data-dnb-theme', initial)
    }
  }
  React.useEffect(() => {
    if (typeof document === 'undefined' || !document.documentElement) return undefined
    const root = document.documentElement
    const sync = () => {
      const next = detectHostTheme()
      if (root.getAttribute('data-dnb-theme') !== next) {
        root.setAttribute('data-dnb-theme', next)
        try {
          window.dispatchEvent(new CustomEvent('dnb-theme-change', { detail: next }))
        } catch {}
      }
    }
    sync()
    if (typeof MutationObserver !== 'function') return undefined
    const obs = new MutationObserver(sync)
    obs.observe(root, { attributes: true, attributeFilter: ['data-ds-theme', 'data-ds-theme-source', 'data-theme', 'class', 'style'] })
    if (document.body) {
      obs.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style'] })
    }
    return () => obs.disconnect()
  }, [])
  return h('style', { 'data-dnb': '3' }, RESOLVED_CSS)
}
