/**
 * src/client/styles/theme.js — 宿主亮/暗主题探测与选择器自动展开引擎
 *
 * 【核心职责】
 *   1. `detectHostTheme()` / `isHostLightTheme()`：跨 DSH Desktop (`body[data-ds-dark-theme]`、computed luminance)
 *      与 Web 宿主容器探测当前实际亮/暗主题，供 JS 逻辑与 SVG 画布颜色自适应使用。
 *   2. `expandLightThemeSelectors(cssText)`：将所有 `html[data-ds-theme-source="light"] ...` 规则
 *      自动展开为兼容 DSH Desktop 与插件自身 `data-dnb-theme="light"` 的多选择器集合。
 *
 * 【边界约定】
 *   - 仅承载主题探测与 CSS 字符串预处理逻辑，不包含任何样式规则本体或 React 组件。
 *   - 作为 `src/client/styles.js` 与 `src/client/styles/*.js` 的底层依赖（无环）。
 */

export function detectHostTheme() {
  if (typeof document === 'undefined' || !document.documentElement) return 'dark'
  const root = document.documentElement
  const body = document.body
  const attr = (
    root.getAttribute('data-ds-theme-source')
    || root.getAttribute('data-ds-theme')
    || root.getAttribute('data-theme')
    || ''
  ).trim().toLowerCase()
  if (attr === 'light' || attr === 'dark') return attr
  if (body && body.hasAttribute('data-ds-dark-theme')) return 'dark'
  const cs = (root.style && root.style.colorScheme) || ''
  if (cs) {
    const tokens = cs.toLowerCase().split(/\s+/)
    if (tokens.includes('light') && !tokens.includes('dark')) return 'light'
    if (tokens.includes('dark') && !tokens.includes('light')) return 'dark'
  }
  try {
    if (typeof getComputedStyle === 'function') {
      const rStyle = getComputedStyle(root)
      const rCs = String((rStyle && rStyle.colorScheme) || '').toLowerCase().split(/\s+/)
      if (rCs.includes('light') && !rCs.includes('dark')) return 'light'
      if (rCs.includes('dark') && !rCs.includes('light')) return 'dark'
      if (body) {
        const bg = String(getComputedStyle(body).backgroundColor || '')
        const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*[,/]\s*([\d.]+))?/i)
        if (m && (m[4] === undefined || Number(m[4]) > 0.05)) {
          const lum = (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255
          if (lum > 0.55) return 'light'
          if (lum < 0.45) return 'dark'
        }
      }
    }
  } catch {}
  if (body && !body.hasAttribute('data-ds-dark-theme')) return 'light'
  return 'dark'
}

export function isHostLightTheme() {
  return detectHostTheme() === 'light'
}

export function expandLightThemeSelectors(cssText) {
  return String(cssText || '').replace(
    /^([ \t]*)html\[data-ds-theme-source="light"\]([^,{\n]+)(,|[ \t]*\{)/gm,
    (_, indent, sel, tail) =>
      `${indent}html[data-dnb-theme="light"]${sel},\n`
      + `${indent}html:not([data-ds-theme="dark"]):not([data-ds-theme-source="dark"]):not([data-dnb-theme="dark"]) body:not([data-ds-dark-theme])${sel},\n`
      + `${indent}html[data-ds-theme-source="light"]${sel}${tail}`,
  )
}
