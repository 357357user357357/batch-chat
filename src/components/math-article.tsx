import * as Clipboard from "expo-clipboard";
import {
    forwardRef,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { WebView } from "react-native-webview";

import { isDisplayMath, splitMathSegments } from "@/components/math-segments";
import { useTheme } from "@/hooks/use-theme";

export type MathArticleHandle = {
  /** Re-extract the current selection (with LaTeX) and copy it. */
  requestCopy: () => void;
};

export type MathArticleProps = {
  /** Mixed text + LaTeX (`$…$`/`\(…\)` inline, `$$…$$`/`\[…\]` display). */
  text: string;
  style?: ViewStyle;
  fontSize?: number;
  color?: string;
  /** Called once MathJax finished typesetting inside the WebView. */
  onReady?: () => void;
  /**
   * Called after the user selected a portion of the rendered answer and copied
   * it. Receives the selected text with LaTeX formulas preserved as their
   * `$$…$$`/`\(…\)` source.
   */
  onCopy?: (selectedText: string) => void;
  /**
   * Called when a text selection inside the rendered answer becomes active or
   * clears, so the host can show/hide a "copy selection" affordance.
   */
  onSelectionChange?: (active: boolean) => void;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(text: string, fontSize: number, color: string): string {
  // Render each part separately: plain text stays a normal span, math gets a
  // span tagged with its raw LaTeX source (`data-tex`, delimiters included) so
  // selections can be re-assembled with formulas preserved as their source.
  const body = splitMathSegments(text)
    .map((segment) => {
      const safe = escapeHtml(segment.value);
      if (segment.kind === "text")
        return `<span class="seg-text">${safe}</span>`;
      // A span (inline math spans inline, display math spans a block line).
      const kind = isDisplayMath(segment) ? "seg-math-d" : "seg-math-i";
      return `<span class="seg-math ${kind}" data-tex="${safe}">${safe}</span>`;
    })
    .join("");

  return [
    "<!doctype html>",
    "<html>",
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />',
    "    <style>",
    "      html, body { margin: 0; padding: 0; background: transparent; }",
    "      body { box-sizing: border-box; padding: 2px 6px 10px; overflow: hidden; }",
    "      #article {",
    "        font-size: " + fontSize + "px;",
    "        line-height: 1.6;",
    "        color: " + color + ";",
    "        white-space: pre-wrap;",
    "        word-break: break-word;",
    "        -webkit-user-select: text;",
    "        user-select: text;",
    "        caret-color: transparent;",
    "        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
    "      }",
    "      .seg-text { white-space: pre-wrap; }",
    "      .seg-math-i { display: inline; }",
    "      .seg-math-d { display: block; }",
    "      .seg-math-d mjx-container { text-align: center; }",
    "      /* Inline math stays on the line (MathJax handles inline vs. block);",
    "         we only force the color and keep tall display formulas un-clipped. */",
    "      mjx-container {",
    "        color: " + color + " !important;",
    "        overflow: visible;",
    "      }",
    '      mjx-container[display="true"] { margin: 8px 0; }',
    "    </style>",
    "    <script>",
    "      window.MathJax = {",
    "        tex: {",
    "          inlineMath: [['$', '$'], ['\\\\\\\\(', '\\\\\\\\)']],",
    "          displayMath: [['$$', '$$'], ['\\\\\\\\[', '\\\\\\\\]']]",
    "        },",
    "        startup: {",
    "          ready() {",
    "            MathJax.startup.defaultReady();",
    "            MathJax.startup.promise",
    "              .then(function () {",
    "                setTimeout(function () { postHeight(); }, 150);",
    "              })",
    "              .catch(function (error) {",
    "                if (window.ReactNativeWebView) {",
    "                  window.ReactNativeWebView.postMessage(",
    "                    'mathjax:error:' + (error && error.message)",
    "                  );",
    "                }",
    "              });",
    "          }",
    "        }",
    "      };",
    "      function postHeight() {",
    "        var article = document.getElementById('article');",
    "        if (!article) return;",
    "        var height = Math.ceil(article.getBoundingClientRect().height) + 20;",
    "        if (window.ReactNativeWebView) {",
    "          if (window.__lastArticleHeight === height) return;",
    "          window.__lastArticleHeight = height;",
    "          window.ReactNativeWebView.postMessage('mathjax:ready:' + height);",
    "        }",
    "      }",
    "      document.addEventListener('DOMContentLoaded', function () {",
    "        var article = document.getElementById('article');",
    "        if (article) {",
    "          var observer = new MutationObserver(function () { postHeight(); });",
    "          observer.observe(article, { subtree: true, childList: true, attributes: true });",
    "        }",
    "      });",
    "    </script>",
    '    <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>',
    "    <script>",
    "      (function () {",
    "        // ---- Selection-aware copy (LaTeX preserved). The host renders a",
    '        // native "Copy" chip; this script only extracts the selection. ----',
    "",
    "        // Re-assemble the selected text. Plain text keeps its characters;",
    "        // math spans keep their raw LaTeX source (data-tex, delimiters).",
    "        function nodeLatexText(node) {",
    '          if (!node) return "";',
    '          if (node.nodeType === 3) return node.nodeValue || "";',
    "          if (node.nodeType === 1) {",
    '            var cls = node.getAttribute && (node.getAttribute("class") || "");',
    '            if (cls.indexOf("seg-math") !== -1 && node.getAttribute("data-tex")) {',
    '              return node.getAttribute("data-tex");',
    "            }",
    "          }",
    '          var out = "", c = node.childNodes, i;',
    "          for (i = 0; i < c.length; i++) out += nodeLatexText(c[i]);",
    "          return out;",
    "        }",
    "        function selectedLatex() {",
    "          var sel = window.getSelection();",
    "          if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;",
    "          return nodeLatexText(sel.getRangeAt(0).cloneContents());",
    "        }",
    "        function sendCopy(text) {",
    '          if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage("mathjax:copy:" + text);',
    "        }",
    "",
    '        // Called by the host when its "Copy" chip is tapped. The tap can clear',
    "        // the live DOM selection, so fall back to the last observed range.",
    "        var lastRange = null;",
    "        // Deselects and drops focus so the blinking selection caret/handles",
    "        // disappear once the selected text has been copied.",
    "        function clearNativeSelection() {",
    "          var s = window.getSelection();",
    "          if (s) { if (s.removeAllRanges) s.removeAllRanges(); else if (s.empty) s.empty(); }",
    "          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();",
    "        }",
    "        window.__copySelection = function () {",
    "          var range = null;",
    "          var sel = window.getSelection();",
    "          if (sel && sel.rangeCount && !sel.isCollapsed) range = sel.getRangeAt(0).cloneContents();",
    "          if (!range && lastRange) { try { range = lastRange.cloneContents(); } catch (err) {} }",
    "          lastRange = null;",
    "          var text = range ? nodeLatexText(range) : null;",
    "          if (text) { sendCopy(text); if (wasSel) sendSelection(false); }",
    "          clearNativeSelection();",
    "        };",
    "",
    "        // Report active-selection state so the host can show/hide the chip.",
    "        var wasSel = false;",
    "        function sendSelection(active) {",
    "          wasSel = active;",
    '          if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage("mathjax:selection:" + (active ? "1" : "0"));',
    "        }",
    "        function reportSelection() {",
    "          var sel = window.getSelection();",
    "          var active = !!(sel && sel.rangeCount && !sel.isCollapsed && sel.toString().length > 0);",
    "          if (sel && sel.rangeCount && !sel.isCollapsed) {",
    "            try { lastRange = sel.getRangeAt(0).cloneRange(); } catch (err) {}",
    "          }",
    "          if (active !== wasSel) sendSelection(active);",
    "        }",
    '        document.addEventListener("selectionchange", reportSelection);',
    '        document.addEventListener("touchend", reportSelection);',
    '        document.addEventListener("mouseup", reportSelection);',
    "        setInterval(reportSelection, 250);",
    "        // Intercept any native copy so only the selected portion (with its",
    "        // LaTeX source) reaches the clipboard.",
    '        document.addEventListener("copy", function (e) {',
    "          var text = selectedLatex();",
    "          if (!text) return;",
    "          e.preventDefault();",
    "          sendCopy(text);",
    "          if (wasSel) sendSelection(false);",
    "          clearNativeSelection();",
    "        });",
    "      })();",
    "    </script>",
    "  </head>",
    "  <body>",
    '    <div id="article">' + body + "</div>",
    "  </body>",
    "</html>",
  ].join("\n");
}

/**
 * Renders mixed text + LaTeX inside a WebView using MathJax v3 (SVG output):
 * inline math (`$…$`, `\(…\)`) flows inside the surrounding text, while display
 * math (`$$…$$`, `\[…\]`) gets its own block line.
 *
 * The host is auto-sized: MathJax reports its real rendered height through
 * `postMessage` and the WebView grows to fit. The MathJax library is loaded
 * from a CDN, so the device needs network access.
 *
 * Text is selectable: when a portion is selected the host shows a "Copy"
 * chip, and copying extracts only the selected portion with any LaTeX
 * formulas preserved as their `$$…$$`/`\(…\)` source.
 */
export const MathArticle = forwardRef<MathArticleHandle, MathArticleProps>(
  function MathArticle(
    { text, style, fontSize = 15, color, onReady, onCopy, onSelectionChange },
    ref,
  ) {
    const theme = useTheme();
    // Default to the active app theme's text color so the math stays visible
    // in both light and dark mode (a hardcoded dark color becomes invisible on
    // the dark background).
    const resolvedColor = color ?? theme.text;
    const html = useMemo(
      () => buildHtml(text, fontSize, resolvedColor),
      [text, fontSize, resolvedColor],
    );
    const [boxHeight, setBoxHeight] = useState<number>(
      Math.max(80, Math.round(fontSize * 6)),
    );
    const webviewRef = useRef<WebView>(null);

    useImperativeHandle(
      ref,
      () => ({
        requestCopy() {
          // Ask the WebView to extract the selection (with LaTeX) and post it
          // back; the message handler below writes it to the clipboard.
          webviewRef.current?.injectJavaScript(
            "window.__copySelection ? window.__copySelection() : null; true;",
          );
        },
      }),
      [],
    );

    const handleMessage = (event: { nativeEvent: { data: string } }) => {
      const message = event.nativeEvent.data;
      if (message.startsWith("mathjax:ready:")) {
        const parsed = Number(message.slice("mathjax:ready:".length));
        if (Number.isFinite(parsed) && parsed > 0) {
          setBoxHeight((current) => Math.max(current, Math.round(parsed)));
        }
        onReady?.();
      } else if (message.startsWith("mathjax:copy:")) {
        const selected = message.slice("mathjax:copy:".length);
        void Clipboard.setStringAsync(selected);
        onSelectionChange?.(false);
        onCopy?.(selected);
      } else if (message === "mathjax:selection:1") {
        onSelectionChange?.(true);
      } else if (message === "mathjax:selection:0") {
        onSelectionChange?.(false);
      } else if (message.startsWith("mathjax:error")) {
        console.warn("[math-view]", message);
      }
    };

    return (
      <View style={[styles.container, { height: boxHeight }, style]}>
        <WebView
          ref={webviewRef}
          style={styles.webview}
          originWhitelist={["*"]}
          source={{ html }}
          javaScriptEnabled
          domStorageEnabled
          onMessage={handleMessage}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    alignSelf: "stretch",
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
