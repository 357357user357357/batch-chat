import { useEffect, useRef } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { loadMathJax } from '@/services/mathjax.web';

export type MathArticleProps = {
  /** Mixed text + LaTeX (`$…$`/`\(…\)` inline, `$$…$$`/`\[…\]` display). */
  text: string;
  style?: ViewStyle;
  fontSize?: number;
  color?: string;
  /** Called once MathJax finished typesetting. */
  onReady?: () => void;
};

/**
 * Web implementation of MathArticle: typesets the whole answer (text + inline
 * and display LaTeX) in the DOM with MathJax v3 (SVG), so `$…$` stays on the
 * same line as the surrounding text while `$$…$$` becomes its own block.
 */
export function MathArticle({ text, style, fontSize = 15, color, onReady }: MathArticleProps) {
  const theme = useTheme();
  const resolvedColor = color ?? theme.text;
  const hostRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    host.style.fontSize = `${fontSize}px`;
    host.style.color = resolvedColor;
    host.style.lineHeight = '1.6';
    host.style.whiteSpace = 'pre-wrap';
    host.style.wordBreak = 'break-word';

    (async () => {
      try {
        const api = await loadMathJax();
        if (cancelled || !hostRef.current) return;
        hostRef.current.textContent = text;
        await api.typesetPromise?.([hostRef.current]);
        if (cancelled || !hostRef.current) return;
        onReady?.();
      } catch (error) {
        console.warn('[math-article:web] render failed', error);
        if (!cancelled && hostRef.current) hostRef.current.textContent = text;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [text, fontSize, resolvedColor]);

  return (
    <View
      ref={(node) => {
        hostRef.current = node as unknown as HTMLElement | null;
      }}
      style={[styles.container, style]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
});