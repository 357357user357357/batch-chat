export type MathSegment = { kind: "text" | "math"; value: string };

// Splits text into plain-text parts and LaTeX blocks:
//   $$ ... $$   (display math)
//   \[ ... \]   (display math)
//   \( ... \)   (inline math)
//   $ ... $     (inline math)
// The single-dollar rule requires a non-space, non-$ char right inside each
// dollar so amounts like "$5" aren't mistaken for math. Newlines are allowed
// inside (bounded to 400 chars, like \(...\)) since model output often wraps
// a sentence containing inline math across an actual line break, not just a
// visual one — excluding \n here used to make MathJax silently skip those.
const MATH_PATTERN =
  /(\$\$[\s\S]{1,4000}?\$\$|\\\[[\s\S]{1,4000}?\\\]|\\\([\s\S]{1,400}?\\\)|\$[^\s$](?:[^$]{0,398}[^\s$])?\$)/g;

/** ASCII power notation typed like code: `X**2`, `2**10`, `a**(n+1)`. Models
 *  occasionally answer with Python-style powers; converted to `base^{exp}`. */
const ASCII_POWER_PATTERN =
  /(^|[^A-Za-z0-9_*\\])((?:[A-Za-z0-9\]]+|\([^()\n]+\))\*\*(?:[A-Za-z0-9]+|\([^()\n]+\)))/g;

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

// Bare LaTeX commands — symbols/operators that render on their own without an
// argument, so things like `\infty`, `\pi`, `\hat`, … are wrapped even when the
// user omits `{…}`/`_`/`^`. Keeping a curated set means false positives (e.g. a
// Windows path like `C:\Users`) don't get turned into math. Commands that DO
// carry an argument or a sub/superscript are recognized regardless of this list.
const BARE_SYMBOLS = [
  "frac", "dfrac", "tfrac", "cfrac",
  "sqrt",
  "sum", "int", "prod", "lim", "inf", "sup", "max", "min",
  "infty", "partial", "nabla", "ell", "hbar", "Re", "Im",
  "cdot", "times", "pm", "mp", "div",
  "leq", "geq", "neq", "approx", "equiv", "sim", "propto",
  "subset", "subseteq", "supset", "supseteq", "cup", "cap",
  "forall", "exists", "nexists", "emptyset", "varnothing",
  "rightarrow", "leftarrow", "Rightarrow", "Leftarrow",
  "Leftrightarrow", "to", "mapsto", "implies", "iff",
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon",
  "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda",
  "mu", "nu", "xi", "rho", "varrho", "sigma", "tau", "upsilon",
  "phi", "varphi", "chi", "psi", "omega",
  "pi", "varpi", "varsigma", "imath", "jmath",
  "oplus", "ominus", "otimes", "oslash", "odot",
  "vee", "wedge", "neg", "top", "bot", "star", "ast",
  "lceil", "rceil", "lfloor", "rfloor", "langle", "rangle",
  "perp", "parallel", "mid",
  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "coth",
  "deg", "bmod", "pmod",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma",
  "Upsilon", "Phi", "Psi", "Omega",
  "sin", "cos", "tan", "cot", "sec", "csc",
  "log", "ln", "exp", "det", "gcd", "arg", "dim", "ker", "hom",
  "left", "right",
  "text", "mathbb", "mathrm", "mathbf", "mathit", "mathcal",
  "mathfrak", "mathsf", "mathtt", "operatorname",
  "displaystyle", "textstyle", "scriptstyle",
  "hat", "bar", "vec", "dot", "ddot", "tilde",
  "overline", "underline", "widehat", "widetilde",
  "binom", "cdots", "ldots", "vdots", "ddots", "dots", "dotsc",
  "quad", "qquad", "angle", "degree", "prime", "circ",
];

const BARE_SYMBOL_SET = new Set(BARE_SYMBOLS);

