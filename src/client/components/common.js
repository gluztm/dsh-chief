/**
 * components/common.js
 *
 * Shared primitives: Icon, ChiefErrorBoundary, Switch, SearchDrawer, badges, fleet bars, and structured narrative renderer.
 */

import { React, h } from '../react-runtime.js'
import { STATUSES, STATUS_LABEL, STATUS_BADGE, SIX_GOAL_ROWS_META, THINKING_EFFORT_OPTIONS, DEFAULT_UI_SKIN } from '../constants.js'
import { bi, statusBadge, effortMeta } from '../i18n.js'
import { store, patch } from '../store.js'
import {
  submitChiefBar,
  loadArchives,
  loadArchiveDetail,
  searchColdArchives,
  refresh,
  searchBoard,
} from '../api.js'

export function Icon({ name, size = 14, style, filled = false }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    style: { display: 'inline-block', verticalAlign: '-2px', flexShrink: 0, ...style },
  }
  switch (name) {
    case 'star':
      return h('svg', props,
        h('polygon', {
          points: '12 2.4 15.05 8.58 21.88 9.57 16.94 14.39 18.1 21.2 12 17.98 5.9 21.2 7.06 14.39 2.12 9.57 8.95 8.58 12 2.4',
          fill: filled ? 'currentColor' : 'none',
          stroke: 'currentColor',
          strokeWidth: filled ? 1.5 : 1.85,
        }),
      )
    case 'brain':
      return h('svg', props,
        h('path', { d: 'M9.5 4.5a3.5 3.5 0 0 0-3.4 4.3A3.4 3.4 0 0 0 4 12a3.5 3.5 0 0 0 1.8 3.1A3.4 3.4 0 0 0 9 19.5c1.3 0 2.5-.6 3-1.5.5.9 1.7 1.5 3 1.5a3.4 3.4 0 0 0 3.2-4.4A3.5 3.5 0 0 0 20 12a3.4 3.4 0 0 0-2.1-3.2 3.5 3.5 0 0 0-3.4-4.3c-1.1 0-2.1.5-2.5 1.3-.4-.8-1.4-1.3-2.5-1.3z' }),
        h('path', { d: 'M12 5.8v12.2M8.5 9.2c.8.3 1.4 1 1.4 1.9M15.5 9.2c-.8.3-1.4 1-1.4 1.9M8.8 14.5c.7-.3 1.1-.8 1.2-1.4M15.2 14.5c-.7-.3-1.1-.8-1.2-1.4' }),
      )
    case 'search':
      return h('svg', props, h('circle', { cx: 11, cy: 11, r: 7 }), h('path', { d: 'm20 20-3.5-3.5' }))
    case 'refresh':
      return h('svg', props, h('path', { d: 'M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4' }), h('path', { d: 'M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4' }))
    case 'plus':
      return h('svg', props, h('path', { d: 'M12 5v14M5 12h14' }))
    case 'x':
      return h('svg', props, h('path', { d: 'M18 6 6 18M6 6l12 12' }))
    case 'check':
      return h('svg', props, h('path', { d: 'm5 12 5 5L20 7' }))
    case 'sparkles':
      return h('svg', props,
        h('path', { d: 'M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z' }),
        h('path', { d: 'M19 16l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z' }),
      )
    case 'network':
      return h('svg', props,
        h('rect', { x: 9, y: 3, width: 6, height: 5, rx: 1.5 }),
        h('rect', { x: 3, y: 16, width: 6, height: 5, rx: 1.5 }),
        h('rect', { x: 15, y: 16, width: 6, height: 5, rx: 1.5 }),
        h('path', { d: 'M12 8v4m0 0H6v4m6-4h6v4' }),
      )
    case 'list':
      return h('svg', props, h('path', { d: 'M9 6h11M9 12h11M9 18h11M5 6h.01M5 12h.01M5 18h.01' }))
    case 'play':
      return h('svg', props, h('polygon', { points: '6 4 20 12 6 20 6 4' }))
    case 'stop':
      return h('svg', props, h('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }))
    case 'send':
      return h('svg', props, h('path', { d: 'M22 2 11 13' }), h('polygon', { points: '22 2 15 22 11 13 2 9 22 2' }))
    case 'chat':
      return h('svg', props, h('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }))
    case 'sliders':
      return h('svg', props, h('path', { d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' }))
    case 'trash':
      return h('svg', props, h('path', { d: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12z' }))
    case 'edit':
      return h('svg', props, h('path', { d: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z' }))
    case 'copy':
      return h('svg', props, h('rect', { x: 9, y: 9, width: 12, height: 12, rx: 2 }), h('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }))
    case 'pin':
      return h('svg', props, h('path', { d: 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1z' }))
    case 'pinStamp':
      return h('svg', props,
        h('g', { transform: 'rotate(34 12 12)' },
          h('path', {
            d: 'M9 4h6l-.6 5.2 2.4 2.2v1.6H7.2v-1.6l2.4-2.2L9 4z',
            fill: 'currentColor',
            fillOpacity: 0.28,
          }),
          h('path', { d: 'M8 4h8M9.3 4l-.5 5.1L6.6 11.3V13h10.8v-1.7l-2.2-2.2L14.7 4M12 13v7.5' }),
        ),
      )
    case 'chevron':
      return h('svg', props, h('path', { d: 'm9 18 6-6-6-6' }))
    case 'arrowUp':
      return h('svg', props, h('path', { d: 'M12 19V5' }), h('path', { d: 'm6 11 6-6 6 6' }))
    case 'link':
      return h('svg', props, h('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }), h('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }))
    case 'mail':
      return h('svg', props, h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2.5 }), h('path', { d: 'm3 7 9 6 9-6' }))
    case 'bolt':
      return h('svg', props, h('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' }))
    case 'target':
      return h('svg', props,
        h('circle', { cx: 12, cy: 12, r: 7.5 }),
        h('circle', { cx: 12, cy: 12, r: 2.5 }),
        h('path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3' }),
      )
    case 'alert':
      return h('svg', props,
        h('path', { d: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' }),
        h('path', { d: 'M12 9v4M12 17h.01' }),
      )
    case 'folder':
      return h('svg', props,
        h('path', { d: 'M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.5.7L12.2 7H19a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z' }),
      )
    case 'folderOpen':
      return h('svg', props,
        h('path', { d: 'M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.5.7L12.2 7H19a2 2 0 0 1 2 2v1.5' }),
        h('path', { d: 'M3 10.5h16.6a1.5 1.5 0 0 1 1.4 1.9l-1.5 6A2 2 0 0 1 17.6 20H5a2 2 0 0 1-2-2V10.5z' }),
      )
    case 'paperclip':
      return h('svg', props,
        h('path', { d: 'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48' }),
      )
    case 'image':
      return h('svg', props,
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2.5 }),
        h('circle', { cx: 8.5, cy: 9.5, r: 1.5 }),
        h('path', { d: 'm21 15-4.8-4.8a1.5 1.5 0 0 0-2.1 0L6 18.3' }),
      )
    case 'archive':
      return h('svg', props,
        h('rect', { x: 3, y: 4, width: 18, height: 5, rx: 1.5 }),
        h('path', { d: 'M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9' }),
        h('path', { d: 'M10 13h4' }),
      )
    case 'trayOut':
      return h('svg', props,
        h('path', { d: 'M12 15V4' }),
        h('path', { d: 'm8 8 4-4 4 4' }),
        h('path', { d: 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' }),
      )
    case 'trayIn':
      return h('svg', props,
        h('path', { d: 'M12 4v11' }),
        h('path', { d: 'm8 11 4 4 4-4' }),
        h('path', { d: 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' }),
      )
    case 'shieldSentinel':
      return h('svg', props,
        h('path', {
          d: 'M12 2.8 4.6 5.9v5.6c0 4.9 3.2 9.1 7.4 10.7 4.2-1.6 7.4-5.8 7.4-10.7V5.9L12 2.8z',
          fill: 'currentColor',
          fillOpacity: 0.24,
        }),
        h('path', { d: 'M12 7.5v8.2M8.8 11.4h6.4' }),
      )
    case 'agentLead':
      return h('svg', props,
        h('rect', { x: 4, y: 5, width: 16, height: 14, rx: 4, fill: 'currentColor', fillOpacity: 0.14 }),
        h('circle', { cx: 9.2, cy: 11.5, r: 1.1, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 14.8, cy: 11.5, r: 1.1, fill: 'currentColor', stroke: 'none' }),
        h('path', { d: 'M9 15h6M12 2v3' }),
      )
    case 'agentSub':
      return h('svg', props,
        h('circle', { cx: 7, cy: 6.5, r: 2.3 }),
        h('circle', { cx: 17, cy: 17.5, r: 2.3, fill: 'currentColor', fillOpacity: 0.16 }),
        h('path', { d: 'M7 8.8v3.7a4 4 0 0 0 4 4h3.7' }),
        h('circle', { cx: 17, cy: 7.5, r: 1.8 }),
        h('path', { d: 'M7 11.5h6.2a2 2 0 0 0 2-2V9.3' }),
      )
    case 'settings':
      return h('svg', props,
        h('circle', { cx: 12, cy: 12, r: 3 }),
        h('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }),
      )
    case 'maximize':
      return h('svg', props,
        h('path', { d: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' }),
      )
    case 'sidebarRight':
      return h('svg', props,
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2.5 }),
        h('path', { d: 'M14 4v16' }),
      )
    case 'clock':
      return h('svg', props,
        h('circle', { cx: 12, cy: 12, r: 9 }),
        h('path', { d: 'M12 7v5l3 2' }),
      )
    case 'compass':
      return h('svg', props,
        h('circle', { cx: 12, cy: 12, r: 9 }),
        h('polygon', { points: '15.8 8.2 13.7 13.7 8.2 15.8 10.3 10.3 15.8 8.2' }),
      )
    case 'heartPulse':
      return h('svg', props,
        h('path', { d: 'M19.5 12.6C21 10.9 21 8.1 19.2 6.5a4.2 4.2 0 0 0-5.8.2L12 8.1l-1.4-1.4a4.2 4.2 0 0 0-5.8-.2C3 8.1 3 10.9 4.5 12.6L12 20l7.5-7.4z' }),
        h('path', { d: 'M7.5 12.5h2l1.2-2.2 1.8 4 1.3-1.8h2.2' }),
      )
    case 'download':
      return h('svg', props,
        h('path', { d: 'M12 3v12M7.5 10.5 12 15l4.5-4.5M4 18.5v1a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-1' }),
      )
    case 'upload':
      return h('svg', props,
        h('path', { d: 'M12 15V3M7.5 7.5 12 3l4.5 4.5M4 18.5v1a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-1' }),
      )
    case 'fileText':
      return h('svg', props,
        h('path', { d: 'M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z' }),
        h('path', { d: 'M14 2.5V8h5.5M8.5 12.5h7M8.5 16h5' }),
      )
    case 'user':
      return h('svg', props,
        h('circle', { cx: 12, cy: 8, r: 4 }),
        h('path', { d: 'M4.5 20a7.5 7.5 0 0 1 15 0' }),
      )
    case 'heart':
      return h('svg', props,
        h('path', { d: 'M19.5 12.5C21 10.8 21 8 19.2 6.4a4.2 4.2 0 0 0-5.8.2L12 8l-1.4-1.4a4.2 4.2 0 0 0-5.8-.2C3 8 3 10.8 4.5 12.5L12 20l7.5-7.5z' }),
      )
    case 'alertTriangle':
      return h('svg', props,
        h('path', { d: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' }),
        h('path', { d: 'M12 9v4M12 17h.01' }),
      )
    case 'layers':
      return h('svg', props,
        h('polygon', { points: '12 3 2 8.5 12 14 22 8.5 12 3' }),
        h('path', { d: 'M2 12.5 12 18l10-5.5M2 16.5 12 22l10-5.5' }),
      )
    case 'checkCircle':
      return h('svg', props,
        h('circle', { cx: 12, cy: 12, r: 9 }),
        h('path', { d: 'm8.5 12.2 2.4 2.4 4.6-4.8' }),
      )
    case 'palette':
      return h('svg', props,
        h('path', { d: 'M12 2.8a9.2 9.2 0 1 0 0 18.4c1.3 0 2-.9 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.4-.9 0-1.4.4-.5 1-.7 1.7-.7h2.1A4.7 4.7 0 0 0 22 11.3 8.8 8.8 0 0 0 12 2.8z' }),
        h('circle', { cx: 8.2, cy: 10.2, r: 1, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 11.8, cy: 7.6, r: 1, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 15.6, cy: 9.8, r: 1, fill: 'currentColor', stroke: 'none' }),
      )
    case 'sliders':
      return h('svg', props,
        h('path', { d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' }),
      )
    case 'zap':
      return h('svg', props,
        h('polygon', { points: '13 2 4 14 12 14 11 22 20 10 12 10 13 2' }),
      )
    case 'alignLeft':
      return h('svg', props,
        h('path', { d: 'M4 6h16M4 11h11M4 16h16M4 21h9' }),
      )
    case 'listChecks':
      return h('svg', props,
        h('path', { d: 'M3.5 6.5 5 8l3-3M3.5 12.5 5 14l3-3M3.5 18.5 5 20l3-3M11 6.5h9M11 12.5h9M11 18.5h9' }),
      )
    case 'shieldCheck':
      return h('svg', props,
        h('path', { d: 'M12 2.8 4.8 5.8v5.5c0 4.8 3 8.9 7.2 10.5 4.2-1.6 7.2-5.7 7.2-10.5V5.8L12 2.8z' }),
        h('path', { d: 'm9 12.2 2.1 2.1 4.1-4.3' }),
      )
    case 'shieldOff':
      return h('svg', props,
        h('path', { d: 'M19.2 11.3V5.8L12 2.8 8.3 4.3M4.8 5.8v5.5c0 4.8 3 8.9 7.2 10.5 2-.8 3.8-2.2 5-4M3 3l18 18' }),
      )
    case 'globe':
      return h('svg', props,
        h('circle', { cx: 12, cy: 12, r: 9 }),
        h('path', { d: 'M3.5 12h17M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18' }),
      )
    case 'folder':
      return h('svg', props,
        h('path', { d: 'M3 6.5A2 2 0 0 1 5 4.5h4.2l2 2.2H19a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5z' }),
      )
    case 'pause':
      return h('svg', props,
        h('rect', { x: 6, y: 5, width: 4, height: 14, rx: 1.2 }),
        h('rect', { x: 14, y: 5, width: 4, height: 14, rx: 1.2 }),
      )
    case 'play':
      return h('svg', props,
        h('polygon', { points: '6 4.5 19 12 6 19.5 6 4.5' }),
      )
    case 'lock':
      return h('svg', props,
        h('rect', { x: 4.5, y: 11, width: 15, height: 9.5, rx: 2 }),
        h('path', { d: 'M8 11V7.5a4 4 0 0 1 8 0V11' }),
      )
    case 'workflow':
      return h('svg', props,
        h('rect', { x: 3, y: 4, width: 6.5, height: 5.5, rx: 1.4 }),
        h('rect', { x: 14.5, y: 14.5, width: 6.5, height: 5.5, rx: 1.4 }),
        h('path', { d: 'M9.5 6.8h3a2.5 2.5 0 0 1 2.5 2.5v2.2M15 11.5h2.7v3' }),
        h('path', { d: 'M6.2 9.5v4.8a2.5 2.5 0 0 0 2.5 2.5h5.8' }),
      )
    default:
      return null
  }
}

/* ---------------------------------------------------- Error Boundary */

export class ChiefErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('dsh-chief view boundary caught error:', error, info)
  }
  render() {
    if (this.state.error) {
      return h(
        'div',
        { className: 'dnb-group', style: { padding: 16, textAlign: 'center', marginTop: 12 } },
        h('div', { style: { fontWeight: 500, fontSize: 13, marginBottom: 6 } }, '面板加载出了点问题'),
        h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', marginBottom: 12, wordBreak: 'break-word' } },
          String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)),
        h('button', {
          className: 'dnb-primary-btn',
          onClick: () => {
            this.setState({ error: null })
            void refresh()
          },
        }, '重新加载'),
      )
    }
    return this.props.children
  }
}

/* ----------------------------------------------------- iOS Micro-Flat CSS */

export function Switch({ checked, onChange, disabled = false, title = '', small = false, tone = '' }) {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      disabled: Boolean(disabled),
      'aria-checked': checked ? 'true' : 'false',
      'aria-disabled': disabled ? 'true' : 'false',
      'data-disabled': disabled ? '1' : '0',
      'data-tone': tone || undefined,
      title: title || undefined,
      className: 'dnb-switch',
      'data-on': checked ? '1' : '0',
      style: small ? { transform: 'scale(0.82)', transformOrigin: 'center' } : undefined,
      onClick: () => {
        if (disabled) return
        onChange(!checked)
      },
    },
    h('span', { className: 'dnb-switch-thumb' }),
  )
}

export function SearchDrawer({ view }) {
  if (!view.searchOpen) return null
  const run = () => {
    const text = (view.askText || '').trim()
    if (!text) return
    const hits = searchBoard(text)
    patch({ askHits: hits, askNote: '' })
  }
  const askModel = () => {
    const text = (view.askText || '').trim()
    if (!text) return
    patch({ secInput: text, secTarget: 'auto', searchOpen: false, askHits: null })
    void submitChiefBar()
  }

  return h(
    'div',
    { style: { padding: '0 12px 8px', flexShrink: 0 }, className: 'dnb-view' },
    h(
      'div',
      { style: { display: 'flex', gap: 6, alignItems: 'center' } },
      h('input', {
        className: 'dnb-input',
        style: { borderRadius: 99, paddingLeft: 12, height: 30 },
        placeholder: bi('搜记忆、任务或协同消息…', 'Search memory, tasks, or messages…'),
        autoFocus: true,
        value: view.askText || '',
        onChange: e => {
          const val = e.target.value
          patch({ askText: val, askHits: val.trim() ? searchBoard(val) : null })
        },
        onKeyDown: e => {
          if (e.key === 'Enter') run()
          if (e.key === 'Escape') patch({ searchOpen: false, askHits: null })
        },
      }),
      (view.askText || '').trim()
        ? h('button', {
            className: 'dnb-pill',
            style: { height: 30 },
            disabled: view.archiveSearchBusy,
            onClick: () => void searchColdArchives(view.askText),
            title: bi('搜一搜收起来的长期历史档案', 'Search archived history files on demand'),
          }, h(Icon, { name: 'archive', size: 12 }), view.archiveSearchBusy ? bi('搜索中…', 'Searching…') : bi('搜旧档案', 'Archives'))
        : null,
      (view.askText || '').trim()
        ? h('button', {
            className: 'dnb-pill dnb-pill-accent',
            style: { height: 30 },
            onClick: askModel,
            title: bi('直接发给参谋长来回答或安排', 'Send directly to DSH Chief to answer or handle'),
          }, h(Icon, { name: 'sparkles', size: 12 }), bi('问参谋长', 'Ask Chief'))
        : null,
    ),
    Array.isArray(view.askHits)
      ? h(
          'div',
          { className: 'dnb-group', style: { marginTop: 6, marginBottom: 0, maxHeight: 180, overflow: 'auto' } },
          view.askHits.length
            ? view.askHits.map((item, idx) =>
                h(
                  'div',
                  {
                    key: item.id + '-' + idx,
                    className: 'dnb-cell dnb-cell-hover',
                    style: { cursor: 'pointer', padding: '7px 12px' },
                    onClick: () => {
                      const nextPatch = { tab: item.tab || 'chief', searchOpen: false }
                      if (item.tab === 'tasks') nextPatch.selectedTaskId = item.id
                      if (item.tab === 'archive' && item.archiveId) {
                        nextPatch.archiveOpenFolders = { ...(store.archiveOpenFolders || {}), ...(item.folderId ? { [item.folderId]: true } : {}) }
                        nextPatch.archiveOpenFiles = { ...(store.archiveOpenFiles || {}), [item.archiveId]: true }
                        patch(nextPatch)
                        void loadArchives(false)
                        void loadArchiveDetail(item.archiveId, false)
                        return
                      }
                      patch(nextPatch)
                    },
                  },
                  h('span', { className: 'dnb-tag', style: { color: 'var(--dnb-accent)' } }, item.kind),
                  h('div', { style: { flex: 1, minWidth: 0 } },
                    h('div', { style: { fontWeight: 500, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title),
                    item.snippet ? h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.snippet) : null,
                  ),
                ),
              )
            : h('div', { style: { padding: '10px 12px', fontSize: 11.5, color: 'var(--dnb-text-3)', textAlign: 'center' } }, bi('没找到相关内容', 'No matches found')),
        )
      : null,
  )
}

/* ----------------------------- Status Badge & Objective Radar Strip */

export function StatusBadge({ status, style }) {
  const st = STATUSES.includes(status) ? status : 'todo'
  return h(
    'span',
    { className: 'dnb-status-badge', 'data-status': st, style },
    st === 'doing'
      ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '9.5px', color: '#409cff' } })
      : null,
    statusBadge(st) || STATUS_BADGE[st] || STATUS_LABEL[st],
  )
}


/* ----------------------------------------------- Bottom Sheet Inspector */

function stripLeadingEmoji(label) {
  const s = String(label || '').trim()
  if (!s) return ''
  const cleaned = s.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\u2600-\u27BF\s]+/u, '').trim()
  return cleaned || s
}

export function isBenignQuietStatusText(rawBody) {
  const text = String(rawBody || '').trim()
  if (!text) return true
  if (/(?:能否继续[\s\S]*以实际[\s\S]*为准|以实际执行结果为准|以实际结果为准|以实测为准|待实测验证|此前受拦[\s\S]*以实际[\s\S]*为准)/.test(text)) {
    return true
  }
  if (/(?:暂未解决|暂无法|尚未解决|尚未解除|仍受阻|依然受阻|权限受限|请确认是否|需要您提供|需要你提供|需您确认|需你确认|等待您|等待你|报错|失败|卡住|死锁|待批|尚未通过)/.test(text)) {
    return false
  }
  if (/(?:^(?:无|暂无|没有|无需|不需要|暂无需|暂不需要|目前无|当前无|目前暂无|当前暂无|暂无明确|无明确|暂无已知|无已知)|暂无需(?:您|你)?(?:额外)?提供|无需(?:您|你)?(?:额外)?提供|暂无(?:明确|已知)?(?:技术)?(?:受阻|阻塞|卡点)|阻塞已解除|无受阻|无阻塞|可继续推进)/.test(text)) {
    return true
  }
  return false
}

function classifyBulletTagTone(tag, body = '') {
  const t = String(tag || '')
  if (
    /禁止|红线|受阻|卡点|错误|失败|撞墙|高危|违规|严禁|崩溃|死锁/.test(t)
    || (/风险|告警|异常/.test(t) && !/保障|兜底|已解|可控|无风险|解除/.test(t))
  ) {
    return { tone: isBenignQuietStatusText(body) ? 'muted' : 'coral' }
  }
  if (/参谋长建议|参谋建议|建议/.test(t)) {
    return { tone: 'accent' }
  }
  if (/用户需要提供|需用户提供|需你提供|需您提供|需你确认|需您确认/.test(t)) {
    return { tone: isBenignQuietStatusText(body) ? 'muted' : 'amber' }
  }
  if (/注意|提醒|警告|警惕|纪律|顺序|验收|待验|核对|约束|谨慎/.test(t)) {
    return { tone: 'amber' }
  }
  return { tone: 'muted' }
}

function classifySectionHeadingTone(heading) {
  const s = String(heading || '')
  const hasWarn = /纪律|边界|注意|提醒|警告|风险|约束|验收|待验/.test(s)
  const hasRed = /禁止|红线|受阻|阻塞|错误|告警|故障/.test(s)
  if (hasWarn && hasRed) {
    return { fg: 'var(--dnb-coral, #f28b88)', bar: 'var(--dnb-coral, #f28b88)' }
  }
  if (hasRed) {
    return { fg: 'var(--dnb-coral, #f28b88)', bar: 'var(--dnb-coral, #f28b88)' }
  }
  if (hasWarn) {
    return { fg: 'var(--dnb-amber, #f3be6d)', bar: 'var(--dnb-amber, #f3be6d)' }
  }
  if (/已完成|达成|放行|收口/.test(s)) {
    return { fg: 'var(--dnb-sage, #63d1b0)', bar: 'var(--dnb-sage, #63d1b0)' }
  }
  if (/待办|未完成|遗留|后续/.test(s)) {
    return { fg: 'var(--dnb-text-3)', bar: 'var(--dnb-border-strong)' }
  }
  return { fg: 'var(--dnb-text-2)', bar: 'var(--dnb-accent)' }
}

export function renderStructuredHeading(heading, compact) {
  if (!heading) return null
  const tone = classifySectionHeadingTone(heading)
  return h(
    'div',
    { className: compact ? 'dnb-struct-head is-compact' : 'dnb-struct-head', style: { color: tone.fg } },
    h('span', { className: 'dnb-struct-bar', style: { background: tone.bar } }),
    h('span', null, heading),
  )
}

function splitTaggedBullet(rawLine) {
  const clean = String(rawLine || '')
    .replace(/\[dsh-mnemon:[^\]]*\][\s\S]*/gi, '')
    .replace(/^[-*•]\s+/, '')
    .replace(/^\d+[.)、]\s+/, '')
    .trim()
  if (!clean) return null
  const m = clean.match(/^【([^】]{1,12})】\s*(.*)$/)
  if (m) {
    return { badge: m[1].trim(), body: m[2].trim() || m[1].trim() }
  }
  return { badge: '', body: clean }
}

export function parseNarrativeBlocks(raw) {
  const text = String(raw || '').trim()
  if (!text) return []
  const lines = text.split(/\r?\n/)
  const blocks = []
  let current = null

  const ensureBlock = () => {
    if (!current) current = { heading: '', items: [] }
    return current
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^\[dsh-mnemon:/i.test(line)) continue
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/)
    if (headingMatch) {
      if (current && (current.heading || current.items.length)) blocks.push(current)
      current = { heading: headingMatch[1].trim(), items: [] }
      continue
    }
    if (/^(?:[-*•]|\d+[.)、])\s+/.test(line) || /^【[^】]{1,12}】/.test(line)) {
      const parsed = splitTaggedBullet(line)
      if (parsed) ensureBlock().items.push({ kind: 'bullet', ...parsed })
    } else {
      const cleanedPara = line
        .replace(/\[dsh-mnemon:[^\]]*\][\s\S]*/gi, '')
        .trim()
      if (!cleanedPara) continue
      ensureBlock().items.push({ kind: 'para', body: cleanedPara })
    }
  }
  if (current && (current.heading || current.items.length)) blocks.push(current)
  return blocks
}

export function renderStructuredItem(item, key) {
  if (!item) return null
  if (item.kind === 'bullet') {
    if (item.badge) {
      const cleanBadge = stripLeadingEmoji(item.badge)
      const tone = classifyBulletTagTone(cleanBadge, item.body)
      return h(
        'div',
        { key, className: 'dnb-prose-kv-row', 'data-tone': tone.tone },
        h('span', { className: 'dnb-prose-kv-key' }, cleanBadge),
        h('span', { className: 'dnb-prose-kv-val' }, item.body),
      )
    }
    return h(
      'div',
      {
        key,
        style: {
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          padding: '2.5px 0',
          fontSize: 12.2,
          lineHeight: 1.58,
          color: 'var(--dnb-text-2)',
        },
      },
      h('span', {
        style: {
          width: 4.5,
          height: 4.5,
          borderRadius: '50%',
          background: 'var(--dnb-text-3)',
          opacity: 0.72,
          flexShrink: 0,
          marginTop: 7.5,
        },
      }),
      h('span', { style: { flex: 1, minWidth: 0, wordBreak: 'break-word' } }, item.body),
    )
  }
  return h('p', { key, className: 'dnb-prose-p' }, item.body)
}

export function renderStructuredText(rawText) {
  const blocks = parseNarrativeBlocks(rawText)
  if (!blocks.length) {
    return h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, String(rawText || ''))
  }
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
    blocks.map((blk, bi) =>
      h(
        'div',
        { key: bi, style: { marginTop: bi === 0 ? 0 : 6 } },
        blk.heading ? renderStructuredHeading(blk.heading, true) : null,
        blk.items.map((it, ii) => renderStructuredItem(it, `${bi}-${ii}`)),
      ),
    ),
  )
}

export function parseSixGoalBrief(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  const rowsByKey = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const clean = rawLine.trim().replace(/^(?:[-*•]\s+)/, '')
    const m = clean.match(/^【([^】]{2,18})】\s*[：:]?\s*(.+)$/)
    if (!m) continue
    const tag = m[1].trim().replace(/^[^\u4e00-\u9fa5A-Za-z]+/, '').trim()
    const body = m[2].trim()
    const def = SIX_GOAL_ROWS_META.find(r => r.aliases.includes(tag))
    if (def && body && !rowsByKey[def.key]) {
      rowsByKey[def.key] = { ...def, body }
    }
  }
  const matched = SIX_GOAL_ROWS_META.filter(r => rowsByKey[r.key]).map(r => rowsByKey[r.key])
  return matched.length >= 2 ? matched : null
}

export function extractReplySummaryLine(rawText) {
  const raw = String(rawText || '').trim()
  if (!raw) return ''
  const six = parseSixGoalBrief(raw)
  if (six && six.length) {
    const blocked = six.find(r => r.role === 'blocked')
    const hasHardBlocker = Boolean(
      blocked
      && blocked.body
      && /(?:报错|失败|权限受限|卡住|死锁|无法继续|拒绝|被拦|待确认|需确认|待批|中断|超时)/.test(blocked.body)
      && !/以实际[\s\S]*为准/.test(blocked.body)
      && !isBenignQuietStatusText(blocked.body),
    )
    if (hasHardBlocker) {
      return `受阻：${blocked.body}`
    }
    const preferred = six.find(r => r.role === 'progress')
      || six.find(r => r.role === 'advice')
      || six.find(r => r.role === 'goal')
      || six[0]
    if (preferred && preferred.body) return preferred.body
  }
  const blocks = parseNarrativeBlocks(raw)
  for (const blk of blocks) {
    for (const it of (blk.items || [])) {
      const body = String(it && it.body ? it.body : '').trim()
      if (!body) continue
      if (it.kind === 'bullet' && it.badge) {
        const cleanBadge = stripLeadingEmoji(it.badge)
        if (cleanBadge && cleanBadge !== body && !body.startsWith(cleanBadge) && body.length < 24) {
          return `${cleanBadge} · ${body}`
        }
      }
      return body
    }
  }
  const fallback = raw
    .replace(/\[dsh-mnemon:[^\]]*\][\s\S]*/gi, '')
    .split(/\r?\n/)
    .map(l => l.trim().replace(/^#{1,3}\s+/, '').replace(/^(?:[-*•]|\d+[.)、])\s+/, '').replace(/^【[^】]{1,14}】\s*/, '').trim())
    .find(Boolean)
  return fallback || raw
}

export function orderChatHistoryNewestFirst(rawList) {
  const items = Array.isArray(rawList) ? rawList.filter(Boolean) : []
  const groups = []
  for (let i = 0; i < items.length; i += 1) {
    const cur = items[i]
    const next = items[i + 1]
    if (cur && cur.role === 'user' && next && next.role === 'chief') {
      groups.push([cur, next])
      i += 1
    } else {
      groups.push([cur])
    }
  }
  groups.reverse()
  return groups.flat()
}

export function groupChatHistoryTurnsNewestFirst(rawList) {
  const items = Array.isArray(rawList) ? rawList.filter(Boolean) : []
  const turns = []
  let activeTurn = null
  let activeSys = null
  for (const item of items) {
    if (item.role === 'user') {
      activeSys = null
      activeTurn = {
        id: 'turn-' + (item.id || turns.length),
        kind: 'turn',
        question: item,
        replies: [],
        at: item.at || 0,
      }
      turns.push(activeTurn)
    } else if (activeTurn) {
      activeTurn.replies.push(item)
    } else {
      if (!activeSys) {
        activeSys = {
          id: 'sys-' + (item.id || turns.length),
          kind: 'system',
          question: null,
          replies: [],
          at: item.at || 0,
        }
        turns.push(activeSys)
      }
      activeSys.replies.push(item)
    }
  }
  turns.reverse()
  return turns
}

/* ------------------------------------------- Interactive Fan Thinking Gauge (Skin-Harmonized) */

const FAN_EFFORT_STEPS = [
  { key: 'off', label: '关', deg: -180, color: 'var(--dnb-text-3, #94a3b8)' },
  { key: 'low', label: '低', deg: -135, color: 'var(--dnb-sage, #63d1b0)' },
  { key: 'medium', label: '中', deg: -90, color: 'var(--dnb-accent, #9f8eff)' },
  { key: 'high', label: '高', deg: -45, color: 'var(--dnb-amber, #f3be6d)' },
  { key: 'xhigh', label: '极高', deg: 0, color: 'var(--dnb-coral, #f28b88)' },
]

function fanPolarPoint(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function fanDescribeArc(cx, cy, r, startDeg, endDeg) {
  if (Math.abs(endDeg - startDeg) < 0.2) return ''
  const p0 = fanPolarPoint(cx, cy, r, startDeg)
  const p1 = fanPolarPoint(cx, cy, r, endDeg)
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`
}

function fanDescribeWedge(cx, cy, rInner, rOuter, startDeg, endDeg) {
  const o0 = fanPolarPoint(cx, cy, rOuter, startDeg)
  const o1 = fanPolarPoint(cx, cy, rOuter, endDeg)
  const i1 = fanPolarPoint(cx, cy, rInner, endDeg)
  const i0 = fanPolarPoint(cx, cy, rInner, startDeg)
  return `M ${o0.x.toFixed(2)} ${o0.y.toFixed(2)} A ${rOuter} ${rOuter} 0 0 1 ${o1.x.toFixed(2)} ${o1.y.toFixed(2)} L ${i1.x.toFixed(2)} ${i1.y.toFixed(2)} A ${rInner} ${rInner} 0 0 0 ${i0.x.toFixed(2)} ${i0.y.toFixed(2)} Z`
}

function fanAngleToStep(deg) {
  let best = FAN_EFFORT_STEPS[0]
  let bestDist = Infinity
  for (const step of FAN_EFFORT_STEPS) {
    const d = Math.abs(deg - step.deg)
    if (d < bestDist) {
      bestDist = d
      best = step
    }
  }
  return best
}

export function EffortFanGauge({ value = 'auto', onChange, compact = false, skin }) {
  const svgRef = React.useRef(null)
  const gradIdRef = React.useRef('dnb-fan-grad-' + Math.random().toString(36).slice(2, 8))
  const [dragging, setDragging] = React.useState(false)
  const [dragAngle, setDragAngle] = React.useState(null)
  const [hoverKey, setHoverKey] = React.useState('')

  const activeSkin = skin || store.uiSkin || DEFAULT_UI_SKIN
  const committedKey = THINKING_EFFORT_OPTIONS.some(o => o.key === value) ? value : 'auto'
  const isAuto = committedKey === 'auto'
  const committedStep = FAN_EFFORT_STEPS.find(s => s.key === committedKey) || null

  const activeAngle = dragging && dragAngle !== null
    ? dragAngle
    : (committedStep ? committedStep.deg : -90)
  const previewStep = dragging && dragAngle !== null ? fanAngleToStep(dragAngle) : committedStep
  const showManualNeedle = !isAuto || dragging

  const cx = 110
  const cy = 98
  const rTrack = 68
  const needleRotateDeg = activeAngle + 90
  const knobPt = fanPolarPoint(cx, cy, rTrack, activeAngle)

  const pointerToAngle = (clientX, clientY) => {
    const el = svgRef.current
    if (!el) return -90
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return -90
    const sx = ((clientX - rect.left) / rect.width) * 220
    const sy = ((clientY - rect.top) / rect.height) * 116
    let deg = (Math.atan2(sy - cy, sx - cx) * 180) / Math.PI
    if (deg > 90) deg = -180
    else if (deg > 0) deg = 0
    return Math.max(-180, Math.min(0, deg))
  }

  const commitKey = (nextKey) => {
    if (typeof onChange === 'function' && nextKey && nextKey !== committedKey) {
      onChange(nextKey)
    }
  }

  const handlePointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return
    e.stopPropagation()
    const ang = pointerToAngle(e.clientX, e.clientY)
    setDragging(true)
    setDragAngle(ang)
    try {
      if (e.currentTarget && typeof e.currentTarget.setPointerCapture === 'function') {
        e.currentTarget.setPointerCapture(e.pointerId)
      }
    } catch {}
  }

  const handlePointerMove = (e) => {
    if (!dragging) return
    e.stopPropagation()
    setDragAngle(pointerToAngle(e.clientX, e.clientY))
  }

  const handlePointerUp = (e) => {
    if (!dragging) return
    e.stopPropagation()
    const ang = pointerToAngle(e.clientX, e.clientY)
    const snapped = fanAngleToStep(ang)
    setDragging(false)
    setDragAngle(null)
    try {
      if (e.currentTarget && typeof e.currentTarget.releasePointerCapture === 'function') {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    } catch {}
    if (snapped && typeof onChange === 'function') {
      onChange(snapped.key)
    }
  }

  const handlePointerCancel = () => {
    if (!dragging) return
    setDragging(false)
    setDragAngle(null)
  }

  return h(
    'div',
    {
      className: 'dnb-fan-gauge',
      'data-compact': compact ? '1' : '0',
      'data-skin': activeSkin,
      onClick: e => e.stopPropagation(),
      onMouseLeave: () => setHoverKey(''),
    },
    h(
      'div',
      { className: 'dnb-fan-stage' },
      h(
        'svg',
        {
          ref: svgRef,
          className: 'dnb-fan-svg',
          'data-dragging': dragging ? '1' : '0',
          viewBox: '0 0 220 116',
          onPointerDown: handlePointerDown,
          onPointerMove: handlePointerMove,
          onPointerUp: handlePointerUp,
          onPointerCancel: handlePointerCancel,
        },
        h(
          'defs',
          null,
          h(
            'linearGradient',
            { id: gradIdRef.current, x1: '0%', y1: '50%', x2: '100%', y2: '50%' },
            h('stop', { offset: '0%', stopColor: 'var(--dnb-text-3, #94a3b8)' }),
            h('stop', { offset: '28%', stopColor: 'var(--dnb-sage, #63d1b0)' }),
            h('stop', { offset: '58%', stopColor: 'var(--dnb-accent, #9f8eff)' }),
            h('stop', { offset: '82%', stopColor: 'var(--dnb-amber, #f3be6d)' }),
            h('stop', { offset: '100%', stopColor: 'var(--dnb-coral, #f28b88)' }),
          ),
        ),
        // Calm neutral segmented track background across 5 notches
        FAN_EFFORT_STEPS.map((step, i) => {
          const prevDeg = i === 0 ? -180 : (FAN_EFFORT_STEPS[i - 1].deg + step.deg) / 2
          const nextDeg = i === FAN_EFFORT_STEPS.length - 1 ? 0 : (step.deg + FAN_EFFORT_STEPS[i + 1].deg) / 2
          const isLit = !isAuto && !dragging
            ? (committedStep && step.deg <= committedStep.deg)
            : (dragging && previewStep && step.deg <= previewStep.deg)
          return h('path', {
            key: 'seg-' + step.key,
            d: fanDescribeArc(cx, cy, rTrack, Math.max(-180, prevDeg + 1.5), Math.min(0, nextDeg - 1.5)),
            fill: 'none',
            stroke: 'var(--dnb-border-strong)',
            strokeWidth: isLit ? 8 : 7,
            strokeOpacity: isAuto ? 0.45 : (isLit ? 0.55 : 0.35),
            strokeLinecap: 'round',
          })
        }),
        // Continuous static gradient arc (full soft arc when auto, active slice when manual/dragging)
        !showManualNeedle
          ? h('path', {
              className: 'dnb-fan-arc-active',
              d: fanDescribeArc(cx, cy, rTrack, -180, 0),
              fill: 'none',
              stroke: `url(#${gradIdRef.current})`,
              strokeWidth: 7.5,
              strokeOpacity: 0.72,
              strokeLinecap: 'round',
            })
          : (activeAngle > -179.4
              ? h('path', {
                  className: 'dnb-fan-arc-active',
                  'data-dragging': dragging ? '1' : '0',
                  d: fanDescribeArc(cx, cy, rTrack, -180, activeAngle),
                  fill: 'none',
                  stroke: `url(#${gradIdRef.current})`,
                  strokeWidth: 8,
                  strokeLinecap: 'round',
                })
              : null),
        // Transparent interactive fan wedges for native title hover hints & click-to-snap
        FAN_EFFORT_STEPS.map((step, i) => {
          const wStart = i === 0 ? -180 : (FAN_EFFORT_STEPS[i - 1].deg + step.deg) / 2
          const wEnd = i === FAN_EFFORT_STEPS.length - 1 ? 0 : (step.deg + FAN_EFFORT_STEPS[i + 1].deg) / 2
          const opt = THINKING_EFFORT_OPTIONS.find(o => o.key === step.key) || {}
          return h(
            'path',
            {
              key: 'hit-' + step.key,
              d: fanDescribeWedge(cx, cy, 30, 96, wStart, wEnd),
              fill: hoverKey === step.key ? step.color : 'transparent',
              fillOpacity: hoverKey === step.key ? 0.10 : 0,
              style: { cursor: dragging ? 'grabbing' : 'pointer' },
              onMouseEnter: () => setHoverKey(step.key),
              onMouseLeave: () => setHoverKey(prev => (prev === step.key ? '' : prev)),
            },
            h('title', null, `${opt.label || step.label}：${opt.hint || ''}`),
          )
        }),
        // Tick dots + outer labels
        FAN_EFFORT_STEPS.map(step => {
          const pt = fanPolarPoint(cx, cy, rTrack, step.deg)
          const lpt = fanPolarPoint(cx, cy, rTrack + 17, step.deg)
          const isCur = !isAuto && (dragging ? (previewStep && previewStep.key === step.key) : committedKey === step.key)
          const isHover = hoverKey === step.key
          return h(
            'g',
            { key: 'tick-' + step.key, style: { pointerEvents: 'none' } },
            h('circle', {
              cx: pt.x,
              cy: pt.y,
              r: isCur || isHover ? 4.4 : 2.6,
              fill: isCur || isHover ? step.color : 'var(--dnb-text-2)',
              fillOpacity: isCur || isHover ? 1 : 0.80,
              stroke: 'var(--dnb-popover)',
              strokeWidth: isCur ? 1.5 : 0,
            }),
            h(
              'text',
              {
                x: lpt.x,
                y: lpt.y + 3,
                textAnchor: step.deg <= -155 ? 'end' : (step.deg >= -25 ? 'start' : 'middle'),
                fontSize: compact ? 10 : 10.5,
                fontWeight: isCur || isHover ? 700 : 600,
                fill: isCur || isHover ? step.color : 'var(--dnb-text-2)',
              },
              step.label,
            ),
          )
        }),
        // Static/snapping needle only when manual fixed notch or actively dragging
        showManualNeedle
          ? h(
              'g',
              { transform: `translate(${cx}, ${cy})`, style: { pointerEvents: 'none' } },
              h(
                'g',
                {
                  className: 'dnb-fan-needle',
                  'data-dragging': dragging ? '1' : '0',
                  style: { transform: `rotate(${needleRotateDeg}deg)` },
                },
                h('line', {
                  x1: 0,
                  y1: 0,
                  x2: 0,
                  y2: -54,
                  stroke: previewStep ? previewStep.color : 'var(--dnb-accent, #9f8eff)',
                  strokeWidth: 2.6,
                  strokeLinecap: 'round',
                }),
                h('circle', {
                  cx: 0,
                  cy: -54,
                  r: 3.2,
                  fill: 'var(--dnb-card)',
                  stroke: previewStep ? previewStep.color : 'var(--dnb-accent, #9f8eff)',
                  strokeWidth: 1.6,
                }),
              ),
            )
          : null,
        // Draggable thumb halo on the active track angle
        showManualNeedle
          ? h('circle', {
              cx: knobPt.x,
              cy: knobPt.y,
              r: dragging ? 7 : 5.5,
              fill: previewStep ? previewStep.color : 'var(--dnb-accent, #9f8eff)',
              fillOpacity: 0.28,
              style: { pointerEvents: 'none' },
            })
          : null,
      ),
      // Center Auto-Adjust Pivot Hub Button
      h('button', {
        type: 'button',
        className: 'dnb-fan-hub',
        'data-active': isAuto && !dragging ? '1' : '0',
        title: isAuto
          ? '已开启自动调档：难的问题多想一会，简单的快答；拖动外圈可手动改档'
          : '点这里切回自动调档，或拖动外圈手动选择',
        onPointerDown: e => e.stopPropagation(),
        onMouseEnter: () => setHoverKey('auto'),
        onMouseLeave: () => setHoverKey(prev => (prev === 'auto' ? '' : prev)),
        onClick: e => {
          e.stopPropagation()
          commitKey('auto')
        },
      },
        h('span', { className: 'dnb-fan-hub-main' },
          dragging && previewStep
            ? previewStep.label
            : (isAuto ? bi('自动', 'Auto') : (committedStep ? committedStep.label : bi('自动', 'Auto')))),
        h('span', { className: 'dnb-fan-hub-sub' },
          isAuto && !dragging ? bi('自动调档', 'Auto') : bi('切回自动', 'Set Auto')),
      ),
    ),
  )
}

/* ------------------------------------------- Shared Collapsible Accordion Card */

/**
 * Unified collapsible accordion card shared across Chief, Tasks, Peers, Archives, and Boundaries tabs.
 * Left chevron points right (0deg) when collapsed and down (90deg) when open.
 */
export function AccCard({
  open = true,
  onToggle = null,
  title,
  icon = null,
  accentColor = '',
  tone = '',
  preview = '',
  count = '',
  badges = null,
  headerExtra = null,
  actions = null,
  showPullHint = false,
  pullHintOpen = null,
  pullHintClosed = null,
  className = '',
  style = undefined,
  bodyStyle = undefined,
  headTitle = '',
  cardRef = null,
  children,
}) {
  const openHintText = pullHintOpen !== null ? pullHintOpen : bi('收起 ▴', 'Collapse ▴')
  const closedHintText = pullHintClosed !== null ? pullHintClosed : bi('展开 ▾', 'Expand ▾')
  const canToggle = typeof onToggle === 'function'
  const cardCls = ['dnb-acc-card', className].filter(Boolean).join(' ')
  const mergedStyle = accentColor
    ? { ...(style || {}), borderLeft: `3px solid ${accentColor}` }
    : style

  return h(
    'div',
    {
      ref: cardRef || undefined,
      className: cardCls,
      'data-open': open ? '1' : '0',
      'data-tone': tone || undefined,
      style: mergedStyle,
    },
    h(
      'div',
      {
        className: 'dnb-acc-head',
        style: canToggle ? undefined : { cursor: 'default' },
        title: headTitle || (canToggle ? (open ? bi('点击收起', 'Click to collapse') : bi('点击展开', 'Click to expand')) : undefined),
        onClick: canToggle ? onToggle : undefined,
      },
      h(
        'div',
        { className: 'dnb-acc-title-wrap' },
        canToggle
          ? h(Icon, { name: 'chevron', size: 12.5, className: 'dnb-acc-chevron' })
          : null,
        icon || null,
        title ? h('span', { className: 'dnb-acc-title' }, title) : null,
        badges || null,
        headerExtra || null,
        count !== '' && count !== null && count !== undefined
          ? h('span', { className: 'dnb-acc-count' }, String(count))
          : null,
        !open && preview
          ? h('span', { className: 'dnb-acc-preview', title: typeof preview === 'string' ? preview : undefined }, preview)
          : null,
      ),
      (actions || (canToggle && showPullHint))
        ? h(
            'div',
            { className: 'dnb-acc-ops', onClick: e => e.stopPropagation() },
            actions || null,
            canToggle && showPullHint
              ? h('span', { className: 'dnb-acc-pull-hint', onClick: onToggle }, open ? openHintText : closedHintText)
              : null,
          )
        : null,
    ),
    open
      ? h('div', { className: 'dnb-acc-body', style: bodyStyle }, children)
      : null,
  )
}
