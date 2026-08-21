import { useEffect, useRef } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { loadMathJax } from '@/services/mathjax.web';

export type MathViewProps = {
  /** LaTeX (TeX) expression, e.g. `x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}` */
  tex: string;
  style?: ViewStyle;
  fontSize?: number;
  color?: string;
  /** Called once MathJax finished rendering. */
  onReady?: () => void;
};

/**
 * Web implementation of MathView: renders LaTeX with MathJax v3 (SVG) directly
 * in the DOM. `react-native-webview` has no web support, so the native
 * `math-view.tsx` cannot render here; this keeps formulas working in the web
 * build and matches the native SVG output (and its auto-sizing behaviour).
 */
export function MathView({ tex, style, fontSize = 18, color, onReady }: MathViewProps) {
  const theme = useTheme();
  const resolvedColor = color ?? theme.text;
  const hostRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    host.style.fontSize = `${fontSize}px`;
    host.style.color = resolvedColor;

    (async () => {
      try {
        const api = await loadMathJax();
        if (cancelled || !hostRef.current) return;
        const svg = await api.tex2svgPromise?.(tex, { display: true });
        if (cancelled || !hostRef.current || !svg) return;
        hostRef.current.replaceChildren(svg);
        const container = hostRef.current.firstElementChild as HTMLElement | null;
        if (container) {
          container.style.display = 'block';
          container.style.textAlign = 'center';
          container.style.overflow = 'visible';
          container.style.margin = '3px auto';
          container.style.color = resolvedColor;
        }
        onReady?.();
      } catch (error) {
        console.warn('[math-view:web] render failed', error);
        if (!cancelled && hostRef.current) hostRef.current.textContent = tex;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tex, fontSize, resolvedColor]);

  return (
    <View
      ref={(node) => {
        hostRef.current = node as unknown as HTMLElement | null;
      }}
      style={[styles.container, { minHeight: Math.max(48, Math.round(fontSize * 3.2)) }, style]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
});
