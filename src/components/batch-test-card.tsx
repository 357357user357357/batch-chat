import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  clearStoredApiKey,
  getStoredApiKey,
  isSecureStorageAvailable,
  storeApiKey,
} from '@/services/key-store';
import {
  createBatch,
  extractBatchAnswers,
  getEnvApiKey,
  OPENROUTER_BATCH_MODEL,
  waitForBatch,
  type BatchOutcome,
  type OpenRouterBatch,
} from '@/services/openrouter';

const DEMO_JOBS = [
  {
    messages: [{ role: 'user' as const, content: 'Какой столицей Японии? Ответь одним словом.' }],
  },
  {
    messages: [{ role: 'user' as const, content: 'Сколько будет 40 + 2? Ответь числом.' }],
  },
  {
    messages: [{ role: 'user' as const, content: 'Что вернёт функция add(40, 2)? Ответь числом.' }],
  },
];

type Busy = 'idle' | 'saving' | 'running' | 'done';

export function BatchTestCard({ style }: { style?: ViewStyle }) {
  const theme = useTheme();
  const [inputKey, setInputKey] = useState('');
  const [envKey, setEnvKey] = useState<string | undefined>();
  const [storedKey, setStoredKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>('idle');
  const [statusText, setStatusText] = useState('');
  const [batch, setBatch] = useState<OpenRouterBatch | null>(null);
  const [answers, setAnswers] = useState<BatchOutcome[]>([]);

  const refreshKeyState = useCallback(async () => {
    setEnvKey(getEnvApiKey());
    setStoredKey(await getStoredApiKey());
  }, []);

  useEffect(() => {
    void refreshKeyState();
  }, [refreshKeyState]);

  const handleSaveKey = async () => {
    const key = inputKey.trim();
    if (!key) return;
    if (!isSecureStorageAvailable()) {
      Alert.alert('Недоступно', 'Защищённое хранилище работает только на устройстве (не web).');
      return;
    }
    setBusy('saving');
    const saved = await storeApiKey(key);
    setBusy('idle');
    if (saved) {
      setInputKey('');
      await refreshKeyState();
      setStatusText('Ключ сохранён в защищённом хранилище (Android Keystore).');
    } else {
      Alert.alert('Ошибка', 'Не удалось сохранить ключ в защищённом хранилище.');
    }
  };

  const handleDeleteKey = async () => {
    await clearStoredApiKey();
    await refreshKeyState();
    setStatusText('Сохранённый на устройстве ключ удалён.');
  };

  const handleRunBatch = async () => {
    setAnswers([]);
    setBatch(null);
    setStatusText('Создаю batch…');
    setBusy('running');
    try {
      const created = await createBatch(DEMO_JOBS);
      setBatch(created);
      setStatusText(`Батч ${created.id} создан (${created.status}). Жду выполнения…`);
      const done = await waitForBatch(created.id, {
        pollIntervalMs: 10_000,
        timeoutMs: 120 * 60_000,
        onPoll: (current) =>
          setStatusText(
            `Батч ${current.id}: ${current.status} ` +
              `(${current.request_counts.completed}/${current.request_counts.total} готово)`
          ),
      });
      setBatch(done);
      setAnswers(extractBatchAnswers(done));
      setStatusText(
        `Батч завершён: ${done.status}. Всего запросов: ${done.request_counts.total}, ошибок: ${done.request_counts.failed}.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Ошибка: ${message}`);
      Alert.alert('Ошибка батча', message);
    } finally {
      setBusy('idle');
    }
  };

  const hasAnyKey = Boolean(envKey || storedKey);
  const masked =
    storedKey && storedKey.length > 8
      ? `${storedKey.slice(0, 6)}…${storedKey.slice(-4)}`
      : storedKey;

  return (
    <ThemedView type="backgroundElement" style={[styles.card, style]}>
      <View style={styles.rowBetween}>
        <ThemedText type="smallBold">OpenRouter: ключ и батчи</ThemedText>
        {busy === 'running' && <ActivityIndicator size="small" />}
      </View>

      <ThemedText themeColor="textSecondary" type="small">
        Модель батча: <ThemedText type="code">{OPENROUTER_BATCH_MODEL}</ThemedText> —
        примерно в 2 раза дешевле обычной модели; живёт до 24 ч.
      </ThemedText>

      {envKey ? (
        <ThemedText themeColor="textSecondary" type="small">
          Ключ из бандла (dev): <ThemedText type="code">EXPO_PUBLIC_*</ThemedText> — виден
          всем, кто скачает APK.
        </ThemedText>
      ) : null}

      {storedKey ? (
        <ThemedText themeColor="textSecondary" type="small">
          Ключ на устройстве: <ThemedText type="code">{masked}</ThemedText> (Android
          Keystore).
        </ThemedText>
      ) : null}

      <View style={styles.inputRow}>
        <TextInput
          value={inputKey}
          onChangeText={setInputKey}
          placeholder="Вставьте свой ключ sk-or-…"
          placeholderTextColor={theme.textSecondary}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.input,
            {
              color: theme.text,
              borderColor: theme.backgroundSelected,
              backgroundColor: theme.background,
            },
          ]}
        />
        <Pressable
          disabled={busy === 'saving' || !inputKey.trim()}
          onPress={handleSaveKey}
          style={({ pressed }) => [
            styles.button,
            (pressed || busy === 'saving' || !inputKey.trim()) && styles.buttonDim,
          ]}>
          {busy === 'saving' ? (
            <ActivityIndicator size="small" color={theme.background} />
          ) : (
            <ThemedText type="smallBold" themeColor="text">
              {storedKey ? 'Изменить' : 'Сохранить'}
            </ThemedText>
          )}
        </Pressable>
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          disabled={!storedKey}
          onPress={handleDeleteKey}
          style={({ pressed }) => [
            styles.buttonGhost,
            pressed && styles.buttonGhostPressed,
            !storedKey && styles.buttonDisabled,
          ]}>
          <ThemedText type="small" themeColor={storedKey ? 'textSecondary' : undefined}>
            Удалить ключ
          </ThemedText>
        </Pressable>
        <Pressable
          disabled={!hasAnyKey || busy === 'running'}
          onPress={handleRunBatch}
          style={({ pressed }) => [
            styles.button,
            (pressed || busy === 'running' || !hasAnyKey) && styles.buttonDisabled,
          ]}>
          <ThemedText type="smallBold" themeColor="backgroundElement">
            Запустить тест-батч
          </ThemedText>
        </Pressable>
      </View>

      {statusText ? (
        <ThemedText type="small" style={styles.status}>
          {statusText}
        </ThemedText>
      ) : null}

      {batch ? (
        <ThemedText themeColor="textSecondary" type="code" style={styles.mono}>
          {batch.id} · {batch.status} · {batch.request_counts.completed}/{batch.request_counts.total}
        </ThemedText>
      ) : null}

      {answers.length > 0 ? (
        <View style={styles.answers}>
          {answers.map((answer) => (
            <ThemedView key={answer.custom_id} type="backgroundSelected" style={styles.answerRow}>
              <ThemedText type="code" themeColor="textSecondary">
                {answer.custom_id}
              </ThemedText>
              <ThemedText type="small">
                {answer.ok ? answer.answer : `❌ ${answer.error ?? 'unknown'}`}
              </ThemedText>
            </ThemedView>
          ))}
        </View>
      ) : null}
    </ThemedView>
  );
}
const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.two,
    alignSelf: 'stretch',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  button: {
    backgroundColor: '#3c87f7',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDim: {
    opacity: 0.55,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  buttonGhost: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  buttonGhostPressed: {
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  status: {
    marginTop: Spacing.one,
  },
  mono: {
    fontSize: 11,
  },
  answers: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  answerRow: {
    borderRadius: Spacing.two,
    padding: Spacing.two,
    gap: Spacing.one,
  },
});