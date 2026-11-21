/**
 * src/client/entry.js (客户端插件总入口 · 详契见 pkg/ARCHITECTURE.md)
 *
 * 模块：src/client/entry.js (经 scripts/build-client.mjs 拓扑打包为 pkg/client.js)
 * 职责：提供 `createClientPlugin()`，绑定宿主服务并注册 UI 插槽（含 `conversation.view` 主页面）与右侧栏标签页 (`sidebarRightTabs`)。
 * 允许依赖：./constants.js、./store.js、./api.js、./components/Panel.js
 * 禁止依赖：后端 Node 模块、`node:*` 内置库；禁止修改 `src/client/` 后遗漏运行 `npm run build:client`。
 * 公开 API：createClientPlugin (bundle 包装后向 `window.__ModuleLoader__.load({ id: 'dsh-chief' })` 暴露)
 * 持有状态：无 (唯一 `store`、`listeners`、`SESSION_SOURCES`、`runtimeRefs` 位于 ./store.js；禁止跨模块 `export let` 赋值)
 * 副作用：注册 4s 状态轮询与右侧栏自动挂载定时器、绑定全局 pointerdown/Escape 关闭监听。
 * 安全边界：高权限切换 (`chief`) 与 `strategist` 操作审批弹窗强校验后端状态；`abandon/clear` 会话自动重置敏感弹窗态。
 */

import { SIDE_ID, BRAND_NAME } from './constants.js'
import { bi } from './i18n.js'
import {
  store,
  patch,
  subscribe,
  service,
  seedRightbarIfEmpty,
  runtimeRefs,
} from './store.js'
import { refresh } from './api.js'
import {
  Panel,
  SessionProbe,
  ChiefIcon,
  ComposerEntry,
  CornerTrigger,
  MainPanel,
  ConversationChiefView,
  SidebarChiefTab,
} from './components/Panel.js'

/* ---------------------------------------------------------- Plugin Init */

export function createClientPlugin() {
  return {
    inject: ['slots', 'uiWorkspace', 'layout', 'sidebarRight', 'sidebarRightTabs'],
    apply(ctx) {
      runtimeRefs.hostCtx = ctx
      runtimeRefs.navigation = ctx.uiWorkspace || null
      runtimeRefs.layout = ctx.layout || null

      ctx.effect(() => {
        void refresh()
        const timer = setInterval(() => void refresh(), 4000)
        return () => clearInterval(timer)
      }, 'dsh-chief: board poll')

      ctx.effect(() => {
        const trySeedOnce = () => {
          try {
            if (runtimeRefs.initialRightbarSeeded || runtimeRefs.userDismissedChief) return
            seedRightbarIfEmpty()
          } catch {}
        }
        const first = setTimeout(trySeedOnce, 900)
        const second = setTimeout(trySeedOnce, 2500)
        return () => {
          clearTimeout(first)
          clearTimeout(second)
        }
      }, 'dsh-chief: claim empty right sidebar once on boot')

      ctx.effect(() => {
        const tabs = service('sidebarRightTabs')
        if (!tabs || typeof tabs.register !== 'function') return undefined
        return tabs.register({
          id: SIDE_ID,
          kind: SIDE_ID,
          priority: 'extension',
          title: () => bi(BRAND_NAME, 'DSH Chief'),
          guide: [
            {
              id: SIDE_ID,
              order: 40,
              title: () => bi(BRAND_NAME, 'DSH Chief'),
              description: () => bi('管摘要、任务、窗口协同、档案和边界规则', 'Manage summaries, tasks, window sync, archives, and guard rules'),
              icon: ChiefIcon,
            },
          ],
        })
      }, 'dsh-chief: right-sidebar tab type')

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register({ name: 'sidebar.right.pane.tab', key: SIDE_ID, order: 100 }, SidebarChiefTab),
          ),
        'dsh-chief: right-sidebar tab body',
      )

      ctx.effect(
        () => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: SIDE_ID, locale: 'zh-CN' }, MainPanel)),
        'dsh-chief: main-area page',
      )

      ctx.effect(() => {
        let disposeConvView = null
        const syncConvView = () => {
          const pref = store.placementPref || {}
          const wantTopTab = pref.placement !== 'sidebar'
          if (wantTopTab && !disposeConvView) {
            disposeConvView = ctx.slots.inject('conversation.view', () =>
              ctx.slots.register(
                {
                  name: 'conversation.view',
                  id: SIDE_ID,
                  order: 1,
                  label: () => bi(BRAND_NAME, 'DSH Chief'),
                },
                ConversationChiefView,
              ),
            )
          } else if (!wantTopTab && disposeConvView) {
            try { disposeConvView() } catch {}
            disposeConvView = null
          }
        }
        syncConvView()
        const unsub = subscribe(syncConvView)
        return () => {
          unsub()
          if (disposeConvView) {
            try { disposeConvView() } catch {}
            disposeConvView = null
          }
        }
      }, 'dsh-chief: conversation view top tab')

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register({ name: 'sidebar.panellist', id: SIDE_ID, order: 40, label: () => bi(BRAND_NAME, 'DSH Chief') }, ChiefIcon),
          ),
        'dsh-chief: sidebar entry',
      )

      ctx.effect(() => {
        const onDown = event => {
          if (!store.open) return
          const target = event.target
          if (runtimeRefs.panelEl && target && runtimeRefs.panelEl.contains(target)) return
          if (target && typeof target.closest === 'function' && target.closest('.dnb-btn')) return
          patch({ open: false })
        }
        const onKey = event => {
          if (String(event.key) === 'Escape' && store.open) patch({ open: false })
        }
        document.addEventListener('pointerdown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('pointerdown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
          runtimeRefs.panelEl = null
        }
      }, 'dsh-chief: dismiss on outside click')

      ctx.effect(
        () =>
          ctx.slots.inject('conversation.input.right', () =>
            ctx.slots.register(
              { name: 'conversation.input.right', id: 'chief-composer-entry', order: 20, locale: 'zh-CN' },
              ComposerEntry,
            ),
          ),
        'dsh-chief: composer entry',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register({ name: 'shell.overlay', id: 'corner-chief-panel', order: 40 }, Panel),
          ),
        'dsh-chief: floating panel',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register({ name: 'shell.overlay', id: 'corner-chief-trigger', order: 30 }, CornerTrigger),
          ),
        'dsh-chief: corner trigger',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('conversation.session.header.utilities', () =>
            ctx.slots.register(
              { name: 'conversation.session.header.utilities', id: 'corner-chief-session-probe', order: 99 },
              SessionProbe,
            ),
          ),
        'dsh-chief: session probe',
      )
    },
  }
}
