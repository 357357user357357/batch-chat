/**
 * Shared MathJax v3 (tex-svg) loader for the web build.
 *
 * Configures the same inline / display delimiters the native WebView uses, so
 * `$…$` and `\(…\)` render inline and `$$…$$` / `\[…\]` render as blocks. The
 * library is loaded once and reused by both `MathView` and `MathArticle`.
 */

export type MathJaxApi = {
  startup?: { promise: Promise<unknown> };
  tex2svgPromise?: (tex: string, options?: { display?: boolean }) => Promise<HTMLElement>;
  typesetPromise?: (elements?: HTMLElement[]) => Promise<unknown>;
};

declare global {
  interface Window {
    MathJax?: MathJaxApi & Record<string, unknown>;
  }
}

let loadPromise: Promise<MathJaxApi> | null = null;

export function loadMathJax(): Promise<MathJaxApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('MathJax requires a browser.'));
  }
  const existing = window.MathJax;
  if (existing?.tex2svgPromise) return Promise.resolve(existing);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<MathJaxApi>((resolve, reject) => {
    const mj = window.MathJax ?? ({} as MathJaxApi & Record<string, unknown>);
    window.MathJax = mj;
    mj.tex = {
      inlineMath: [
        ['$', '$'],
        ['\\(', '\\)'],
      ],
      displayMath: [
        ['$$', '$$'],
        ['\\[', '\\]'],
      ],
    };

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js';
    script.async = true;
    script.onload = () => {
      const api = window.MathJax;
      const settle = () => resolve(api as MathJaxApi);
      if (api?.startup?.promise) api.startup.promise.then(settle).catch(reject);
      else if (api?.tex2svgPromise) settle();
      else {
        loadPromise = null;
        reject(new Error('MathJax failed to initialize.'));
      }
    };
    script.onerror = () => {
      loadPromise = null;
      reject(new Error('Could not load MathJax from the CDN.'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}