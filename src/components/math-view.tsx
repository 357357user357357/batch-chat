import { useMemo, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

import { useTheme } from '@/hooks/use-theme';

export type MathViewProps = {
  /** LaTeX (TeX) expression, e.g. `x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}` */
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
  return [
    '<!doctype html>',
    '<html>',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />',
    '    <style>',
    '      html, body { margin: 0; padding: 0; background: transparent; }',
    '      body { box-sizing: border-box; padding: 2px 6px 10px; overflow: hidden; }',
    '      #math { font-size: ' + fontSize + 'px; line-height: 1.7; text-align: center; }',
    '      /* MathJax SVG glues formulas to the text baseline with',
    '         vertical-align offsets; a fixed-height host then clips tall',
    '         formulas (fractions, sqrt, sums). Block display + visible',
    '         overflow keeps every pixel inside the box. */',
    '      mjx-container {',
    '        color: ' + color + ' !important;',
    '        display: block;',
    '        text-align: center;',
    '        overflow: visible;',
    '        margin: 3px auto;',
    '      }',
    '    </style>',
    '    <script>',
    '      window.MathJax = {',
    '        tex: {',
    "          inlineMath: [['$', '$'], ['\\\\\\\\(', '\\\\\\\\)']],",
    "          displayMath: [['$$', '$$'], ['\\\\\\\\[', '\\\\\\\\]']]",
    '        },',
    '        startup: {',
    '          ready() {',
    '            MathJax.startup.defaultReady();',
    '            MathJax.startup.promise',
    '              .then(function () {',
    '                setTimeout(function () { postHeight(); }, 150);',
    '              })',
    '              .catch(function (error) {',
    '                if (window.ReactNativeWebView) {',
    "                  window.ReactNativeWebView.postMessage(",
    "                    'mathjax:error:' + (error && error.message)",
    '                  );',
    '                }',
    '              });',
    '          }',
    '        }',
    '      };',
    '      function postHeight() {',
    "        var math = document.getElementById('math');",
    '        if (!math) return;',
    '        var height = Math.ceil(math.getBoundingClientRect().height) + 14;',
    '        if (window.ReactNativeWebView) {',
    '          if (window.__lastMathHeight === height) return;',
    '          window.__lastMathHeight = height;',
    "          window.ReactNativeWebView.postMessage('mathjax:ready:' + height);",
    '        }',
    '      }',
    "      document.addEventListener('DOMContentLoaded', function () {",
    "        var math = document.getElementById('math');",
    '        if (math) {',
    '          var observer = new MutationObserver(function () { postHeight(); });',
    '          observer.observe(math, { subtree: true, childList: true, attributes: true });',
    '        }',
    '      });',
    '    </script>',
    '    <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>',
    '  </head>',
    '  <body>',
    '    <div id="math">$$' + body + '$$</div>',
    '  </body>',
    '</html>',
  ].join('\n');
}

/**
 * Renders a LaTeX formula inside a WebView using MathJax v3 (SVG output).
 *
 * The host is auto-sized: MathJax reports its real rendered height through
 * `postMessage` and the WebView grows to fit. This fixes the "only the top
 * half of the formula" clipping that happens when the host has a fixed height
 * smaller than tall formulas (fractions, \sqrt, \sum, …). The MathJax library
 * is loaded from a CDN, so the device needs network access.
 */
export function MathView({ tex, style, fontSize = 18, color, onReady }: MathViewProps) {
  const theme = useTheme();
  // Default to the active app theme's text color so the formula stays visible
  // in both light and dark mode (a hardcoded dark color becomes invisible on
  // the dark background).
  const resolvedColor = color ?? theme.text;
  const html = useMemo(() => buildHtml(tex, fontSize, resolvedColor), [tex, fontSize, resolvedColor]);
  const [boxHeight, setBoxHeight] = useState<number>(Math.max(56, Math.round(fontSize * 3.6)));

  const handleMessage = (event: { nativeEvent: { data: string } }) => {
    const message = event.nativeEvent.data;
    if (message.startsWith('mathjax:ready:')) {
      const parsed = Number(message.slice('mathjax:ready:'.length));
      if (Number.isFinite(parsed) && parsed > 0) {
        setBoxHeight((current) => Math.max(current, Math.round(parsed)));
      }
      onReady?.();
    } else if (message.startsWith('mathjax:error')) {
      console.warn('[math-view]', message);
    }
  };

  return (
    <View style={[styles.container, { height: boxHeight }, style]}>
      <WebView
        style={styles.webview}
        originWhitelist={['*']}
        source={{ html }}
        javaScriptEnabled
        domStorageEnabled
        onMessage={handleMessage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});