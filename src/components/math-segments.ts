export type MathSegment = { kind: "text" | "math"; value: string };

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
      segments.push({ kind: "text", value: text.slice(lastIndex, index) });
    }
    segments.push({ kind: "math", value: match[0] });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", value: text.slice(lastIndex) });
  }
  return segments;
}

export function containsMath(text: string): boolean {
  return splitMathSegments(text).some((segment) => segment.kind === "math");
}

// Recognized LaTeX macro names — a curated list keeps false positives near
// zero (plain sentences essentially never contain a backslash + one of these).
const LATEX_MACROS = [
  "frac",
  "sqrt",
  "sum",
  "int",
  "prod",
  "lim",
  "infty",
  "partial",
  "nabla",
  "cdot",
  "times",
  "pm",
  "mp",
  "leq",
  "geq",
  "neq",
  "approx",
  "equiv",
  "sim",
  "propto",
  "subset",
  "subseteq",
  "cup",
  "cap",
  "forall",
  "exists",
  "emptyset",
  "rightarrow",
  "leftarrow",
  "Rightarrow",
  "Leftrightarrow",
  "to",
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "theta",
  "lambda",
  "mu",
  "sigma",
  "phi",
  "omega",
  "pi",
  "sin",
  "cos",
  "tan",
  "log",
  "ln",
  "exp",
  "left",
  "right",
  "text",
  "mathbb",
  "mathrm",
  "hat",
  "bar",
  "vec",
  "overline",
  "underline",
  "binom",
  "cdots",
  "ldots",
  "vdots",
  "ddots",
];

const RAW_LATEX_MACRO = `\\\\(?:${LATEX_MACROS.join("|")})(?:\\{[^{}]*\\})*(?:[_^](?:\\{[^{}]*\\}|[^\\s{}]))*`;
// Bare exponents typed without a macro, e.g. `x^2`, `(a+b)^2`, `e^{-x}`.
// Restricted to `^` only (not `_`) since underscores are common in plain
// text (snake_case, usernames) while `^` is an unambiguous math signal.
const EXPONENT_BASE = "(?:\\([^()]*\\)|[A-Za-z0-9\\]])";
const RAW_BARE_EXPONENT = `${EXPONENT_BASE}\\^(?:\\{[^{}]+\\}|-?[A-Za-z0-9]+)`;

const RAW_LATEX_PATTERN = new RegExp(
  `${RAW_LATEX_MACRO}|${RAW_BARE_EXPONENT}`,
  "g",
);

/**
 * Wraps bare LaTeX (`\frac{1}{2}`, `\sqrt{x}`, `x^2`, …) in `$…$` when the
 * user typed it without delimiters, so questions render the same way
 * answers do. Text that already uses `$…$`/`$$…$$`/`\(…\)`/`\[…\]` is left
 * untouched.
 */
export function autoDelimitRawLatex(text: string): string {
  if (containsMath(text)) return text;
  if (!RAW_LATEX_PATTERN.test(text)) return text;
  RAW_LATEX_PATTERN.lastIndex = 0;
  return text.replace(RAW_LATEX_PATTERN, (match) => `$${match}$`);
}

/** True when a math segment renders as a display block (`$$…$$` / `\[…\]`). */
export function isDisplayMath(segment: MathSegment): boolean {
  return segment.value.startsWith("$$") || segment.value.startsWith("\\[");
}
