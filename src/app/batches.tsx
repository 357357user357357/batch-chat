import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

import { LanguageToggle } from '@/components/language-toggle';
import { MathAnswer } from '@/components/math-answer';
import { ModelChips } from '@/components/model-chips';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useI18n } from '@/i18n';
import { useTheme } from '@/hooks/use-theme';
import {
  createBatch,
  extractBatchAnswers,
  isBatchTerminal,
  OPENROUTER_BATCH_MODEL,
  waitForBatch,
  type OpenRouterBatch,
} from '@/services/openrouter';
import { loadJSON, saveJSON } from '@/services/storage';
import { saveTextFile, type SaveOutcome } from '@/services/files';

const MAX_JOBS = 30;
const HISTORY_STORAGE_KEY = 'openrouter.batches.history.v1';

type HistoryItem = {
  id: string;
  model: string;
  prompts: string[];
  createdAt: number;
  batch: OpenRouterBatch | null;
  error?: string;
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Rows: batch_id;model;custom_id;prompt;answer (semicolon-separated, quoted). */
export function buildCsv(item: HistoryItem): string {
  const answers =
    item.batch && item.batch.status === 'completed' ? extractBatchAnswers(item.batch) : [];
  const rows: string[][] = [['batch_id', 'model', 'custom_id', 'prompt', 'answer']];
  item.prompts.forEach((prompt, index) => {
    const answer = answers.find((a) => a.custom_id === `req-${index + 1}`);
    rows.push([
      item.id,
      item.model,
      `req-${index + 1}`,
      prompt,
      answer ? (answer.ok ? answer.answer ?? '' : answer.error ?? '') : '',
    ]);
  });
  return rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\n');
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
    status: item.batch?.status ?? 'pending',
    prompts: item.prompts,
    answers:
      item.batch && item.batch.status === 'completed'
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
  const [promptsText, setPromptsText] = useState('');
  const [model, setModel] = useState(OPENROUTER_BATCH_MODEL);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const pollRuns = useRef(new Set<string>());

  const updateItem = useCallback((id: string, patch: Partial<HistoryItem>) => {
    setHistory((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
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
    [updateItem]
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
    [startPolling]
  );
// Restore saved history and resume polling of in-flight batches.
  useEffect(() => {
    let cancelled = false;
    void loadJSON<HistoryItem[]>(HISTORY_STORAGE_KEY, []).then((items) => {
      if (cancelled) return;
      setHistory(items);
      for (const item of items) {
        if (item.batch && !isBatchTerminal(item.batch) && !item.error) {
          startPolling(item.id, item.prompts);
        }
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [startPolling]);

  // Persist history after every change (but not before the initial load).
  useEffect(() => {
    if (!hydrated) return;
    void saveJSON(HISTORY_STORAGE_KEY, history);
  }, [history, hydrated]);

  const handleSubmit = async () => {
    const prompts = promptsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_JOBS);
    if (!prompts.length) {
      Alert.alert(t('batches.emptyTitle'), t('batches.emptyBody'));
      return;
    }
    if (!model.trim()) {
      Alert.alert(t('batches.modelTitle'), t('batches.modelBody'));
      return;
    }
    setSubmitting(true);
    try {
      const created = await createBatch(
        prompts.map((content) => ({ messages: [{ role: 'user' as const, content }] })),
        model.trim()
      );
      trackBatch(created, prompts);
      setPromptsText('');
    } catch (error) {
      Alert.alert(
        t('batches.createError'),
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setSubmitting(false);
    }
  };

  const copyTextSafe = async (label: string, text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert(t('batches.copyLabel'), t('batches.copyBody', { label }));
    } catch (error) {
      Alert.alert(
        t('batches.copyFail'),
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const copyAllAnswers = async (item: HistoryItem) => {
    if (!item.batch) return;
    const answers = extractBatchAnswers(item.batch);
    const text = item.prompts
      .map((prompt, index) => {
        const answer = answers[index];
        const value = answer
          ? answer.ok
            ? (answer.answer ?? '')
            : `❌ ${answer.error ?? ''}`
          : '';
        return `Q: ${prompt}\nA: ${value}`;
      })
      .join('\n\n');
    await copyTextSafe(t('batches.copyAnswersLabel'), text);
  };

  const handleSaveOutcome = (outcome: SaveOutcome) => {
    if (outcome === 'saved') {
      Alert.alert(t('common.saved'), t('batches.saved'));
    } else if (outcome === 'shared') {
      Alert.alert(t('common.saved'), t('batches.shared'));
    } else if (outcome === 'web') {
      Alert.alert(t('common.saved'), t('batches.saved'));
    } else if (outcome === 'canceled') {
      // user dismissed the system picker, not an error
    } else {
      Alert.alert(t('batches.fileFail'));
    }
  };

  const saveCsv = async (item: HistoryItem) => {
    try {
      const outcome = await saveTextFile(`${item.id}.csv`, buildCsv(item), 'text/csv');
      handleSaveOutcome(outcome);
    } catch (error) {
      Alert.alert(t('batches.fileFail'), error instanceof Error ? error.message : String(error));
    }
  };

  const exportJson = async (item: HistoryItem) => {
    try {
      const outcome = await saveTextFile(
        `${item.id}.json`,
        buildJson(item),
        'application/json'
      );
      handleSaveOutcome(outcome);
    } catch (error) {
      Alert.alert(t('batches.fileFail'), error instanceof Error ? error.message : String(error));
    }
  };

  const removeItem = (id: string) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));
  };

  const jobCount = promptsText.split('\n').map((l) => l.trim()).filter(Boolean).length;
  const hasActive = history.some(
    (item) => item.batch && !isBatchTerminal(item.batch) && !item.error
  );

  const contentPlatformStyle = Platform.select({
    android: {
      paddingTop: insets.top,
      paddingLeft: insets.left,
      paddingRight: insets.right,
      paddingBottom: insets.bottom,
    },
    web: {
      paddingTop: Spacing.six,
      paddingBottom: Spacing.four,
    },
  });

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentInset={insets}
      contentContainerStyle={[styles.contentContainer, contentPlatformStyle]}>
      <ThemedView style={styles.container}>
        <View style={styles.headerRow}>
          <ThemedText type="subtitle">{t('batches.title')}</ThemedText>
          {hasActive && <ActivityIndicator size="small" />}
          <View style={styles.headerSpacer} />
          <LanguageToggle />
        </View>
        <ThemedText themeColor="textSecondary" type="small">
          {t('batches.subtitle')}
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.composeCard}>
          <TextInput
            value={promptsText}
            onChangeText={setPromptsText}
            placeholder={t('batches.promptPlaceholder')}
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
            {t('batches.jobCount', { count: jobCount, max: MAX_JOBS })}
          </ThemedText>

          <ModelChips mode="batch" value={model} onChange={setModel} visibleCount={6} />

          <Pressable
            disabled={submitting || jobCount === 0}
            onPress={() => void handleSubmit()}
            style={({ pressed }) => [
              styles.submitButton,
              (pressed || submitting || jobCount === 0) && styles.pressedDim,
            ]}>
            {submitting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <ThemedText type="smallBold" themeColor="backgroundElement">
                {t('batches.send')}
              </ThemedText>
            )}
          </Pressable>
        </ThemedView>

        <View style={styles.history}>
          {history.length === 0 ? (
            <ThemedText themeColor="textSecondary" type="small" style={styles.emptyHint}>
              {t('batches.historyEmpty')}
            </ThemedText>
          ) : (
            history.map((item) => (
              <BatchCard
                key={item.id}
                item={item}
                onCopyAll={() => copyAllAnswers(item)}
                onSaveCsv={() => saveCsv(item)}
                onExportJson={() => exportJson(item)}
                onCopyPrompt={(prompt) => copyTextSafe(t('batches.copyPromptLabel'), prompt)}
                onRemove={() => removeItem(item.id)}
              />
            ))
          )}
        </View>
      </ThemedView>
    </ScrollView>
  );
}
type BatchCardProps = {
  item: HistoryItem;
  onCopyAll: () => void;
  onSaveCsv: () => void;
  onExportJson: () => void;
  onCopyPrompt: (prompt: string) => void;
  onRemove: () => void;
};

function BatchCard({
  item,
  onCopyAll,
  onSaveCsv,
  onExportJson,
  onCopyPrompt,
  onRemove,
}: BatchCardProps) {
  const { t } = useI18n();
  const status = item.error ? 'error' : item.batch?.status ?? 'pending';
  const completed = item.batch?.status === 'completed';
  const answers = item.batch && completed ? extractBatchAnswers(item.batch) : [];
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
            completed ? styles.statusOk : status === 'error' ? styles.statusErr : null,
          ]}>
          <ThemedText type="code" themeColor="text">
            {t(`status.${status}` as never)}
          </ThemedText>
        </View>
      </View>

      {counts ? (
        <ThemedText type="code" themeColor="textSecondary">
          {t('batches.doneCount', { completed: counts.completed, total: counts.total })}
          {counts.failed > 0 ? t('batches.errorsCount', { failed: counts.failed }) : ''}
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
            const index = Number((answer.custom_id || 'req-1').replace(/\D/g, '')) - 1;
            const prompt = item.prompts[index] ?? '';
            return (
              <View key={answer.custom_id} style={styles.answerBlock}>
                <View style={styles.answerPromptRow}>
                  <ThemedText type="smallBold" style={styles.answerPrompt}>
                    {prompt}
                  </ThemedText>
                  <Pressable onPress={() => onCopyPrompt(prompt)} style={styles.copyIcon}>
                    <ThemedText type="code" themeColor="textSecondary">
                      ⧉
                    </ThemedText>
                  </Pressable>
                </View>
                {answer.ok ? (
                  <MathAnswer text={answer.answer ?? ''} />
                ) : (
                  <ThemedText type="small" style={styles.errorText}>
                    ❌ {answer.error ?? t('batches.noAnswer')}
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
          style={[styles.actionButton, !completed && styles.pressedDim]}>
          <ThemedText type="small" themeColor={completed ? 'textSecondary' : undefined}>
            {t('batches.copyAll')}
          </ThemedText>
        </Pressable>
        <Pressable
          disabled={!completed}
          onPress={onSaveCsv}
          style={[styles.actionButton, !completed && styles.pressedDim]}>
          <ThemedText type="small" themeColor={completed ? 'textSecondary' : undefined}>
            {t('batches.saveCsv')}
          </ThemedText>
        </Pressable>
        <Pressable
          disabled={!completed}
          onPress={onExportJson}
          style={[styles.actionButton, !completed && styles.pressedDim]}>
          <ThemedText type="small" themeColor={completed ? 'textSecondary' : undefined}>
            {t('batches.exportJson')}
          </ThemedText>
        </Pressable>
        <Pressable onPress={onRemove} style={styles.actionButton}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('batches.delete')}
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}
const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
  },
  container: {
    gap: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerSpacer: {
    flex: 1,
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
    fontSize: 15,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: '#3c87f7',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  history: {
    gap: Spacing.three,
  },
  emptyHint: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  card: {
    borderRadius: Spacing.four,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  cardHeaderText: {
    flex: 1,
    gap: 2,
  },
  statusBadge: {
    backgroundColor: 'rgba(128,128,128,0.2)',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  statusOk: {
    backgroundColor: 'rgba(40,167,69,0.25)',
  },
  statusErr: {
    backgroundColor: 'rgba(220,53,69,0.25)',
  },
  errorText: {
    color: '#e05252',
  },
  answers: {
    gap: Spacing.three,
  },
  answerBlock: {
    gap: 4,
  },
  answerPromptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  answerPrompt: {
    flex: 1,
  },
  copyIcon: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
