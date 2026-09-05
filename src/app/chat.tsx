import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
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
import {
    chat,
    formatQuestionLatex,
    OPENROUTER_MODEL,
    type OpenRouterMessage,
    type ReasoningEffort,
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

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** LaTeX-corrected version of a user question, produced while the model thinks. */
  latexContent?: string;
  error?: boolean;
};

type Dialog = {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

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
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
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

  /** 🧠 chip: cycle Default → None → Low → Medium → High → XHigh → Max. */
  const cycleReasoning = () => {
    const levels: Array<ReasoningEffort | ""> = [
      "", "none", "low", "medium", "high", "xhigh", "max",
    ];
    const next = levels[(levels.indexOf(reasoning) + 1) % levels.length];
    setReasoning(next);
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
      model: OPENROUTER_MODEL,
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
        model: flexOn ? `${model}:flex` : model,
        ...(reasoning ? { reasoning } : {}),
        timeoutMs: 120_000,
      });
      const reply = completion.choices?.[0]?.message?.content;
      if (!reply || !reply.trim())
        throw new Error("Empty response from the model.");
      // Cache warm-up is now opt-in only (🔥 Cache toggle on the server web
      // UI) — no automatic pings from the phone.
      const replyMessage: ChatMessage = {
        id: makeId(),
        role: "assistant",
        content: reply,
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

              {messages.map((message) =>
                message.role === "user" ? (
                  <View key={message.id} style={styles.userRow}>
                    <ThemedView
                      type="backgroundSelected"
                      style={styles.userBubble}
                    >
                      <MathAnswer
                        text={autoDelimitRawLatex(message.latexContent ?? message.content)}
                        fontSize={17}
                      />
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
              <View style={styles.composerMetaRow}>
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
              </View>
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
              onChange={setActiveModel}
              onClose={() => setModelPickerOpen(false)}
            />
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
  },
  composerMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  chipsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
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