/**
 * A single LaTeX command: `\` + letters (+ optional `*`), any brace arguments
 * (nesting is supported one level deep so `\frac{\frac{1}{2}}{3}` works), and
 * any `_`/`^` sub/superscripts. A subscript/superscript may be a brace group,
 * another command (`^\infty`) or a single token (`_0`, `^2`) — previously
 * `\int_0^\infty` was split because `^\infty` unmatched the trailing `\infty`.
 */
const MACRO_PATTERN =
  /\\[a-zA-Z]+\*?(?:\{(?:[^{}]|\{[^{}]*\})*\})*(?:[_^](?:\{(?:[^{}]|\{[^{}]*\})*\}|\\[a-zA-Z]+|[^\s{}]))*/;

/** Bare sub/superscripts typed without a command: `x^2`, `x_i^2` (both scripts
 *  in either order), `a_{n}`, `e^{-x}`, `e^\infty`, `10^{-3}`. Previously only
 *  `^` was recognized, so a question like `x_i^2` was wrapped as `x_$i^2$` —
 *  the subscript stayed as plain text and the formula rendered broken. */
const BARE_EXPONENT_PATTERN =
  /(?:[A-Za-z0-9\]]+|\([^()]*\))(?:[_^](?:\{[^{}]+\}|\\[a-zA-Z]+|-?[A-Za-z0-9]+)){1,2}/;

/** A whole `\begin{…} … \end{…}` block, rendered as display math. */
const ENVIRONMENT_PATTERN = /\\begin\{[^{}]*\}[\s\S]*?\\end\{[^{}]*\}/g;

/**
 * Combined matcher for a non-environment math fragment: a LaTeX command or a
 * bare exponent. `matchAll` consumes matches left-to-right, so a bare exponent
 * like `e^\infty` wins as a single atom instead of being split into `e^` + the
 * `\infty` symbol.
 */
const FRAGMENT_PATTERN = new RegExp(
  `${MACRO_PATTERN.source}|${BARE_EXPONENT_PATTERN.source}`,
  "g",
);

type MathAtom = { start: number; end: number; display: boolean; value?: string };

function commandName(source: string): string {
  const match = /^\\([a-zA-Z]+)/.exec(source);
  return match ? match[1] : "";
}

/** Characters that may sit between two adjacent math atoms and still merge. */
function isConnector(gap: string): boolean {
  return /^[\s+\-*/=<>()[\]{},.:;^_|]*$/.test(gap);
}

function findMathAtoms(text: string): MathAtom[] {
  const atoms: MathAtom[] = [];

  // Whole \begin{…}…\end{…} blocks first — they render as one display formula
  // and their inner commands must not be matched separately.
  for (const match of text.matchAll(ENVIRONMENT_PATTERN)) {
    atoms.push({
      start: match.index,
      end: match.index + match[0].length,
      display: true,
    });
  }

  // ASCII powers (`X**2` → `X^{2}`) as pre-converted atoms.
  for (const match of text.matchAll(ASCII_POWER_PATTERN)) {
    const start = match.index + match[1].length;
    const raw = match[2];
    atoms.push({
      start,
      end: start + raw.length,
      display: false,
      value: raw.replace(/\*\*((?:[A-Za-z0-9]+|\([^()]+\)))/g, "^{$1}"),
    });
  }

  for (const match of text.matchAll(FRAGMENT_PATTERN)) {
    if (atoms.some((atom) => match.index >= atom.start && match.index < atom.end)) {
      continue;
    }
    const value = match[0];
    // A command without braces or sub/superscript is only kept when its name is
    // a known symbol, so stray backslashes in prose aren't misread as math.
    if (value[0] === "\\") {
      const bare = !/[{}_^]/.test(value);
      if (bare && !BARE_SYMBOL_SET.has(commandName(value))) continue;
    } else {
      // Bare sub/superscript: only when it starts a word (the previous char is
      // not a letter/digit/underscore), so identifiers glued to the base are
      // not swallowed as math.
      const prev = text[match.index - 1];
      if (prev && /[A-Za-z0-9_]/.test(prev)) continue;
      // snake_case guard: `file_name` / `app_v2` (multi-letter base + a bare
      // word after `_`) is an identifier, not math. Single-letter bases with
      // `_` (`x_i`, `m_2`) or braced/command scripts (`a_{n}`) stay math.
      if (value.includes("_")) {
        const base = /^[A-Za-z0-9\]]+/.exec(value)?.[0] ?? "";
        const script = /_(?:\{[^{}]+\}|\\[a-zA-Z]+|-?[A-Za-z0-9]+)/.exec(value)?.[0] ?? "";
        if (
          base.length > 1 &&
          /[A-Za-z]/.test(base) &&
          /^[A-Za-z]/.test(script.slice(1))
        ) {
          continue;
        }
      }
    }
    atoms.push({
      start: match.index,
      end: match.index + value.length,
      display: false,
    });
  }

  return atoms.sort((a, b) => a.start - b.start);
}

