export type MathSegment = { kind: 'text' | 'math'; value: string };

// Splits text into plain-text parts and LaTeX blocks:
//   $$ ... $$   (display math)
//   \[ ... \]   (display math)
//   \( ... \)   (inline math)
//   $ ... $     (inline math)
// The single-dollar rule requires a non-space, non-$ char right inside each
// dollar (and no newline between) so amounts like "$5" aren't mistaken for math.
const MATH_PATTERN =
  /(\$\$[\s\S]{1,4000}?\$\$|\\\[[\s\S]{1,4000}?\\\]|\\\([\s\S]{1,400}?\\\)|\$[^\s$](?:[^$\n]*[^\s$])?\$)/g;

export function splitMathSegments(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
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

export function containsMath(text: string): boolean {
  return splitMathSegments(text).some((segment) => segment.kind === 'math');
}

/** True when a math segment renders as a display block (`$$…$$` / `\[…\]`). */
export function isDisplayMath(segment: MathSegment): boolean {
  return segment.value.startsWith('$$') || segment.value.startsWith('\\[');
}