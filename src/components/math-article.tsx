import { useMemo, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

import { useTheme } from '@/hooks/use-theme';

export type MathArticleProps = {
  /** Mixed text + LaTeX (`$…$`/`\(…\)` inline, `$$…$$`/`\[…\]` display). */
  text: string;
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

function buildHtml(text: string, fontSize: number, color: string): string {
  const body = escapeHtml(text);
  return [
    '<!doctype html>',
    '<html>',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />',
    '    <style>',
    '      html, body { margin: 0; padding: 0; background: transparent; }',
    '      body { box-sizing: border-box; padding: 2px 6px 10px; overflow: hidden; }',
    '      #article {',
    '        font-size: ' + fontSize + 'px;',
    '        line-height: 1.6;',
    '        color: ' + color + ';',
    '        white-space: pre-wrap;',
    '        word-break: break-word;',
    "        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
    '      }',
    '      /* Inline math stays on the line (MathJax handles inline vs. block);',
    '         we only force the color and keep tall display formulas un-clipped. */',
    '      mjx-container {',
    '        color: ' + color + ' !important;',
    '        overflow: visible;',
    '      }',
    '      mjx-container[display="true"] { margin: 8px 0; }',
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
    "        var article = document.getElementById('article');",
    '        if (!article) return;',
    '        var height = Math.ceil(article.getBoundingClientRect().height) + 20;',
    '        if (window.ReactNativeWebView) {',
    '          if (window.__lastArticleHeight === height) return;',
    '          window.__lastArticleHeight = height;',
    "          window.ReactNativeWebView.postMessage('mathjax:ready:' + height);",
    '        }',
    '      }',
    "      document.addEventListener('DOMContentLoaded', function () {",
    "        var article = document.getElementById('article');",
    '        if (article) {',
    '          var observer = new MutationObserver(function () { postHeight(); });',
    '          observer.observe(article, { subtree: true, childList: true, attributes: true });',
    '        }',
    '      });',
    '    </script>',
    '    <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>',
    '  </head>',
    '  <body>',
    '    <div id="article">' + body + '</div>',
    '  </body>',
    '</html>',
  ].join('\n');
}

/**
 * Renders mixed text + LaTeX inside a WebView using MathJax v3 (SVG output):
 * inline math (`$…$`, `\(…\)`) flows inside the surrounding text, while display
 * math (`$$…$$`, `\[…\]`) gets its own block line.
 *
 * The host is auto-sized: MathJax reports its real rendered height through
 * `postMessage` and the WebView grows to fit. The MathJax library is loaded
 * from a CDN, so the device needs network access.
 */
export function MathArticle({ text, style, fontSize = 15, color, onReady }: MathArticleProps) {
  const theme = useTheme();
  // Default to the active app theme's text color so the math stays visible
  // in both light and dark mode (a hardcoded dark color becomes invisible on
  // the dark background).
  const resolvedColor = color ?? theme.text;
  const html = useMemo(() => buildHtml(text, fontSize, resolvedColor), [text, fontSize, resolvedColor]);
  const [boxHeight, setBoxHeight] = useState<number>(Math.max(80, Math.round(fontSize * 6)));

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