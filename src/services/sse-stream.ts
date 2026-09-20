/**
 * Incremental SSE parsing + chat-answer accumulation for streaming OpenRouter
 * requests. Pure TypeScript (no expo/react imports) so `npm test` can run it
 * directly under node — see tests/unit/sse-stream.test.mjs.
 *
 * Why streaming exists here: a non-streaming `:flex` request sits idle for
 * 30-120s before the first byte arrives, and any hop in the chain (Android
 * network stack, VPN relay, provider front-end) can cut such a silent
 * connection — that produced the "JSON Parse error: Unexpected end of input"
 * and "The operation was aborted" failures. With `stream: true` OpenRouter
 * ships keep-alive comment bytes while the model queues, so data flows the
 * whole time and an IDLE timeout (reset on every chunk) replaces the fragile
 * total-request timer.
 */

/**
 * Decodes UTF-8 byte chunks that may split multi-byte characters (or even a
 * single byte of one character) across network boundaries. Uses the native
 * TextDecoder when present, with a dependency-free fallback for runtimes
 * that lack it (Hermes builds without the polyfill).
 */
export class Utf8ChunkDecoder {
  private native: TextDecoder | null =
    typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
  private pending: number[] = [];

  push(bytes: Uint8Array): string {
    if (this.native) return this.native.decode(bytes, { stream: true });
    const all = this.pending.length
      ? this.pending.concat(Array.from(bytes))
      : Array.from(bytes);
    let out = "";
    let i = 0;
    while (i < all.length) {
      const b = all[i];
      let seq = 0;
      let codePoint = 0;
      if (b < 0x80) {
        seq = 1;
        codePoint = b;
      } else if ((b & 0xe0) === 0xc0) {
        seq = 2;
        codePoint = b & 0x1f;
      } else if ((b & 0xf0) === 0xe0) {
        seq = 3;
        codePoint = b & 0x0f;
      } else if ((b & 0xf8) === 0xf0) {
        seq = 4;
        codePoint = b & 0x07;
      } else {
        i += 1; // stray byte — drop it
        continue;
      }
      if (i + seq > all.length) break; // incomplete sequence — wait for more
      let ok = true;
      for (let k = 1; k < seq; k += 1) {
        const continuation = all[i + k];
        if ((continuation & 0xc0) !== 0x80) {
          ok = false;
          break;
        }
        codePoint = (codePoint << 6) | (continuation & 0x3f);
      }
      if (!ok) {
        i += 1;
        continue;
      }
      i += seq;
      out += String.fromCodePoint(codePoint);
    }
    this.pending = all.slice(i);
    return out;
  }

  /** Call at end of stream to decode any buffered tail (best effort). */
  flush(): string {
    if (this.native) return this.native.decode();
    const tail = this.pending;
    this.pending = [];
    if (tail.length === 0) return "";
    let out = "";
    for (const b of tail) {
      // Broken tail — emit U+FFFD replacement characters, one per byte.
      out += b < 0x80 ? String.fromCodePoint(b) : "\uFFFD";
    }
    return out;
  }
}

export type StreamedUsage = Record<string, unknown>;

export type StreamedCompletion = {
  id: string;
  model: string;
  provider?: string;
  finish_reason: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: string;
  }>;
  usage?: StreamedUsage;
};

/**
 * Accumulates the `data:` payloads of an OpenRouter chat SSE stream and
 * assembles a ChatCompletion-shaped result. Feed every network chunk into
 * `push` (plus one final `flush`); it returns the visible content deltas.
 */
export class SseChatAccumulator {
  content = "";
  finished = false;
  usage: StreamedUsage | null = null;
  meta: { id?: string; model?: string; provider?: string } = {};
  finishReason = "";

  private buffer = "";
  private dataLines: string[] = [];

  /** Feeds newly arrived text; returns the content deltas it produced. */
  push(text: string): string[] {
    this.buffer += text;
    const deltas: string[] = [];
    let newlineAt = this.buffer.indexOf("\n");
    while (newlineAt !== -1) {
      let line = this.buffer.slice(0, newlineAt);
      this.buffer = this.buffer.slice(newlineAt + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const delta = this.handleLine(line);
      if (delta) deltas.push(delta);
      newlineAt = this.buffer.indexOf("\n");
    }
    return deltas;
  }

  /** Call once at end of stream: processes a trailing line without newline
   *  and dispatches a final event that never got its blank-line terminator. */
  flush(): string[] {
    const deltas: string[] = [];
    if (this.buffer !== "") {
      const line = this.buffer;
      this.buffer = "";
      const delta = this.handleLine(line);
      if (delta) deltas.push(delta);
    }
    if (this.dataLines.length > 0) {
      const data = this.dataLines.join("\n");
      this.dataLines = [];
      const delta = this.dispatchData(data);
      if (delta) deltas.push(delta);
    }
    return deltas;
  }

  private handleLine(line: string): string | null {
    if (line === "") {
      // Blank line = end of one SSE event.
      if (this.dataLines.length === 0) return null;
      const data = this.dataLines.join("\n");
      this.dataLines = [];
      return this.dispatchData(data);
    }
    if (line.startsWith(":")) return null; // keep-alive comment
    if (line.startsWith("data:")) {
      this.dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    return null; // other SSE fields (event:, id:, retry:) don't matter here
  }

  private dispatchData(data: string): string | null {
    if (data === "[DONE]") {
      this.finished = true;
      return null;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return null; // tolerate junk — the next complete event still lands
    }
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.id === "string" && parsed.id) this.meta.id = parsed.id;
    if (typeof parsed.model === "string" && parsed.model) {
      this.meta.model = parsed.model;
    }
    if (
      typeof parsed.provider === "string" &&
      parsed.provider &&
      !this.meta.provider
    ) {
      this.meta.provider = parsed.provider;
    }
    if (parsed.usage && typeof parsed.usage === "object") {
      this.usage = parsed.usage as StreamedUsage;
    }
    if (typeof parsed.finish_reason === "string" && parsed.finish_reason) {
      this.finishReason = parsed.finish_reason;
    }
    const choices = parsed.choices as
      | Array<Record<string, unknown>>
      | undefined;
    const choice = choices?.[0];
    if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
      this.finishReason = choice.finish_reason;
    }
    const delta = choice?.delta as Record<string, unknown> | undefined;
    const content = delta?.content;
    if (typeof content === "string" && content.length > 0) {
      this.content += content;
      return content;
    }
    return null;
  }

  /** Shape-compatible with ChatCompletion (callers add `raw`). */
  toCompletion(): StreamedCompletion {
    const finish = this.finishReason || "stop";
    return {
      id: this.meta.id ?? "",
      model: this.meta.model ?? "",
      provider: this.meta.provider,
      finish_reason: finish,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: this.content },
          finish_reason: finish,
        },
      ],
      ...(this.usage ? { usage: this.usage } : {}),
    };
  }
}