function mergeAtoms(atoms: MathAtom[], text: string): MathAtom[] {
  const runs: MathAtom[] = [];
  for (const atom of atoms) {
    const last = runs[runs.length - 1];
    if (
      last &&
      !last.display &&
      !atom.display &&
      isConnector(text.slice(last.end, atom.start))
    ) {
      const gap = text.slice(last.end, atom.start);
      if (last.value !== undefined || atom.value !== undefined) {
        last.value =
          (last.value ?? text.slice(last.start, last.end)) + gap +
          (atom.value ?? text.slice(atom.start, atom.end));
      }
      last.end = atom.end;
    } else {
      runs.push({ ...atom });
    }
  }
  return runs;
}

function rebuild(text: string, runs: MathAtom[]): string {
  let out = "";
  let lastIndex = 0;
  for (const run of runs) {
    out += text.slice(lastIndex, run.start);
    const content = run.value ?? text.slice(run.start, run.end);
    out += run.display ? `$$${content}$$` : `$${content}$`;
    lastIndex = run.end;
  }
  return out + text.slice(lastIndex);
}

/**
 * "Corrects" a raw question by wrapping any bare LaTeX in `$…$` (`$$…$$` for
 * `\begin…\end` blocks) so it renders with MathJax exactly like the answer
 * does. It runs while the model is still thinking and again whenever a saved
 * dialog is re-opened, because the stored text is corrected on the fly instead
 * of being rewritten in storage.
 *
 * Already-delimited math (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`) is left untouched,
 * but bare math *outside* those delimiters is still wrapped, so mixed input
 * (`Compute $\int x\,dx$ plus \frac{1}{2}`) renders both parts correctly.
 */
export function autoDelimitRawLatex(text: string): string {
  // An odd number of `$$` means the text was cut off mid-formula (e.g. a
  // truncated answer). MathJax cannot render the dangling delimiter, and
  // wrapping bare atoms inside it produced garbage like `$$$…${2` — leave
  // the text exactly as-is in that case.
  const displayDelimiters = text.match(/\$\$/g)?.length ?? 0;
  if (displayDelimiters % 2 !== 0) return text;

  const protectedRanges: { start: number; end: number }[] = [];
  for (const match of text.matchAll(MATH_PATTERN)) {
    protectedRanges.push({
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  const atoms = findMathAtoms(text).filter(
    (atom) =>
      !protectedRanges.some((range) => atom.start >= range.start && atom.start < range.end),
  );
  if (atoms.length === 0) return text;

  return rebuild(text, mergeAtoms(atoms, text));
}

/** True when a math segment renders as a display block (`$$…$$` / `\[…\]`). */
export function isDisplayMath(segment: MathSegment): boolean {
  return segment.value.startsWith("$$") || segment.value.startsWith("\\[");
}
