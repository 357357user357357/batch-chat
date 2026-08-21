import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MathArticle } from '@/components/math-article';
import { useI18n } from '@/i18n';

type Segment = { kind: 'text' | 'math'; value: string };

// Splits text into plain-text parts and LaTeX blocks:
//   $$ ... $$   (display math)
//   \[ ... \]   (display math)
//   \( ... \)   (inline math)
//   $ ... $     (inline math)
// The single-dollar rule requires a non-space, non-$ char right inside each
// dollar (and no newline between) so amounts like "$5" aren't mistaken for math.
const MATH_PATTERN = /(\$\$[\s\S]{1,4000}?\$\$|\\\[[\s\S]{1,4000}?\\\]|\\\([\s\S]{1,400}?\\\)|\$[^\s$](?:[^$\n]*[^\s$])?\$)/g;

export function splitMathSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(MATH_PATTERN)) {
    const index = match.index as number;
    if (index > lastIndex) {
      segments.push({ kind: 'text', value: text.slice(lastIndex, index) });
    }
    segments.push({ kind: 'math', value: match[0] });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}

/**
 * Renders AI text that may contain LaTeX: plain paragraphs + MathJax formulas.
 * Each formula is tappable to copy its LaTeX source (like OpenRouter's
 * "copy" affordance); a long-press is not needed on mobile, so a visible
 * "Copy formula" affordance is shown per block.
 */
export function MathAnswer({ text, fontSize = 15 }: { text: string; fontSize?: number }) {
  const { t } = useI18n();
  const [showSource, setShowSource] = useState(false);
  const hasMath = useMemo(() => splitMathSegments(text).some((s) => s.kind === 'math'), [text]);

  // Raw Markdown view: the whole answer (text + `$$…$$` LaTeX) as selectable
  // text, so any chunk can be long-pressed and copied *with its formulas*.
  if (showSource) {
    return (
      <View style={styles.container}>
        <ThemedText type="code" selectable style={styles.sourceText}>
          {text}
        </ThemedText>
        <Pressable onPress={() => setShowSource(false)} hitSlop={6} style={styles.toggle}>
          <ThemedText type="code" themeColor="textSecondary">
            {t('math.rendered')}
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  // No math → plain selectable text (no webview needed).
  if (!hasMath) {
    return <ThemedText type="small" selectable>{text}</ThemedText>;
  }

  return (
    <View style={styles.container}>
      <MathArticle text={text} fontSize={fontSize} />
      <Pressable onPress={() => setShowSource(true)} hitSlop={6} style={styles.toggle}>
        <ThemedText type="code" themeColor="textSecondary">
          {t('math.source')}
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  text: {
    lineHeight: 21,
  },
  mathBlock: {
    marginVertical: 4,
    alignSelf: 'stretch',
  },
  copyHint: {
    alignSelf: 'flex-end',
    marginTop: -6,
  },
  sourceText: {
    lineHeight: 20,
  },
  toggle: {
    alignSelf: 'flex-end',
    marginTop: 2,
  },
});