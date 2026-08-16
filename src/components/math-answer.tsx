import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MathView } from '@/components/math-view';

type Segment = { kind: 'text' | 'math'; value: string };

// Splits text into plain-text parts and LaTeX blocks:
//   $$ ... $$   (display math)
//   \[ ... \]   (display math)
//   \( ... \)   (inline math)
const MATH_PATTERN = /(\$\$[\s\S]{1,4000}?\$\$|\\\[[\s\S]{1,4000}?\\\]|\\\([^\\]{1,400}?\\\))/g;

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

function stripDelimiters(raw: string): string {
  if (raw.startsWith('$$')) return raw.slice(2, -2);
  if (raw.startsWith('\\[')) return raw.slice(2, -2);
  if (raw.startsWith('\\(')) return raw.slice(2, -2);
  return raw;
}

/**
 * Renders AI text that may contain LaTeX: plain paragraphs + MathJax formulas.
 * All math blocks are flattened into display-style formulas (rendered by
 * `MathView`), which keeps the implementation simple and readable on a phone.
 */
export function MathAnswer({ text, fontSize = 15 }: { text: string; fontSize?: number }) {
  const segments = useMemo(() => splitMathSegments(text), [text]);

  if (!segments.length) {
    return <ThemedText type="small">{text}</ThemedText>;
  }

  return (
    <View style={styles.container}>
      {segments.map((segment, index) =>
        segment.kind === 'math' ? (
          <View key={index} style={styles.mathBlock}>
            <MathView
              tex={stripDelimiters(segment.value)}
              fontSize={Math.max(12, Math.round(fontSize * 0.95))}
            />
          </View>
        ) : (
          <ThemedText key={index} type="small" style={styles.text}>
            {segment.value}
          </ThemedText>
        )
      )}
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
});