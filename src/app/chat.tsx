import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/animated-pressable";
import { ChatDrawer } from "@/components/chat-drawer";
import { MathAnswer } from "@/components/math-answer";
import { autoDelimitRawLatex } from "@/components/math-segments";
import { ModelPickerModal } from "@/components/model-picker-modal";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useI18n } from "@/i18n";
import { getSyncSettings, runSync } from "@/services/sync";
import {
    formatCost,
    formatMessageDate,
    hasReplyMetadata,
    metadataLabel,
} from "@/services/message-meta";
import type { ChatMessage, Dialog } from "@/services/sync-mapping";
import {
    chat,
    formatQuestionLatex,
    OPENROUTER_MODEL,
    type OpenRouterMessage,
    type ReasoningEffort,
    withFlexSuffix,
} from "@/services/openrouter";
import { loadJSON, loadString, saveJSON, saveString } from "@/services/storage";
import {
    resolveTavilyApiKey,
    searchWeb,
    webSearchContext,
} from "@/services/tavily";

/** Below this width we treat the screen as a phone (vs. tablet/desktop). */
const PHONE_WIDTH_BREAKPOINT = 768;

/** True for fetch/network failures (offline), as opposed to API/HTTP errors. */
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /network request failed|failed to fetch|no internet/i.test(message);
}

const DIALOGS_STORAGE_KEY = "openrouter.dialogs.v1";
const ACTIVE_DIALOG_STORAGE_KEY = "openrouter.active-dialog.v1";
const REASONING_STORAGE_KEY = "openrouter.reasoning-effort.v1";
/** Flex processing-tier toggle (🧊 chip): appends `:flex` to the model on send. */
const FLEX_STORAGE_KEY = "openrouter.flex-mode.v1";
// Default model for newly created dialogs: updated whenever you pick a
// different model in the picker, so new chats start with your last choice.
const DEFAULT_MODEL_STORAGE_KEY = "openrouter.default-model.v1";
const LEGACY_STORAGE_KEY = "openrouter.chat.v1";
/** Hard ceiling on how many messages are kept / persisted per dialog. */
const MAX_MESSAGES = 120;
/** How much recent context is sent in a request. */
const HISTORY_WINDOW = 20;

const SYSTEM_PROMPT =
  "You are a helpful assistant. Write mathematical formulas as LaTeX, using " +
  "$$...$$ for display math and \\(...\\) for inline math.";

/** The model has no clock — tell it the device's real date/time so questions
 * like "what time is it now" don't get answered from training data or from
 * whatever time a fetched web page happens to mention. */
