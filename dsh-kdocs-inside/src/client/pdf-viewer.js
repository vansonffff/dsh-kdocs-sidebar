/**
 * The desktop shell's 原版 pane: the document rendered from its exported PDF.
 *
 * Lives in the lazily loaded `client-pdf.js` chunk so the web profile never
 * downloads pdf.js — the web keeps the iframe embed, and this chunk arrives
 * only when a desktop preview actually opens (the same `require.async` pattern
 * the product's own documentpreview uses for its PDF body).
 *
 * Rendering runs through pdf.js's fake worker (main thread): the classic-script
 * runtime cannot hand the library a worker URL, and a sidebar preview of a
 * contract-sized document does not feel the difference. `isEvalSupported` is
 * off so a strict CSP page cannot break font decoding.
 *
 * @module kdocs/client/pdf-viewer
 */

/**
 * Build the viewer component against the chunk's React.
 *
 * @param {any} react - the platform React seed.
 * @param {any} jsxRuntime - the platform jsx-runtime seed.
 * @param {any} pdfjsLib - the vendored pdf.js (see vendor/pdfjs-3.11.174.min.js).
 * @returns {any} the KDocsPdfViewer component.
 */
export function createPdfViewer(react, jsxRuntime, pdfjsLib) {
  const { jsx, jsxs } = jsxRuntime;
  const { useEffect, useRef, useState } = react;

  /** fit-width plus a bounded zoom multiplier. */
  const ZOOM_STEPS = [0.75, 1, 1.25, 1.5, 2];

  /**
   * Render every page of the exported PDF into a vertical strip of canvases.
   *
   * @param {any} props - `{ bytes: Uint8Array, t: (key: string) => string }`.
   * @returns {any} the rendered viewer.
   */
  function KDocsPdfViewer(props) {
    const { bytes, t } = props;
    const containerRef = useRef(null);
    const [zoom, setZoom] = useState(1);
    const [state, setState] = useState({ status: 'loading', pages: 0, error: undefined });

    useEffect(() => {
      let cancelled = false;
      /** @type {any} */
      let doc;
      void (async () => {
        try {
          doc = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
          if (cancelled) return;
          const container = containerRef.current;
          if (container === null) return;
          container.textContent = '';
          for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
            const page = await doc.getPage(pageNumber);
            if (cancelled) return;
            const base = page.getViewport({ scale: 1 });
            const width = container.clientWidth > 0 ? container.clientWidth : 320;
            const viewport = page.getViewport({ scale: (width / base.width) * zoom });
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            canvas.style.cssText = 'display:block;width:100%;height:auto;margin:0 0 8px;box-shadow:0 1px 4px rgba(0,0,0,0.12);background:#fff';
            canvas.setAttribute('data-kdocs-pdf-page', String(pageNumber));
            container.appendChild(canvas);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            if (cancelled) return;
            setState((current) => ({ ...current, status: 'ready', pages: doc.numPages, rendered: pageNumber }));
          }
        } catch (error) {
          if (!cancelled) setState({ status: 'error', pages: 0, error: String(error && error.message ? error.message : error) });
        }
      })();
      return () => {
        cancelled = true;
        void doc?.destroy();
      };
    }, [bytes, zoom]);

    const zoomRow = jsxs('div', {
      key: 'zoom',
      style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderBottom: '0.5px solid var(--dsw-alias-border-l3)', flex: '0 0 auto' },
      children: [
        jsx('button', {
          key: 'out',
          type: 'button',
          'data-kdocs-pdf-zoom-out': 'true',
          disabled: zoom <= ZOOM_STEPS[0],
          onClick: () => setZoom((current) => Math.max(ZOOM_STEPS[0], current - 0.25)),
          style: { font: 'inherit', fontSize: '12px' },
          children: '−',
        }),
        jsx('span', { key: 'value', style: { fontSize: '11.5px', opacity: 0.7 }, children: `${Math.round(zoom * 100)}%` }),
        jsx('button', {
          key: 'in',
          type: 'button',
          'data-kdocs-pdf-zoom-in': 'true',
          disabled: zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1],
          onClick: () => setZoom((current) => Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], current + 0.25)),
          style: { font: 'inherit', fontSize: '12px' },
          children: '+',
        }),
        state.status === 'ready'
          ? jsx('span', { key: 'pages', style: { marginLeft: 'auto', fontSize: '11.5px', opacity: 0.6 }, children: String(t('pdfPages')).replace('{pages}', String(state.pages)) })
          : null,
      ],
    });

    return jsxs('div', {
      'data-kdocs-pdf-viewer': 'true',
      style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' },
      children: [
        zoomRow,
        jsx('div', {
          key: 'strip',
          ref: containerRef,
          'data-kdocs-pdf-strip': 'true',
          style: { flex: '1 1 auto', minHeight: '0', overflow: 'auto', padding: '10px' },
          children: state.status === 'error'
            ? jsx('div', { style: { padding: '12px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' }, children: state.error })
            : undefined,
        }),
      ],
    });
  }

  return KDocsPdfViewer;
}
