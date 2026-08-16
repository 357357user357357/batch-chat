import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

import { MathAnswer } from '@/components/math-answer';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createBatch,
  extractBatchAnswers,
  waitForBatch,
  type OpenRouterBatch,
} from '@/services/openrouter';

const MODEL_OPTIONS = [
  { id: 'google/gemini-3.7-flash:batch', label: 'Gemini 3.7 Flash batch', price: '≈$0.19/$0.94 за 1M' },
  { id: 'anthropic/claude-fable-5:batch', label: 'Claude Fable 5 batch', price: '$5/$25 за 1M' },
];

const MAX_JOBS = 30;

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

export default function BatchesScreen() {
  const theme = useTheme();
  const safeAreaInsets = useSafeAreaInsets();
  const insets = {
    ...safeAreaInsets,
    bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
  };
  const [promptsText, setPromptsText] = useState('');
  const [model, setModel] = useState(MODEL_OPTIONS[0].id);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const updateItem = useCallback((id: string, patch: Partial<HistoryItem>) => {
    setHistory((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

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
      void (async () => {
        try {
          const done = await waitForBatch(created.id, {
            pollIntervalMs: 10_000,
            timeoutMs: 120 * 60_000,
            onPoll: (current) => updateItem(created.id, { batch: current }),
          });
          updateItem(created.id, { batch: done, error: undefined });
        } catch (error) {
          updateItem(created.id, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    },
    [updateItem]
  );

  const handleSubmit = async () => {
    const prompts = promptsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_JOBS);
    if (!prompts.length) {
      Alert.alert('Пусто', 'Введите хотя бы один вопрос — каждая строка = отдельный запрос.');
      return;
    }
    if (!model.trim()) {
      Alert.alert('Модель', 'Укажите модель.');
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
      Alert.alert('Не удалось создать батч', error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const copyTextSafe = async (label: string, text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert('Скопировано', `${label} — в буфере обмена.`);
    } catch (error) {
      Alert.alert('Не удалось скопировать', error instanceof Error ? error.message : String(error));
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
    await copyTextSafe('Ответы', text);
  };

  const shareCsv = async (item: HistoryItem) => {
    try {
      await Share.share({ title: `${item.id}.csv`, message: buildCsv(item) });
    } catch (error) {
      Alert.alert('Не удалось поделиться', error instanceof Error ? error.message : String(error));
    }
  };

  const removeItem = (id: string) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));
  };

  const jobCount = promptsText.split('\n').map((l) => l.trim()).filter(Boolean).length;
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
          <ThemedText type="subtitle">Батчи</ThemedText>
          {history.some((item) => item.batch && !/final/.test(item.batch.status)) && (
            <ActivityIndicator size="small" />
          )}
        </View>
        <ThemedText themeColor="textSecondary" type="small">
          Одна строка = один запрос. Отправляй пачкой и возвращайся: ответы (и формулы) соберутся
          прямо здесь.
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.composeCard}>
          <TextInput
            value={promptsText}
            onChangeText={setPromptsText}
            placeholder={'Вопрос №1\nВопрос №2\nВопрос №3…'}
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
            {jobCount} / {MAX_JOBS} запросов
          </ThemedText>

          <View style={styles.modelRow}>
            {MODEL_OPTIONS.map((option) => {
              const selected = model === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => setModel(option.id)}
                  style={({ pressed }) => [
                    styles.modelChip,
                    selected && styles.modelChipSelected,
                    pressed && styles.pressedDim,
                  ]}>
                  <ThemedText type="smallBold" themeColor={selected ? 'text' : 'textSecondary'}>
                    {option.label}
                  </ThemedText>
                  <ThemedText type="code" themeColor="textSecondary">
                    {option.price}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={model}
            onChangeText={setModel}
            placeholder="Или впиши свою модель (например, без :batch)"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.modelInput,
              {
                color: theme.text,
                borderColor: theme.backgroundSelected,
                backgroundColor: theme.background,
              },
            ]}
          />

          <Pressable
            disabled={submitting || jobCount === 0}
            onPress={handleSubmit}
            style={({ pressed }) => [
              styles.submitButton,
              (pressed || submitting || jobCount === 0) && styles.pressedDim,
            ]}>
            {submitting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <ThemedText type="smallBold" themeColor="backgroundElement">
                Отправить батч
              </ThemedText>
            )}
          </Pressable>
        </ThemedView>

        <View style={styles.history}>
          {history.length === 0 ? (
            <ThemedText themeColor="textSecondary" type="small" style={styles.emptyHint}>
              История пуста — отправь первый батч.
            </ThemedText>
          ) : (
            history.map((item) => (
              <BatchCard
                key={item.id}
                item={item}
                onCopyAll={() => copyAllAnswers(item)}
                onShareCsv={() => shareCsv(item)}
                onCopyPrompt={(prompt) => copyTextSafe('Вопрос', prompt)}
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
  onShareCsv: () => void;
  onCopyPrompt: (prompt: string) => void;
  onRemove: () => void;
};

function BatchCard({ item, onCopyAll, onShareCsv, onCopyPrompt, onRemove }: BatchCardProps) {
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
            {status}
          </ThemedText>
        </View>
      </View>

      {counts ? (
        <ThemedText type="code" themeColor="textSecondary">
          {counts.completed}/{counts.total} готово
          {counts.failed > 0 ? ` · ${counts.failed} ошибок` : ''}
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
                    ❌ {answer.error ?? 'без ответа'}
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
            Копировать все
          </ThemedText>
        </Pressable>
        <Pressable
          disabled={!completed}
          onPress={onShareCsv}
          style={[styles.actionButton, !completed && styles.pressedDim]}>
          <ThemedText type="small" themeColor={completed ? 'textSecondary' : undefined}>
            CSV · поделиться
          </ThemedText>
        </Pressable>
        <Pressable onPress={onRemove} style={styles.actionButton}>
          <ThemedText type="small" themeColor="textSecondary">
            Удалить
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
  modelRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  modelChip: {
    flex: 1,
    minWidth: 150,
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two,
    gap: 2,
    borderColor: 'transparent',
  },
  modelChipSelected: {
    borderColor: '#3c87f7',
    backgroundColor: 'rgba(60,135,247,0.15)',
  },
  modelInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 13,
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