function currentDateTimePrompt(): string {
  const now = new Date();
  const formatted = now.toLocaleString([], {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    `Current date and time: ${formatted} (${Intl.DateTimeFormat().resolvedOptions().timeZone}) — ` +
    "the reliable device clock. Answer questions about the current time, " +
    "date, or day of the week from this — never from web snippets or " +
    "training data."
  );
}

/** Adapter: the local ChatMessage (camelCase) → message-meta's structural
 * source (server-style snake_case), so live replies and synced ones share
 * one caption formatter. */
function metaSource(message: ChatMessage) {
  return {
    model: message.model ?? null,
    tokens_prompt: message.tokensPrompt ?? null,
    tokens_completion: message.tokensCompletion ?? null,
    total_tokens: message.totalTokens ?? null,
    cost: message.cost ?? null,
    provider: message.provider ?? null,
    createdAt: message.createdAt ?? null,
  };
}

/** True when an assistant bubble gets the ⓘ stats chip. */
function hasMetadata(message: ChatMessage): boolean {
  return (
    hasReplyMetadata(metaSource(message)) ||
    Boolean(message.reasoning) ||
    Boolean(message.genId)
  );
}

/** One-line caption under an assistant bubble, e.g.
 * "12.09.26 14:03 · deepseek-v4 🧊 · 1.2k tok · $0.0123". */
function metaCaption(message: ChatMessage): string {
  return metadataLabel(metaSource(message)) ?? "";
}

let counter = 0;
function makeId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

/** Derive a short title from the first user message ('' when none yet). */
function titleFromMessages(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "";
  const cleaned = first.content.replace(/\s+/g, " ").trim();
  return cleaned.length > 42 ? `${cleaned.slice(0, 42)}…` : cleaned;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const day = date.toLocaleDateString([], { month: "short", day: "numeric" });
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} ${time}`;
}

export default function ChatScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const safeAreaInsets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isPhoneView = windowWidth < PHONE_WIDTH_BREAKPOINT;
  const insets = {
    ...safeAreaInsets,
    bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
  };

  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  // Reasoning effort (thinking budget): '' = model default. Cycled by the
  // 🧠 chip in the composer and persisted across app restarts.
  const [reasoning, setReasoning] = useState<ReasoningEffort | "">("");
  // Flex processing tier (like the web UI's 🧊 Flex): cheaper/slower; the
  // service falls back to the standard tier automatically when unsupported.
  const [flexOn, setFlexOn] = useState(false);
  // Your preferred default model for new dialogs (persisted; falls back to
  // OPENROUTER_MODEL until you pick one for the first time).
  const [defaultModel, setDefaultModel] = useState(OPENROUTER_MODEL);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  // 🔄 Retry: while set, the model picker re-answers this assistant message
  // on the server with the picked model instead of switching the dialog model.
  const [retryTarget, setRetryTarget] = useState<ChatMessage | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // ✏️ Edit: the user question being edited and the modal's text draft.
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeDialog = dialogs.find((dialog) => dialog.id === activeId) ?? null;
  const messages = activeDialog?.messages ?? [];
  const model = activeDialog?.model ?? OPENROUTER_MODEL;

  // Restore the dialog list (migrating the old single conversation, if any).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const savedReasoning = await loadString(REASONING_STORAGE_KEY);
      let list = await loadJSON<Dialog[] | null>(DIALOGS_STORAGE_KEY, null);
      if (!Array.isArray(list)) {
        list = [];
        const legacy = await loadJSON<{
          messages?: ChatMessage[];
          model?: string;
        } | null>(LEGACY_STORAGE_KEY, null);
        if (legacy?.messages?.length) {
          const migrated = legacy.messages.slice(-MAX_MESSAGES);
          const now = Date.now();
          list.push({
            id: makeId(),
            title: titleFromMessages(migrated),
            model:
              typeof legacy.model === "string" && legacy.model
                ? legacy.model
                : OPENROUTER_MODEL,
            messages: migrated,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
      const lastActiveId = await loadString(ACTIVE_DIALOG_STORAGE_KEY);
      if (cancelled) return;
      if (
        savedReasoning === "none" || savedReasoning === "low" ||
        savedReasoning === "medium" || savedReasoning === "high" ||
        savedReasoning === "xhigh" || savedReasoning === "max"
      ) {
        setReasoning(savedReasoning);
      }
      const savedFlex = await loadString(FLEX_STORAGE_KEY);
      if (cancelled) return;
      if (savedFlex === "1") setFlexOn(true);
      const savedDefaultModel = await loadString(DEFAULT_MODEL_STORAGE_KEY);
      if (cancelled) return;
      if (savedDefaultModel) setDefaultModel(savedDefaultModel);
      setDialogs(list);
      const restoredId =
        lastActiveId && list.some((dialog) => dialog.id === lastActiveId)
          ? lastActiveId
          : null;
      setActiveId(restoredId);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist every change (only after the initial load to avoid overwriting).
  useEffect(() => {
    if (!hydrated) return;
    void saveJSON(DIALOGS_STORAGE_KEY, dialogs);
  }, [dialogs, hydrated]);

  // Silent sync-on-start (paired devices only): server tombstones are applied
  // immediately — dialogs deleted on any device disappear from this one too,
  // without pressing "Sync now" — and anything new is pulled. Failures
  // (offline, unpaired) are silently ignored; local state stays as-is.
  useEffect(() => {
    if (!hydrated) return;
    void (async () => {
      try {
        const settings = await getSyncSettings();
        if (!settings) return;
        await runSync();
        const list = await loadJSON<Dialog[] | null>(DIALOGS_STORAGE_KEY, null);
        if (!Array.isArray(list)) return;
        setDialogs(list);
        setActiveId((current) =>
          current && list.some((dialog) => dialog.id === current) ? current : null);
      } catch {
        // Keep local state on any sync problem.
      }
    })();
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    void saveString(ACTIVE_DIALOG_STORAGE_KEY, activeId ?? "");
  }, [activeId, hydrated]);

  // Persist the reasoning effort so it survives app restarts.
  useEffect(() => {
    if (!hydrated) return;
    void saveString(REASONING_STORAGE_KEY, reasoning);
  }, [reasoning, hydrated]);

  // Persist the Flex toggle so it survives app restarts.
  useEffect(() => {
    if (!hydrated) return;
    void saveString(FLEX_STORAGE_KEY, flexOn ? "1" : "0");
  }, [flexOn, hydrated]);



  /** Full per-message metadata popup: exact model, reasoning effort,
   * provider, generation id and the prompt/completion token split + cost. */
  const showMessageMetadata = (message: ChatMessage) => {
    const lines: string[] = [];
    if (message.model) lines.push(`${t("chat.metaModel")}: ${message.model}`);
    if (message.reasoning) lines.push(`${t("chat.metaReasoning")}: ${message.reasoning}`);
    if (message.provider) lines.push(`${t("chat.metaProvider")}: ${message.provider}`);
    if (message.genId) lines.push(`${t("chat.metaGeneration")}: ${message.genId}`);
    if (
      message.tokensPrompt != null ||
      message.tokensCompletion != null ||
      message.totalTokens != null
    ) {
      const prompt = message.tokensPrompt ?? "—";
      const completion = message.tokensCompletion ?? "—";
      const total = message.totalTokens ?? "—";
      lines.push(
        `${t("chat.metaTokens")}: ${total}\n` +
          `  ${t("chat.metaPrompt")}: ${prompt}\n` +
          `  ${t("chat.metaCompletion")}: ${completion}`,
      );
    }
    const cost = formatCost(message.cost);
    if (cost) lines.push(`${t("chat.metaCost")}: ${cost}`);
    Alert.alert(t("chat.metaTitle"), lines.join("\n"));
  };

  /** 🧠 chip: cycle Default → None → Low → Medium → High → XHigh → Max. */
  const cycleReasoning = () => {
    const levels: Array<ReasoningEffort | ""> = [
      "", "none", "low", "medium", "high", "xhigh", "max",
    ];
    const next = levels[(levels.indexOf(reasoning) + 1) % levels.length];
    setReasoning(next);
  };

  /** Fire-and-forget background sync: runs a moment after a send/retry
   * finishes, pushes the fresh Q/A up and reloads the dialog list when it
   * lands — new messages get their server ids (so 🔄/✏️/✕ work right away)
   * without blocking the UI or popping errors. Retries a few times with
   * growing delays so transient network blips still catch up in the
   * background instead of leaving the message unsynced. */
  const backgroundSync = (delayMs = 600, attempts = 3) => {
    setTimeout(() => {
      void (async () => {
        try {
          await runSync();
          const list = await loadJSON<Dialog[] | null>(DIALOGS_STORAGE_KEY, null);
          if (Array.isArray(list)) {
            setDialogs(list);
            setActiveId((current) =>
              current && list.some((dialog) => dialog.id === current) ? current : null);
          }
        } catch {
          // Background best-effort: keep retrying quietly, then surface on
          // the next sync (manual or after the next send).
          if (attempts > 1) backgroundSync(delayMs * 4, attempts - 1);
        }
      })();
    }, delayMs);
  };

  /** Push + pull once and reload the dialog list from storage (keeping the
   * open dialog selected). Returns the fresh dialog list, or null on failure.
   * Used to give brand-new live-chat messages their server ids on demand, so
   * 🔄/✏️/✕ work right away without a manual "Sync now". */
  const syncAndReload = async (): Promise<Dialog[] | null> => {
    const settings = await getSyncSettings();
    if (!settings) {
      Alert.alert(t("common.failed"), t("chat.deleteNoServer"));
      return null;
    }
    try {
      // One silent retry: transient network blips shouldn't dead-end the
      // user with "not synced" — the background sync catches up anyway.
      try {
        await runSync();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await runSync();
      }
      const list = await loadJSON<Dialog[] | null>(DIALOGS_STORAGE_KEY, null);
      if (Array.isArray(list)) {
        setDialogs(list);
        setActiveId((current) =>
          current && list.some((dialog) => dialog.id === current) ? current : null);
        return list;
      }
      return null;
    } catch (error) {
      Alert.alert(
        t("common.failed"),
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  };

  /** A sync pull regenerates local message ids, so re-find the tapped message
   * in the fresh list (same role + text, closest to its old position) to get
   * its server copy. */
  const resolveSyncedMessage = (
    list: Dialog[],
    dialogId: string | null,
    tapped: ChatMessage,
    index: number,
  ): ChatMessage | null => {
    const dialog = list.find((d) => d.id === dialogId);
    if (!dialog) return null;
    const candidates = dialog.messages
      .map((m, i) => ({ message: m, i }))
      .filter(
        ({ message }) =>
          message.role === tapped.role &&
          message.content === tapped.content &&
          message.serverId,
      );
    if (!candidates.length) return null;
    candidates.sort((a, b) => Math.abs(a.i - index) - Math.abs(b.i - index));
    return candidates[0].message;
  };

  /** Delete one Q/A: tombstones it on the master server (so the web and all
   *  other devices drop it too) and removes it from the local dialog. A never
   *  -synced message (no server id after a sync attempt) is removed locally —
   *  the server never saw it, so the next background push converges. */
  const handleDeleteMessage = async (message: ChatMessage, index: number) => {
    const removeLocal = () =>
      setDialogs((current) =>
        current.map((dialog) =>
          dialog.id === activeId
            ? { ...dialog, messages: dialog.messages.filter((m) => m.id !== message.id) }
            : dialog,
        ),
      );
    let target = message;
    if (!target.serverId) {
      const list = await syncAndReload();
      const found = list ? resolveSyncedMessage(list, activeId, message, index) : null;
      if (found?.serverId) {
        target = found;
      } else if (!list) {
        // Server unreachable: the message most likely never made it up —
        // don't block the user, remove locally and sync in the background.
        removeLocal();
        backgroundSync();
        return;
      } else {
        Alert.alert(
          t("common.delete"),
          t("chat.deleteNeedsSync") ||
            "This message is not synced yet — sync once, then delete.",
        );
        return;
      }
    }
    Alert.alert(
      t("common.delete"),
      t("chat.messageDeleteConfirm", { message: target.content.slice(0, 60) }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                if (!target.serverId) {
                  // Never synced: local removal only, background push carries
                  // the dialog state without it.
                  removeLocal();
                  backgroundSync();
                  return;
                }
                const settings = await getSyncSettings();
                if (!settings) throw new Error(t("chat.deleteNoServer"));
                const resp = await fetch(
                  `${settings.serverUrl}/api/sync/dialogs/${activeId}/messages/${target.serverId}`,
                  { method: "DELETE", headers: { Authorization: `Bearer ${settings.token}` } },
                );
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                removeLocal();
                backgroundSync();
              } catch (error) {
                Alert.alert(
                  t("common.failed"),
                  error instanceof Error ? error.message : String(error),
                );
              }
            })();
          },
        },
      ],
    );
  };

  /** 🔄 chip: open the model picker in retry mode for this answer or question.
   * Not synced yet (fresh live-chat message)? Sync once on the spot, then
   * continue with the server copy. */
  const startRetry = async (message: ChatMessage, index: number) => {
    let target = message;
    if (!target.serverId) {
      const list = await syncAndReload();
      if (!list) return;
      const found = resolveSyncedMessage(list, activeId, message, index);
      if (!found?.serverId) {
        Alert.alert(t("common.failed"), t("chat.retryNeedsSync"));
        return;
      }
      target = found;
    }
    setRetryTarget(target);
    setModelPickerOpen(true);
  };

  /** ✏️ chip: open the edit modal for one of your own questions. Not synced
   * yet (fresh live-chat message)? Sync once on the spot, then edit. */
  const startEdit = async (message: ChatMessage, index: number) => {
    let target = message;
    if (!target.serverId) {
      const list = await syncAndReload();
      if (!list) return;
      const found = resolveSyncedMessage(list, activeId, message, index);
      if (!found?.serverId) {
        Alert.alert(t("common.failed"), t("chat.editNeedsSync"));
        return;
      }
      target = found;
    }
    setEditText(target.content);
    setEditing(target);
  };

  /** Save the edited question: PATCHes it on the master server (the old
   * wording is tombstoned there, so stale pushes can't resurrect it) and
   * updates the local copy. Then 🔄 on the edited question re-answers it. */
  const performEdit = async () => {
    const message = editing;
    if (!activeId || !message?.serverId || savingEdit) return;
    const text = editText.trim();
    if (!text) return;
    if (text === message.content) {
      setEditing(null);
      return;
    }
    const settings = await getSyncSettings();
    if (!settings) {
      Alert.alert(t("common.failed"), t("chat.deleteNoServer"));
      return;
    }
    setSavingEdit(true);
    try {
      const resp = await fetch(
        `${settings.serverUrl}/api/sync/dialogs/${activeId}/messages/${message.serverId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.token}`,
          },
          body: JSON.stringify({ content: text }),
        },
      );
      if (!resp.ok) {
        let detail = `HTTP ${resp.status}`;
        try {
          const data = (await resp.json()) as { detail?: string };
          if (data.detail) detail = data.detail;
        } catch {}
        throw new Error(detail);
      }
      setDialogs((current) =>
        current.map((dialog) =>
          dialog.id === activeId
            ? {
                ...dialog,
                updatedAt: Date.now(),
                messages: dialog.messages.map((m) =>
                  m.id === message.id
                    ? { ...m, content: text, latexContent: undefined }
                    : m,
                ),
              }
            : dialog,
        ),
      );
      setEditing(null);
    } catch (error) {
      Alert.alert(
        t("common.failed"),
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSavingEdit(false);
    }
  };

  /** Re-answer one assistant message on the server with another model: the
   * server re-asks the same question (context up to it) and stores the fresh
   * answer right after the original, so every synced device sees it there. */
  const performRetry = async (message: ChatMessage, retryModel: string) => {
    if (!activeId || !message.serverId) return;
    const settings = await getSyncSettings();
    if (!settings) {
      Alert.alert(t("common.failed"), t("chat.deleteNoServer"));
      return;
    }
    setRetryingId(message.id);
    try {
      const resp = await fetch(`${settings.serverUrl}/api/chat/retry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.token}`,
        },
        body: JSON.stringify({
          external_id: activeId,
          message_id: message.serverId,
          // Flex tier works here too: the server understands the ":flex"
          // suffix and falls back to the standard tier when unsupported.
          models: [flexOn ? withFlexSuffix(retryModel) : retryModel],
          ...(reasoning ? { reasoning_effort: reasoning } : {}),
        }),
      });
      if (!resp.ok) {
        let detail = `HTTP ${resp.status}`;
        try {
          const data = (await resp.json()) as { detail?: string };
          if (data.detail) detail = data.detail;
        } catch {}
        throw new Error(detail);
      }
      const data = (await resp.json()) as {
        responses: {
          ok: boolean;
          model: string;
          content?: string | null;
          error?: string | null;
          message_id?: number | null;
          reasoning?: string | null;
          provider?: string | null;
          gen_id?: string | null;
          tokens_prompt?: number | null;
          tokens_completion?: number | null;
          total_tokens?: number | null;
          cost?: number | null;
        }[];
      };
      const fresh: ChatMessage[] = data.responses.map((r) => ({
        id: makeId(),
        role: "assistant" as const,
        content: r.ok ? (r.content ?? "") : (r.error ?? "Retry failed"),
        error: !r.ok,
        serverId: r.message_id ?? undefined,
        createdAt: Date.now(),
        // Exact model that served the retried answer (server reports it).
        model: r.model ?? null,
        reasoning: r.reasoning ?? null,
        provider: r.provider ?? null,
        genId: r.gen_id ?? null,
        tokensPrompt: r.tokens_prompt ?? null,
        tokensCompletion: r.tokens_completion ?? null,
        totalTokens: r.total_tokens ?? null,
        cost: r.cost ?? null,
      }));
      setDialogs((current) =>
        current.map((dialog) => {
          if (dialog.id !== activeId || fresh.length === 0) return dialog;
          const idx = dialog.messages.findIndex((m) => m.id === message.id);
          const next = [...dialog.messages];
          if (idx >= 0) next.splice(idx + 1, 0, ...fresh);
          else next.push(...fresh);
          return {
            ...dialog,
            messages: next.slice(-MAX_MESSAGES),
            updatedAt: Date.now(),
          };
        }),
      );
    } catch (error) {
      Alert.alert(
        t("common.failed"),
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setRetryingId(null);
      setRetryTarget(null);
      // Fire-and-forget: nothing to push for a server-side retry, but pull
      // (and refresh account info) so other devices see the new answer.
      backgroundSync();
    }
  };

  // Clear the copy feedback timer when the screen unmounts.
  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const handleNew = () => {
    const now = Date.now();
    const dialog: Dialog = {
      id: makeId(),
      title: "",
      model: defaultModel,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    setDialogs((current) => [...current, dialog]);
    setActiveId(dialog.id);
    setInput("");
    setModelPickerOpen(false);
    setTitleDraft(null);
  };

  const openDialog = (id: string) => {
    setActiveId(id);
    setModelPickerOpen(false);
    setTitleDraft(null);
  };

  const goBack = () => {
    setActiveId(null);
    setModelPickerOpen(false);
    setTitleDraft(null);
  };

  const handleDrawerClose = () => setDrawerOpen(false);

  const handleDrawerSelect = (id: string) => {
    openDialog(id);
    setDrawerOpen(false);
  };

  const handleDrawerNew = () => {
    handleNew();
    setDrawerOpen(false);
  };

  const handleDrawerDelete = (id: string) => {
    Alert.alert(t("chat.delete"), t("chat.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          setDialogs((current) => current.filter((dialog) => dialog.id !== id));
          if (id === activeId) setActiveId(null);
        },
      },
    ]);
  };

  const setActiveModel = (id: string) => {
    // Remember the choice as the default for future new dialogs.
    setDefaultModel(id);
    void saveString(DEFAULT_MODEL_STORAGE_KEY, id);
    setDialogs((current) =>
      current.map((dialog) =>
        dialog.id === activeId
          ? { ...dialog, model: id, updatedAt: Date.now() }
          : dialog,
      ),
    );
  };

  const startRenaming = () => setTitleDraft(activeDialog?.title ?? "");

  const saveRenaming = () => {
    if (titleDraft !== null && activeId) {
      const trimmed = titleDraft.trim();
      setDialogs((current) =>
        current.map((dialog) =>
          dialog.id === activeId ? { ...dialog, title: trimmed } : dialog,
        ),
      );
    }
    setTitleDraft(null);
  };

  const handleDelete = () => {
    if (!activeId) return;
    Alert.alert(t("chat.delete"), t("chat.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          setDialogs((current) =>
            current.filter((dialog) => dialog.id !== activeId),
          );
          setActiveId(null);
        },
      },
    ]);
  };

  const handleClear = () => {
    if (!activeId) return;
    Alert.alert(t("chat.clear"), t("chat.clearConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("chat.clear"),
        style: "destructive",
        onPress: () => {
          setDialogs((current) =>
            current.map((dialog) =>
              dialog.id === activeId
                ? { ...dialog, messages: [], title: "", updatedAt: Date.now() }
                : dialog,
            ),
          );
        },
      },
    ]);
  };

  const correctQuestionLatex = async (
    id: string,
    raw: string,
    model: string,
  ) => {
    try {
      const corrected = await formatQuestionLatex(raw, model);
      const cleaned = corrected
        .replace(/^```(?:latex|tex)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();
      if (!cleaned || cleaned === raw) return;
      setDialogs((current) =>
        current.map((dialog) => ({
          ...dialog,
          messages: dialog.messages.map((message) =>
            message.id === id
              ? { ...message, latexContent: cleaned }
              : message,
          ),
        })),
      );
    } catch (error) {
      // Best-effort: if correction is offline/slow, keep the raw question.
      console.warn("[chat] latex correction failed", error);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || !activeId) return;

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    const currentMessages = activeDialog?.messages ?? [];
    const nextMessages = [...currentMessages, userMessage].slice(-MAX_MESSAGES);
    const nextTitle = activeDialog?.title || titleFromMessages(nextMessages);

    setDialogs((current) =>
      current.map((dialog) =>
        dialog.id === activeId
          ? {
              ...dialog,
              messages: nextMessages,
              title: nextTitle,
              updatedAt: Date.now(),
            }
          : dialog,
      ),
    );
    setInput("");
    setSending(true);
    // Correct the asking bubble with LaTeX while the answer is being generated.
    void correctQuestionLatex(userMessage.id, text, model);

    const history: OpenRouterMessage[] = nextMessages
      .slice(-HISTORY_WINDOW)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    try {
      const webResults = (await resolveTavilyApiKey())
        ? await searchWeb(text, {
            maxResults: 3,
            searchDepth: "basic",
            includeAnswer: true,
          }).catch((error: unknown) => {
            // Offline on a phone: let the user search directly on tavily.com.
            if (isPhoneView && isNetworkError(error)) {
              void WebBrowser.openBrowserAsync("https://tavily.com");
            }
            return [];
          })
        : [];

      const requestMessages: OpenRouterMessage[] = [
        {
          role: "system",
          content: `${currentDateTimePrompt()}\n\n${SYSTEM_PROMPT}${
            webResults.length
              ? `\n\nUse the most relevant web context below when answering.\n\n${webSearchContext(text, webResults)}`
              : ""
          }`,
        },
        ...history,
      ];

      const completion = await chat(requestMessages, {
        model: flexOn ? withFlexSuffix(model) : model,
        ...(reasoning ? { reasoning } : {}),
        timeoutMs: 120_000,
      });
      const reply = completion.choices?.[0]?.message?.content;
      if (!reply || !reply.trim())
        throw new Error(t("chat.emptyResponse"));
      // Cache warm-up is now opt-in only (🔥 Cache toggle on the server web
      // UI) — no automatic pings from the phone.
      const replyMessage: ChatMessage = {
        id: makeId(),
        role: "assistant",
        content: reply,
        createdAt: Date.now(),
        // Exact serving model as OpenRouter reports it (carries ":flex" when
        // the flex tier answered) — shown in the ⓘ details popup.
        model: completion.model || (flexOn ? withFlexSuffix(model) : model),
        // Per-message OpenRouter metadata (reasoning effort the user chose,
        // plus the serving provider + exact usage/cost from the response).
        reasoning: reasoning || null,
        provider: completion.provider ?? null,
        genId: completion.id ?? null,
        tokensPrompt: completion.usage?.prompt_tokens ?? null,
        tokensCompletion: completion.usage?.completion_tokens ?? null,
        totalTokens: completion.usage?.total_tokens ?? null,
        cost: typeof completion.usage?.cost === "number" ? completion.usage.cost : null,
      };
      setDialogs((current) =>
        current.map((dialog) =>
          dialog.id === activeId
            ? {
                ...dialog,
                messages: [...dialog.messages, replyMessage].slice(
                  -MAX_MESSAGES,
                ),
                updatedAt: Date.now(),
              }
            : dialog,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorMessage: ChatMessage = {
        id: makeId(),
        role: "assistant",
        content: message,
        error: true,
      };
      setDialogs((current) =>
        current.map((dialog) =>
          dialog.id === activeId
            ? {
                ...dialog,
                messages: [...dialog.messages, errorMessage].slice(
                  -MAX_MESSAGES,
                ),
                updatedAt: Date.now(),
              }
            : dialog,
        ),
      );
    } finally {
      setSending(false);
      // Fire-and-forget: push the fresh Q/A to the server in the background.
      backgroundSync();
    }
  };

  const handleCopy = async (content: string, id: string) => {
    await Clipboard.setStringAsync(content);
    setCopiedId(id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedId(null), 1600);
  };

  const contentPlatformStyle = {
    paddingTop: insets.top,
    paddingLeft: insets.left,
    paddingRight: insets.right,
  };

  const sortedDialogs = [...dialogs].sort((a, b) => b.updatedAt - a.updatedAt);
  const searchQuery = search.trim().toLowerCase();
  const filteredDialogs = searchQuery
    ? sortedDialogs.filter((dialog) =>
        `${dialog.title} ${dialog.messages.map((m) => m.content).join(" ")}`
          .toLowerCase()
          .includes(searchQuery),
      )
    : sortedDialogs;

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.inner}>
        {activeDialog ? (
          <>
            <View style={[styles.header, contentPlatformStyle]}>
              <View style={styles.headerLeft}>
                <Pressable
                  onPress={() => setDrawerOpen(true)}
                  hitSlop={8}
                  style={styles.menuButton}
                  accessibilityRole="button"
                  accessibilityLabel={t("chat.dialogs")}
                >
                  <ThemedText style={styles.menuIcon}>☰</ThemedText>
                </Pressable>
                <Pressable
                  onPress={goBack}
                  hitSlop={8}
                  style={styles.backButton}
                >
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    ‹ {t("chat.back")}
                  </ThemedText>
                </Pressable>
                {titleDraft !== null ? (
                  <TextInput
                    value={titleDraft}
                    onChangeText={setTitleDraft}
                    onSubmitEditing={saveRenaming}
                    onBlur={saveRenaming}
                    autoFocus
                    placeholder={t("chat.renamePlaceholder")}
                    placeholderTextColor={theme.textSecondary}
                    style={[
                      styles.headerTitle,
                      styles.headerTitleInput,
                      {
                        color: theme.text,
                        borderColor: theme.backgroundSelected,
                      },
                    ]}
                  />
                ) : (
                  <Pressable onPress={startRenaming} style={styles.headerTitle}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {activeDialog.title || t("chat.untitled")}
                    </ThemedText>
                  </Pressable>
                )}
              </View>
              <View style={styles.headerActions}>
                <Pressable
                  onPress={handleClear}
                  hitSlop={8}
                  style={styles.clearButton}
                >
                  <ThemedText type="small" themeColor="textSecondary">
                    {t("chat.clear")}
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleDelete}
                  hitSlop={8}
                  style={styles.clearButton}
                >
                  <ThemedText type="small" themeColor="textSecondary">
                    {t("common.delete")}
                  </ThemedText>
                </Pressable>
              </View>
            </View>

            <ScrollView
              ref={scrollRef}
              style={styles.flex}
              contentContainerStyle={[styles.messages]}
              onContentSizeChange={() =>
                scrollRef.current?.scrollToEnd({ animated: true })
              }
              keyboardShouldPersistTaps="handled"
              bounces={false}
              overScrollMode="never"
            >
              {messages.length === 0 && !sending ? (
                <ThemedText
                  themeColor="textSecondary"
                  type="small"
                  style={styles.emptyHint}
                >
                  {t("chat.empty")}
                </ThemedText>
              ) : null}

              {messages.map((message, msgIndex) =>
                message.role === "user" ? (
                  <View key={message.id} style={styles.userRow}>
                    <ThemedView
                      type="backgroundSelected"
                      style={styles.userBubble}
                    >
                      <MathAnswer
                        text={autoDelimitRawLatex(message.latexContent ?? message.content)}
                        fontSize={15}
                      />
                      <View style={styles.messageActions}>
                        {message.createdAt ? (
                          <ThemedText
                            type="code"
                            themeColor="textSecondary"
                            style={styles.messageDate}
                          >
                            {formatMessageDate(message.createdAt)}
                          </ThemedText>
                        ) : null}
                        <Pressable
                          onPress={() => void startEdit(message, msgIndex)}
                          hitSlop={8}
                          style={styles.messageDeleteChip}
                          accessibilityRole="button"
                          accessibilityLabel={t("chat.editTitle")}
                        >
                          <ThemedText type="code" style={styles.messageRetryText}>
                            ✏️
                          </ThemedText>
                        </Pressable>
                        <Pressable
                          onPress={() => void startRetry(message, msgIndex)}
                          disabled={retryingId === message.id}
                          hitSlop={8}
                          style={styles.messageDeleteChip}
                          accessibilityRole="button"
                          accessibilityLabel={t("chat.retryTitle")}
                        >
                          <ThemedText type="code" style={styles.messageRetryText}>
                            {retryingId === message.id ? "⏳" : "🔄"}
                          </ThemedText>
                        </Pressable>
                        <Pressable
                          onPress={() => void handleDeleteMessage(message, msgIndex)}
                          hitSlop={8}
                          style={styles.messageDeleteChip}
                        >
                          <ThemedText type="code" style={styles.messageDeleteText}>
                            ✕
                          </ThemedText>
                        </Pressable>
                      </View>
                    </ThemedView>
                  </View>
                ) : (
                  <ThemedView
                    key={message.id}
                    type="backgroundElement"
                    style={styles.assistantBubble}
                  >
                    {message.error ? (
                      <ThemedText type="small" style={styles.errorText}>
                        {t("chat.errorMessage", { message: message.content })}
                      </ThemedText>
                    ) : (
                      <>
                        <MathAnswer text={message.content} />
                        <View style={styles.messageActions}>
                          {message.createdAt ? (
                            <ThemedText
                              type="code"
                              themeColor="textSecondary"
                              style={styles.messageDate}
                            >
                              {formatMessageDate(message.createdAt)}
                            </ThemedText>
                          ) : null}
                          <Pressable
                            onPress={() => void handleDeleteMessage(message, msgIndex)}
                            hitSlop={8}
                            style={styles.messageDeleteChip}
                          >
                            <ThemedText type="code" style={styles.messageDeleteText}>
                              ✕
                            </ThemedText>
                          </Pressable>
                          {!message.error ? (
                            <Pressable
                              onPress={() => void startRetry(message, msgIndex)}
                              disabled={retryingId === message.id}
                              hitSlop={8}
                              style={styles.messageDeleteChip}
                              accessibilityRole="button"
                              accessibilityLabel={t("chat.retryTitle")}
                            >
                              <ThemedText type="code" style={styles.messageRetryText}>
                                {retryingId === message.id ? "⏳" : "🔄"}
                              </ThemedText>
                            </Pressable>
                          ) : null}
                          {hasMetadata(message) ? (
                            <Pressable
                              onPress={() => showMessageMetadata(message)}
                              hitSlop={8}
                              style={styles.metaChip}
                            >
                              <ThemedText type="code" style={styles.metaChipText}>
                                ⓘ {metaCaption(message)}
                              </ThemedText>
                            </Pressable>
                          ) : null}
                        </View>
                        <Pressable
                          onPress={() =>
                            void handleCopy(message.content, message.id)
                          }
                          hitSlop={8}
                          style={styles.copyButton}
                        >
                          <ThemedText
                            type="code"
                            themeColor={
                              copiedId === message.id ? "text" : "textSecondary"
                            }
                          >
                            {copiedId === message.id
                              ? `✓ ${t("chat.copied")}`
                              : `⧉ ${t("chat.copy")}`}
                          </ThemedText>
                        </Pressable>
                      </>
                    )}
                  </ThemedView>
                ),
              )}

              {sending ? (
                <View style={styles.thinkingRow}>
                  <ActivityIndicator size="small" />
                  <ThemedText type="small" themeColor="textSecondary">
                    {t("chat.thinking", { model })}
                  </ThemedText>
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.composerArea}>
              <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.composerMetaRow}
            >
              <Pressable
                  onPress={() => setModelPickerOpen(true)}
                  hitSlop={8}
                  style={styles.modelButton}
                >
                  <ThemedText
                    type="code"
                    themeColor="textSecondary"
                    numberOfLines={1}
                  >
                    {t("models.selected", { model })}
                  </ThemedText>
                </Pressable>
                <View style={styles.chipsRow}>
                  <Pressable
                    onPress={cycleReasoning}
                    hitSlop={8}
                    style={styles.reasoningChip}
                    accessibilityRole="button"
                    accessibilityLabel="Cycle reasoning effort"
                  >
                    <ThemedText
                      type="code"
                      themeColor={reasoning ? "text" : "textSecondary"}
                    >
                      🧠 {reasoning === "" ? "default" : reasoning}
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => setFlexOn((current) => !current)}
                    hitSlop={8}
                    style={styles.reasoningChip}
                    accessibilityRole="button"
                    accessibilityLabel="Toggle Flex processing tier"
                  >
                    <ThemedText
                      type="code"
                      themeColor={flexOn ? "text" : "textSecondary"}
                    >
                      🧊 {flexOn ? "flex" : "standard"}
                    </ThemedText>
                  </Pressable>
                </View>
            </ScrollView>
              <View style={styles.composer}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder={t("chat.placeholder")}
                  placeholderTextColor={theme.textSecondary}
                  multiline
                  maxLength={8000}
                  style={[
                    styles.input,
                    {
                      color: theme.text,
                      backgroundColor: theme.background,
                      borderColor: theme.backgroundSelected,
                    },
                  ]}
                />
                <AnimatedPressable
                  disabled={sending || input.trim().length === 0}
                  onPress={() => void handleSend()}
                  style={[
                    styles.sendButton,
                    (sending || input.trim().length === 0) && styles.sendDim,
                  ]}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <ThemedText type="smallBold" style={styles.sendText}>
                      {t("chat.send")}
                    </ThemedText>
                  )}
                </AnimatedPressable>
              </View>
            </View>
            <ModelPickerModal
              visible={modelPickerOpen}
              mode="live"
              value={model}
              onChange={(id) => {
                if (retryTarget) {
                  // Retry mode: re-answer the tapped reply with this model.
                  const target = retryTarget;
                  setRetryTarget(null);
                  void performRetry(target, id);
                } else {
                  setActiveModel(id);
                }
              }}
              onClose={() => {
                setModelPickerOpen(false);
                setRetryTarget(null);
              }}
            />
            <Modal
              visible={editing !== null}
              transparent
              animationType="fade"
              onRequestClose={() => setEditing(null)}
            >
              <Pressable
                style={styles.editOverlay}
                onPress={() => setEditing(null)}
              >
                <Pressable
                  style={[
                    styles.editCard,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.backgroundSelected,
                    },
                  ]}
                  onPress={(e) => e.stopPropagation()}
                >
                  <ThemedText type="smallBold">{t("chat.editTitle")}</ThemedText>
                  <TextInput
                    value={editText}
                    onChangeText={setEditText}
                    multiline
                    autoFocus
                    maxLength={8000}
                    style={[
                      styles.editInput,
                      {
                        color: theme.text,
                        backgroundColor: theme.background,
                        borderColor: theme.backgroundSelected,
                      },
                    ]}
                  />
                  <View style={[styles.messageActions, styles.editActions]}>
                    <Pressable
                      onPress={() => setEditing(null)}
                      hitSlop={8}
                      style={styles.editButton}
                    >
                      <ThemedText type="small" themeColor="textSecondary">
                        {t("common.cancel")}
                      </ThemedText>
                    </Pressable>
                    <AnimatedPressable
                      disabled={savingEdit || editText.trim().length === 0}
                      onPress={() => void performEdit()}
                      style={[
                        styles.editSaveButton,
                        (savingEdit || editText.trim().length === 0) && styles.sendDim,
                      ]}
                    >
                      <ThemedText type="smallBold" style={styles.sendText}>
                        {savingEdit ? "…" : t("chat.editSave")}
                      </ThemedText>
                    </AnimatedPressable>
                  </View>
                </Pressable>
              </Pressable>
            </Modal>
          </>
        ) : (
          <>
            <View style={[styles.header, contentPlatformStyle]}>
              <View style={styles.headerLeft}>
                <Pressable
                  onPress={() => setDrawerOpen(true)}
                  hitSlop={8}
                  style={styles.menuButton}
                  accessibilityRole="button"
                  accessibilityLabel={t("chat.dialogs")}
                >
                  <ThemedText style={styles.menuIcon}>☰</ThemedText>
                </Pressable>
                <ThemedText type="subtitle">{t("chat.title")}</ThemedText>
              </View>
              <Pressable
                onPress={handleNew}
                hitSlop={8}
                style={styles.newButton}
              >
                <ThemedText type="smallBold" style={styles.newText}>
                  + {t("chat.newDialog")}
                </ThemedText>
              </Pressable>
            </View>

            <View style={styles.searchWrap}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={t("chat.searchPlaceholder")}
                placeholderTextColor={theme.textSecondary}
                autoCorrect={false}
                style={[
                  styles.searchInput,
                  {
                    color: theme.text,
                    backgroundColor: theme.background,
                    borderColor: theme.backgroundSelected,
                  },
                ]}
              />
            </View>

            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              bounces={false}
              overScrollMode="never"
            >
              {filteredDialogs.length === 0 ? (
                <ThemedText
                  themeColor="textSecondary"
                  type="small"
                  style={styles.emptyHint}
                >
                  {searchQuery ? t("common.noMatch") : t("chat.noDialogs")}
                </ThemedText>
              ) : (
                filteredDialogs.map((dialog) => {
                  const last = dialog.messages[dialog.messages.length - 1];
                  const preview = last
                    ? last.role === "user"
                      ? `${t("chat.you")}: ${last.content}`
                      : last.content
                    : "";
                  return (
                    <Pressable
                      key={dialog.id}
                      onPress={() => openDialog(dialog.id)}
                      style={[
                        styles.dialogCard,
                        { borderColor: theme.backgroundSelected },
                      ]}
                    >
                      <View style={styles.dialogRow}>
                        <ThemedText
                          type="smallBold"
                          numberOfLines={1}
                          style={styles.dialogTitle}
                        >
                          {dialog.title || t("chat.untitled")}
                        </ThemedText>
                        <ThemedText type="code" themeColor="textSecondary">
                          {formatTime(dialog.updatedAt)}
                        </ThemedText>
                      </View>
                      <ThemedText
                        type="code"
                        themeColor="textSecondary"
                        numberOfLines={1}
                      >
                        {dialog.model}
                      </ThemedText>
                      {preview ? (
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                          numberOfLines={2}
                        >
                          {preview}
                        </ThemedText>
                      ) : (
                        <ThemedText type="small" themeColor="textSecondary">
                          {t("chat.emptyDialog")}
                        </ThemedText>
                      )}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </>
        )}
      </View>

      <ChatDrawer
        visible={drawerOpen}
        dialogs={sortedDialogs}
        activeId={activeId}
        onClose={handleDrawerClose}
        onSelect={handleDrawerSelect}
        onNew={handleDrawerNew}
        onDelete={handleDrawerDelete}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  inner: {
    flex: 1,
    maxWidth: MaxContentWidth,
    width: "100%",
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  headerTitle: {
    flex: 1,
  },
  headerTitleInput: {
    fontSize: 15,
    fontWeight: "700",
    borderWidth: 1,
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  backButton: {
    paddingVertical: Spacing.one,
  },
  clearButton: {
    paddingVertical: Spacing.one,
  },
  newButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  newText: {
    color: "#3c87f7",
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  searchWrap: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
    minHeight: 44,
  },
  dialogCard: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
  },
  dialogRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  dialogTitle: {
    flex: 1,
  },
  messages: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  emptyHint: {
    textAlign: "center",
    paddingVertical: Spacing.four,
  },
  userRow: {
    alignItems: "flex-end",
  },
  userBubble: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    maxWidth: "85%",
  },
  assistantBubble: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  copyButton: {
    alignSelf: "flex-end",
    marginTop: Spacing.one,
    paddingVertical: 2,
  },
  messageDate: {
    alignSelf: "flex-start",
    marginTop: 2,
    fontSize: 10,
  },
  messageActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  messageDeleteChip: {
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 7,
  },
  messageDeleteText: {
    fontSize: 15,
    color: "#e05252",
  },
  messageRetryText: {
    fontSize: 15,
  },
  editOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.three,
  },
  editCard: {
    width: "100%",
    maxWidth: 480,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  editInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 15,
    minHeight: 88,
    textAlignVertical: "top",
  },
  editActions: {
    justifyContent: "flex-end",
    marginTop: Spacing.one,
  },
  editButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  editSaveButton: {
    backgroundColor: "#3c87f7",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    alignItems: "center",
    justifyContent: "center",
  },
  metaChip: {
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 7,
  },
  metaChipText: {
    fontSize: 12,
  },
  thinkingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  errorText: {
    color: "#e05252",
  },
  composerArea: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  modelButton: {
    alignSelf: "flex-start",
    paddingVertical: 2,
    // Let a long model name shrink (ellipsis) instead of pushing the
    // reasoning/flex chips off-screen; the row itself scrolls horizontally.
    flexShrink: 1,
    minWidth: 0,
  },
  composerMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // Fill the row when content is narrow so space-between keeps its layout.
    flexGrow: 1,
    gap: Spacing.two,
  },
  chipsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    // Chips must never be squeezed away by a long model name.
    flexShrink: 0,
  },
  reasoningChip: {
    alignSelf: "flex-start",
    paddingVertical: 2,
    paddingHorizontal: Spacing.two,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(128,128,128,0.35)",
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 17,
    textAlignVertical: "top",
  },
  sendButton: {
    backgroundColor: "#3c87f7",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 2,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDim: {
    opacity: 0.45,
  },
  sendText: {
    color: "#ffffff",
  },
  menuButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  menuIcon: {
    fontSize: 22,
    lineHeight: 26,
  },
});
