/**
 * react-runtime.js
 *
 * Bridges host React (`require('react')`) when bundled into `pkg/client.js`,
 * while supplying a lightweight stub under Node unit tests so UI modules import cleanly.
 */

const noop = () => {}

const React = (typeof globalThis !== 'undefined' && globalThis.__DSH_CLIENT_REACT__) || {
  createElement: (type, props, ...children) => ({
    $$typeof: 'react.el',
    type,
    props: { ...(props || {}), children },
  }),
  Component: class Component {
    constructor(props) {
      this.props = props || {}
    }
  },
  Fragment: 'Fragment',
  useState: (init) => [typeof init === 'function' ? init() : init, noop],
  useEffect: noop,
  useRef: (init) => ({ current: init }),
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
}

const h = React.createElement

export { React, h }
