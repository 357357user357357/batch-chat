import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/animated-pressable";
import { BatchDrawer } from "@/components/batch-drawer";
import { MathAnswer } from "@/components/math-answer";
import {
  autoDelimitRawLatex,
  containsMath,
} from "@/components/math-segments";
import { ModelPickerModal } from "@/components/model-picker-modal";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useI18n } from "@/i18n";
import { saveTextFile, type SaveOutcome } from "@/services/files";
import {
  createBatch,
  extractBatchAnswers,
  isBatchTerminal,
  OPENROUTER_BATCH_MODEL,
  waitForBatch,
  type OpenRouterBatch,
  type ReasoningEffort,
} from "@/services/openrouter";
import { loadJSON, loadString, saveJSON, saveString } from "@/services/storage";

const MAX_JOBS = 30;
const HISTORY_STORAGE_KEY = "openrouter.batches.history.v1";
const SELECTED_STORAGE_KEY = "openrouter.batches.selected.v1";
const REASONING_STORAGE_KEY = "openrouter.batches.reasoning.v1";
// Persist the chosen batch model so it becomes your default on next launch.
const MODEL_STORAGE_KEY = "openrouter.batches.model.v1";

type HistoryItem = {
  id: string;
  model: string;
  prompts: string[];
  createdAt: number;
  batch: OpenRouterBatch | null;
  error?: string;
  /** Custom name set by the user; falls back to `batchLabel(prompts)` when empty. */
  title?: string;
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Short, single-line label for a batch: its first (main) question. */
function batchLabel(prompts: string[]): string {
  const first = (prompts.find((p) => p.trim()) ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return first.length > 42 ? `${first.slice(0, 42)}…` : first;
}

/** Flattened questions + answers for search. */
function batchSearchText(item: HistoryItem): string {
  const answers =
    item.batch && item.batch.status === "completed"
      ? extractBatchAnswers(item.batch).map((a) =>
          a.ok ? (a.answer ?? "") : (a.error ?? ""),
        )
      : [];
  return [...item.prompts, ...answers].join("\n");
}

/** Rows: batch_id;model;custom_id;prompt;answer (semicolon-separated, quoted). */
export function buildCsv(item: HistoryItem): string {
  const answers =
    item.batch && item.batch.status === "completed"
      ? extractBatchAnswers(item.batch)
      : [];
  const rows: string[][] = [
    ["batch_id", "model", "custom_id", "prompt", "answer"],
  ];
  item.prompts.forEach((prompt, index) => {
    const answer = answers.find((a) => a.custom_id === `req-${index + 1}`);
    rows.push([
      item.id,
      item.model,
      `req-${index + 1}`,
      prompt,
      answer ? (answer.ok ? (answer.answer ?? "") : (answer.error ?? "")) : "",
    ]);
  });
  return rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(";"),
    )
    .join("\n");
}

/** Full structured dump of one batch for the JSON export (journal). */
export function buildJson(item: HistoryItem): string {
  return `${JSON.stringify(exportJournal(item), null, 2)}\n`;
}

function exportJournal(item: HistoryItem): unknown {
  return {
    batch_id: item.id,
    model: item.model,
    created_at: new Date(item.createdAt).toISOString(),
    status: item.batch?.status ?? "pending",
    prompts: item.prompts,
    answers:
      item.batch && item.batch.status === "completed"
        ? extractBatchAnswers(item.batch)
        : [],
  };
}

export default function BatchesScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const safeAreaInsets = useSafeAreaInsets();
  const insets = {
    ...safeAreaInsets,
    bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
  };
  const [promptsText, setPromptsText] = useState("");
  const [model, setModel] = useState(OPENROUTER_BATCH_MODEL);
  // 🧠 reasoning effort for every request in the batch (persisted).
  const [reasoning, setReasoning] = useState<ReasoningEffort | "">("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const pollRuns = useRef(new Set<string>());
  const selectedItem = history.find((item) => item.id === selectedId) ?? null;

  const updateItem = useCallback((id: string, patch: Partial<HistoryItem>) => {
    setHistory((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  // Polls a batch in the background without blocking the UI; re-runs when the
  // app reopens (in-flight batches are resumed from persisted history).
  const startPolling = useCallback(
    (id: string, prompts: string[]) => {
      if (pollRuns.current.has(id)) return;
      pollRuns.current.add(id);
      void (async () => {
        try {
          const done = await waitForBatch(id, {
            pollIntervalMs: 10_000,
            timeoutMs: 120 * 60_000,
            onPoll: (current) => updateItem(id, { batch: current }),
          });
          updateItem(id, { batch: done, error: undefined });
        } catch (error) {
          updateItem(id, {
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          pollRuns.current.delete(id);
        }
      })();
    },
    [updateItem],
  );

  const trackBatch = useCallback(
    (created: OpenRouterBatch, prompts: string[]) => {
      setHistory((prev) => [
        {
          id: created.id,
          model: created.model,
          prompts,
          createdAt: Date.now(),
          batch: created,
          error: undefined,
        },
        ...prev,
      ]);
      startPolling(created.id, prompts);
    },
    [startPolling],
  );
  // Restore saved history and resume polling of in-flight batches.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const items = await loadJSON<HistoryItem[]>(HISTORY_STORAGE_KEY, []);
      const savedSelectedId = await loadString(SELECTED_STORAGE_KEY);
      const savedReasoning = await loadString(REASONING_STORAGE_KEY);
      const savedModel = await loadString(MODEL_STORAGE_KEY);
      if (cancelled) return;
      if (savedModel) setModel(savedModel);
      if (
        savedReasoning === "none" || savedReasoning === "low" ||
        savedReasoning === "medium" || savedReasoning === "high" ||
        savedReasoning === "xhigh" || savedReasoning === "max"
      ) {
        setReasoning(savedReasoning);
      }
      setHistory(items);
      const restoredId =
        savedSelectedId && items.some((item) => item.id === savedSelectedId)
          ? savedSelectedId
          : null;
      setSelectedId(restoredId);
      for (const item of items) {
        if (item.batch && !isBatchTerminal(item.batch) && !item.error) {
          startPolling(item.id, item.prompts);
        }
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [startPolling]);

  // Persist history after every change (but not before the initial load).
  useEffect(() => {
    if (!hydrated) return;
    void saveJSON(HISTORY_STORAGE_KEY, history);
  }, [history, hydrated]);

  // Persist which batch is currently open, so the app reopens to the same
  // detail view after a restart (guarded until hydration to avoid wiping it).
  useEffect(() => {
    if (!hydrated) return;
    void saveString(SELECTED_STORAGE_KEY, selectedId ?? "");
  }, [selectedId, hydrated]);

  // Persist the reasoning effort so it survives app restarts.
  useEffect(() => {
    if (!hydrated) return;
    void saveString(REASONING_STORAGE_KEY, reasoning);
  }, [reasoning, hydrated]);

  // Persist the batch model so it is the default on the next launch.
  useEffect(() => {
    if (!hydrated) return;
    void saveString(MODEL_STORAGE_KEY, model);
  }, [model, hydrated]);

  /** 🧠 chip: cycle Default → None → Low → Medium → High → XHigh → Max. */
  const cycleReasoning = () => {
    const levels: Array<ReasoningEffort | ""> = [
      "", "none", "low", "medium", "high", "xhigh", "max",
    ];
    const next = levels[(levels.indexOf(reasoning) + 1) % levels.length];
    setReasoning(next);
  };

  const handleSubmit = async () => {
    const prompts = promptsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_JOBS);
    if (!prompts.length) {
      Alert.alert(t("batches.emptyTitle"), t("batches.emptyBody"));
      return;
    }
    if (!model.trim()) {
      Alert.alert(t("batches.modelTitle"), t("batches.modelBody"));
      return;
    }
    setSubmitting(true);
    try {
      const created = await createBatch(
        prompts.map((content) => ({
          messages: [{ role: "user" as const, content }],
          ...(reasoning ? { options: { reasoning } } : {}),
        })),
        model.trim(),
      );
      trackBatch(created, prompts);
      setPromptsText("");
    } catch (error) {
      Alert.alert(
        t("batches.createError"),
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const copyTextSafe = async (label: string, text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert(t("batches.copyLabel"), t("batches.copyBody", { label }));
    } catch (error) {
      Alert.alert(
        t("batches.copyFail"),
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  // Copies the raw answer text, LaTeX formulas (`$$…$$`) included.
  const copyPrompt = (prompt: string) =>
    copyTextSafe(t("batches.copyPromptLabel"), prompt);
  const copyAnswer = (answer: string) =>
    copyTextSafe(t("batches.copyAnswersLabel"), answer);

  const copyAllAnswers = async (item: HistoryItem) => {
    if (!item.batch) return;
    const answers = extractBatchAnswers(item.batch);
    const text = item.prompts
      .map((prompt, index) => {
        const answer = answers.find((a) => a.custom_id === `req-${index + 1}`);
        const value = answer
          ? answer.ok
            ? (answer.answer ?? "")
            : `❌ ${answer.error ?? ""}`
          : "";
        return `Q: ${prompt}\nA: ${value}`;
      })
      .join("\n\n");
    await copyTextSafe(t("batches.copyAnswersLabel"), text);
  };

  const handleSaveOutcome = (outcome: SaveOutcome) => {
    if (outcome === "saved") {
      Alert.alert(t("common.saved"), t("batches.saved"));
    } else if (outcome === "shared") {
      Alert.alert(t("common.saved"), t("batches.shared"));
    } else if (outcome === "canceled") {
      // user dismissed the system picker, not an error
    } else {
      Alert.alert(t("batches.fileFail"));
    }
  };

  const saveCsv = async (item: HistoryItem) => {
    try {
      const outcome = await saveTextFile(
        `${item.id}.csv`,
        buildCsv(item),
        "text/csv",
      );
      handleSaveOutcome(outcome);
    } catch (error) {
      Alert.alert(
        t("batches.fileFail"),
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const exportJson = async (item: HistoryItem) => {
    try {
      const outcome = await saveTextFile(
        `${item.id}.json`,
        buildJson(item),
        "application/json",
      );
      handleSaveOutcome(outcome);
    } catch (error) {
      Alert.alert(
        t("batches.fileFail"),
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const removeItem = (id: string) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  };

  const handleDrawerSelect = (id: string) => {
    setSelectedId(id);
    setDrawerOpen(false);
    setTitleDraft(null);
  };

  const handleDrawerNew = () => {
    setSelectedId(null);
    setDrawerOpen(false);
    setTitleDraft(null);
  };

  const handleDrawerDelete = (id: string) => {
    Alert.alert(t("batches.delete"), t("batches.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => removeItem(id),
      },
    ]);
  };

  const startRenaming = () =>
    setTitleDraft(
      selectedItem?.title ?? batchLabel(selectedItem?.prompts ?? []),
    );

  const saveRenaming = () => {
    if (titleDraft !== null && selectedId) {
      const trimmed = titleDraft.trim();
      updateItem(selectedId, { title: trimmed });
    }
    setTitleDraft(null);
  };

  const jobCount = promptsText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean).length;
  const hasActive = history.some(
    (item) => item.batch && !isBatchTerminal(item.batch) && !item.error,
  );

  const topBarInsets = {
    paddingTop: insets.top,
    paddingLeft: insets.left,
    paddingRight: insets.right,
  };

  const searchQuery = search.trim().toLowerCase();
  const filteredHistory = searchQuery
    ? history.filter((item) =>
        batchSearchText(item).toLowerCase().includes(searchQuery),
      )
    : history;
  const drawerDialogs = history.map((item) => ({
    id: item.id,
    model: item.model,
    prompts: item.prompts,
    createdAt: item.createdAt,
    title: item.title,
    searchText: batchSearchText(item),
  }));

  if (selectedItem) {
    return (
      <View style={[styles.flex, { backgroundColor: theme.background }]}>
        <View
          style={[
            styles.topBar,
            topBarInsets,
            { borderBottomColor: theme.backgroundSelected },
          ]}
        >
          <View style={styles.headerRow}>
            <Pressable
              onPress={() => setDrawerOpen(true)}
              hitSlop={8}
              style={styles.menuButton}
              accessibilityRole="button"
              accessibilityLabel={t("batches.title")}
            >
              <ThemedText style={styles.menuIcon}>☰</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => setSelectedId(null)}
              hitSlop={8}
              style={styles.backButton}
            >
              <ThemedText type="smallBold" themeColor="textSecondary">
                ‹ {t("batches.back")}
              </ThemedText>
            </Pressable>
            {titleDraft !== null ? (
              <TextInput
                value={titleDraft}
                onChangeText={setTitleDraft}
                onSubmitEditing={saveRenaming}
                onBlur={saveRenaming}
                autoFocus
                placeholder={t("batches.renamePlaceholder")}
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.headerTitleInput,
                  { color: theme.text, borderColor: theme.backgroundSelected },
                ]}
              />
            ) : (
              <Pressable
                onPress={startRenaming}
                style={styles.headerTitle}
                hitSlop={8}
              >
                <ThemedText type="smallBold" numberOfLines={1}>
                  {selectedItem?.title ||
                    batchLabel(selectedItem?.prompts ?? []) ||
                    t("batches.untitled")}
                </ThemedText>
              </Pressable>
            )}
            <View style={styles.headerSpacer} />
          </View>
        </View>
        <ScrollView
          style={styles.flex}
          contentInset={insets}
          contentContainerStyle={styles.contentContainer}
          bounces={false}
          overScrollMode="never"
        >
          <ThemedView style={styles.container}>
            <BatchCard
              item={selectedItem}
              onCopyAll={() => copyAllAnswers(selectedItem)}
              onSaveCsv={() => saveCsv(selectedItem)}
              onExportJson={() => exportJson(selectedItem)}
              onCopyPrompt={copyPrompt}
              onCopyAnswer={copyAnswer}
              onRemove={() => removeItem(selectedItem.id)}
            />
          </ThemedView>
        </ScrollView>
        <BatchDrawer
          visible={drawerOpen}
          dialogs={drawerDialogs}
          activeId={selectedId}
          onClose={() => setDrawerOpen(false)}
          onSelect={handleDrawerSelect}
          onNew={handleDrawerNew}
          onDelete={handleDrawerDelete}
        />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.topBar,
          topBarInsets,
          { borderBottomColor: theme.backgroundSelected },
        ]}
      >
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => setDrawerOpen(true)}
            hitSlop={8}
            style={styles.menuButton}
            accessibilityRole="button"
            accessibilityLabel={t("batches.title")}
          >
            <ThemedText style={styles.menuIcon}>☰</ThemedText>
          </Pressable>
          <ThemedText type="subtitle">{t("batches.title")}</ThemedText>
          {hasActive && <ActivityIndicator size="small" />}
          <View style={styles.headerSpacer} />
        </View>
      </View>
      <ScrollView
        style={styles.flex}
        contentInset={insets}
        contentContainerStyle={styles.contentContainer}
        bounces={false}
        overScrollMode="never"
      >
        <ThemedView style={styles.container}>
          <ThemedText themeColor="textSecondary" type="small">
            {t("batches.subtitle")}
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.composeCard}>
            <TextInput
              value={promptsText}
              onChangeText={setPromptsText}
              placeholder={t("batches.promptPlaceholder")}
              placeholderTextColor={theme.textSecondary}
              multiline
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.background,
                  borderColor: theme.backgroundSelected,
                },
              ]}
            />
            <ThemedText type="code" themeColor="textSecondary">
              {t("batches.jobCount", { count: jobCount, max: MAX_JOBS })}
            </ThemedText>

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

            <Pressable
              onPress={cycleReasoning}
              hitSlop={8}
              style={styles.reasoningChip}
              accessibilityRole="button"
              accessibilityLabel="Cycle reasoning effort for batch requests"
            >
              <ThemedText
                type="code"
                themeColor={reasoning ? "text" : "textSecondary"}
              >
                🧠 {reasoning === "" ? "default" : reasoning}
              </ThemedText>
            </Pressable>

            <AnimatedPressable
              disabled={submitting || jobCount === 0}
              onPress={() => void handleSubmit()}
              style={[
                styles.submitButton,
                (submitting || jobCount === 0) && styles.pressedDim,
              ]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <ThemedText type="smallBold" themeColor="backgroundElement">
                  {t("batches.send")}
                </ThemedText>
              )}
            </AnimatedPressable>
          </ThemedView>
          <ModelPickerModal
            visible={modelPickerOpen}
            mode="batch"
            value={model}
            onChange={setModel}
            onClose={() => setModelPickerOpen(false)}
          />

          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t("batches.searchPlaceholder")}
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

          <View style={styles.history}>
            {filteredHistory.length === 0 ? (
              <ThemedText
                themeColor="textSecondary"
                type="small"
                style={styles.emptyHint}
              >
                {searchQuery ? t("common.noMatch") : t("batches.historyEmpty")}
              </ThemedText>
            ) : (
              filteredHistory.map((item) => {
                const status = item.error
                  ? "error"
                  : (item.batch?.status ?? "pending");
                const completed = item.batch?.status === "completed";
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setSelectedId(item.id)}
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
                        {item.title ||
                          batchLabel(item.prompts) ||
                          t("batches.untitled")}
                      </ThemedText>
                      <ThemedView
                        style={[
                          styles.statusBadge,
                          completed
                            ? styles.statusOk
                            : status === "error"
                              ? styles.statusErr
                              : null,
                        ]}
                      >
                        <ThemedText type="code" themeColor="textSecondary">
                          {t(`status.${status}` as never)}
                        </ThemedText>
                      </ThemedView>
                    </View>
                    <ThemedText
                      type="code"
                      themeColor="textSecondary"
                      numberOfLines={1}
                    >
                      {item.model}
                    </ThemedText>
                    <ThemedText type="code" themeColor="textSecondary">
                      {formatTime(item.createdAt)} ·{" "}
                      {t("batches.questionsCount", {
                        count: item.prompts.length,
                      })}
                    </ThemedText>
                  </Pressable>
                );
              })
            )}
          </View>
        </ThemedView>
      </ScrollView>
      <BatchDrawer
        visible={drawerOpen}
        dialogs={drawerDialogs}
        activeId={selectedId}
        onClose={() => setDrawerOpen(false)}
        onSelect={handleDrawerSelect}
        onNew={handleDrawerNew}
        onDelete={handleDrawerDelete}
      />
    </View>
  );
}
type BatchCardProps = {
  item: HistoryItem;
  onCopyAll: () => void;
  onSaveCsv: () => void;
  onExportJson: () => void;
  onCopyPrompt: (prompt: string) => void;
  onCopyAnswer: (answer: string) => void;
  onRemove: () => void;
};

function BatchCard({
  item,
  onCopyAll,
  onSaveCsv,
  onExportJson,
  onCopyPrompt,
  onCopyAnswer,
  onRemove,
}: BatchCardProps) {
  const { t } = useI18n();
  const status = item.error ? "error" : (item.batch?.status ?? "pending");
  const completed = item.batch?.status === "completed";
  const answers =
    item.batch && completed ? extractBatchAnswers(item.batch) : [];
  const counts = item.batch?.request_counts;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderText}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {item.model}
          </ThemedText>
          <ThemedText type="code" themeColor="textSecondary">
            {formatTime(item.createdAt)} · {item.id.slice(0, 18)}…
          </ThemedText>
        </View>
        <View
          style={[
            styles.statusBadge,
            completed
              ? styles.statusOk
              : status === "error"
                ? styles.statusErr
                : null,
          ]}
        >
          <ThemedText type="code" themeColor="text">
            {t(`status.${status}` as never)}
          </ThemedText>
        </View>
      </View>

      {counts ? (
        <ThemedText type="code" themeColor="textSecondary">
          {t("batches.doneCount", {
            completed: counts.completed,
            total: counts.total,
          })}
          {counts.failed > 0
            ? t("batches.errorsCount", { failed: counts.failed })
            : ""}
        </ThemedText>
      ) : null}

      {item.error ? (
        <ThemedText type="small" style={styles.errorText}>
          {item.error}
        </ThemedText>
      ) : null}

      {answers.length > 0 ? (
        <View style={styles.answers}>
          {answers.map((answer) => {
            const index =
              Number((answer.custom_id || "req-1").replace(/\D/g, "")) - 1;
            const prompt = item.prompts[index] ?? "";
            return (
              <View key={answer.custom_id} style={styles.answerBlock}>
                <View style={styles.answerPromptRow}>
                  {containsMath(autoDelimitRawLatex(prompt)) ? (
                    <View style={styles.answerPrompt}>
                      <MathAnswer
                        text={autoDelimitRawLatex(prompt)}
                        fontSize={15}
                      />
                    </View>
                  ) : (
                    <ThemedText type="smallBold" style={styles.answerPrompt}>
                      {prompt}
                    </ThemedText>
                  )}
                  <Pressable
                    onPress={() => onCopyPrompt(prompt)}
                    style={styles.copyIcon}
                  >
                    <ThemedText type="code" themeColor="textSecondary">
                      ⧉
                    </ThemedText>
                  </Pressable>
                </View>
                {answer.ok ? (
                  <>
                    <MathAnswer text={autoDelimitRawLatex(answer.answer ?? "")} />
                    <Pressable
                      onPress={() => onCopyAnswer(answer.answer ?? "")}
                      hitSlop={8}
                      style={styles.copyAnswerButton}
                    >
                      <ThemedText type="code" themeColor="textSecondary">
                        ⧉ {t("batches.copyAnswer")}
                      </ThemedText>
                    </Pressable>
                  </>
                ) : (
                  <ThemedText type="small" style={styles.errorText}>
                    ❌ {answer.error ?? t("batches.noAnswer")}
                  </ThemedText>
                )}
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.cardActions}>
        <Pressable
          disabled={!completed}
          onPress={onCopyAll}
          style={[styles.actionButton, !completed && styles.pressedDim]}
        >
          <ThemedText
            type="small"
            themeColor={completed ? "textSecondary" : undefined}
          >
            {t("batches.copyAll")}
          </ThemedText>
        </Pressable>
        <Pressable
          disabled={!completed}
          onPress={onSaveCsv}
          style={[styles.actionButton, !completed && styles.pressedDim]}
        >
          <ThemedText
            type="small"
            themeColor={completed ? "textSecondary" : undefined}
          >
            {t("batches.saveCsv")}
          </ThemedText>
        </Pressable>
        <Pressable
          disabled={!completed}
          onPress={onExportJson}
          style={[styles.actionButton, !completed && styles.pressedDim]}
        >
          <ThemedText
            type="small"
            themeColor={completed ? "textSecondary" : undefined}
          >
            {t("batches.exportJson")}
          </ThemedText>
        </Pressable>
        <Pressable onPress={onRemove} style={styles.actionButton}>
          <ThemedText type="small" themeColor="textSecondary">
            {t("batches.delete")}
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}
const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    maxWidth: MaxContentWidth,
    width: "100%",
    alignSelf: "center",
    paddingHorizontal: Spacing.three,
  },
  container: {
    gap: Spacing.three,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  topBar: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSpacer: {
    flex: 1,
  },
  headerTitle: {
    flex: 1,
  },
  headerTitleInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    borderWidth: 1,
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  composeCard: {
    borderRadius: Spacing.four,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  input: {
    minHeight: 120,
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    fontSize: 17,
    textAlignVertical: "top",
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
    minHeight: 44,
  },
  modelButton: {
    alignSelf: "flex-start",
    paddingVertical: 2,
  },
  reasoningChip: {
    alignSelf: "flex-start",
    paddingVertical: 2,
    paddingHorizontal: Spacing.two,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(128,128,128,0.35)",
  },
  submitButton: {
    backgroundColor: "#3c87f7",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
  },
  history: {
    gap: Spacing.three,
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
  backButton: {
    paddingVertical: Spacing.one,
  },
  menuButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  menuIcon: {
    fontSize: 22,
    lineHeight: 26,
  },
  emptyHint: {
    textAlign: "center",
    paddingVertical: Spacing.four,
  },
  card: {
    borderRadius: Spacing.four,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  cardHeaderText: {
    flex: 1,
    gap: 2,
  },
  statusBadge: {
    backgroundColor: "rgba(128,128,128,0.2)",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  statusOk: {
    backgroundColor: "rgba(40,167,69,0.25)",
  },
  statusErr: {
    backgroundColor: "rgba(220,53,69,0.25)",
  },
  errorText: {
    color: "#e05252",
  },
  answers: {
    gap: Spacing.three,
  },
  answerBlock: {
    gap: 4,
  },
  answerPromptRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  answerPrompt: {
    flex: 1,
    fontSize: 17,
  },
  copyIcon: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  copyAnswerButton: {
    alignSelf: "flex-end",
    paddingVertical: 2,
  },
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  actionButton: {
    paddingVertical: Spacing.one,
  },
  pressedDim: {
    opacity: 0.45,
  },
});
