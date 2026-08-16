import { useMemo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

export type MathViewProps = {
  /** LaTeX (TeX) expression, e.g. `x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}` */
  tex: string;
  style?: ViewStyle;
  fontSize?: number;
  color?: string;
  /** Called once MathJax finished typesetting inside the WebView. */
  onReady?: () => void;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildHtml(tex: string, fontSize: number, color: string): string {
  const body = escapeHtml(tex);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <style>
      html, body { margin: 0; padding: 0; background: transparent; }
      body { display: flex; align-items: center; justify-content: center; min-height: 100vh; color: ${color}; }
      #math { font-size: ${fontSize}px; padding: 8px; }
      mjx-container { color: ${color} !important; }
    </style>
    <script>
      window.MathJax = {
        tex: {
          inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
          displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']]
        },
        startup: {
          ready() {
            MathJax.startup.defaultReady();
            MathJax.startup.promise
              .then(function () {
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage('mathjax:ready');
                }
              })
              .catch(function (error) {
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage('mathjax:error:' + (error && error.message));
                }
              });
          }
        }
      };
    </script>
    <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
  </head>
  <body>
    <div id="math">$$${body}$$</div>
  </body>
</html>`;
}

/**
 * Renders a LaTeX formula inside a WebView using MathJax v3 (SVG output).
 *
 * The MathJax script is loaded from a CDN, so the device needs network access.
 * Emits `mathjax:ready` / `mathjax:error:<message>` through `postMessage`,
 * which are surfaced via the `onReady` prop.
 */
export function MathView({ tex, style, fontSize = 18, color = '#111827', onReady }: MathViewProps) {
  const html = useMemo(() => buildHtml(tex, fontSize, color), [tex, fontSize, color]);

  return (
    <View style={[styles.container, style]}>
      <WebView
        style={styles.webview}
        originWhitelist={['*']}
        source={{ html }}
        javaScriptEnabled
        domStorageEnabled
        onMessage={(event) => {
          const message = event.nativeEvent.data;
          if (message.startsWith('mathjax:ready')) {
            onReady?.();
          } else if (message.startsWith('mathjax:error')) {
            console.warn('[math-view]', message);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});