import { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    StyleSheet,
    TextInput,
    View,
    type ViewStyle,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useI18n } from "@/i18n";
import {
    clearStoredApiKey,
    clearStoredTavilyApiKey,
    getStoredApiKey,
    getStoredTavilyApiKey,
    isSecureStorageAvailable,
    storeApiKey,
    storeTavilyApiKey,
} from "@/services/key-store";
import {
    createBatch,
    extractBatchAnswers,
    getEnvApiKey,
    waitForBatch,
    type BatchOutcome,
    type OpenRouterBatch,
} from "@/services/openrouter";
import { searchWeb } from "@/services/tavily";

const DEMO_JOBS = [
  {
    messages: [
      {
        role: "user" as const,
        content: "What is the capital of Japan? Answer in one word.",
      },
    ],
  },
  {
    messages: [
      {
        role: "user" as const,
        content: "What is 40 + 2? Answer with the number only.",
      },
    ],
  },
  {
    messages: [
      {
        role: "user" as const,
        content: "What does add(40, 2) return? Answer with the number only.",
      },
    ],
  },
];

type Busy = "idle" | "saving" | "running" | "done";

export function BatchTestCard({ style }: { style?: ViewStyle }) {
  const theme = useTheme();
  const { t } = useI18n();
  const [inputKey, setInputKey] = useState("");
  const [envKey, setEnvKey] = useState<string | undefined>();
  const [storedKey, setStoredKey] = useState<string | null>(null);
  const [tavilyKey, setTavilyKey] = useState<string | null>(null);
  const [tavilyInputKey, setTavilyInputKey] = useState("");
  const [busy, setBusy] = useState<Busy>("idle");
  const [statusText, setStatusText] = useState("");
  const [batch, setBatch] = useState<OpenRouterBatch | null>(null);
  const [answers, setAnswers] = useState<BatchOutcome[]>([]);

  const refreshKeyState = useCallback(async () => {
    setEnvKey(getEnvApiKey());
    setStoredKey(await getStoredApiKey());
    setTavilyKey(await getStoredTavilyApiKey());
  }, []);

  useEffect(() => {
    void refreshKeyState();
  }, [refreshKeyState]);

  const handleSaveKey = async () => {
    const key = inputKey.trim();
    if (!key) return;
    if (!isSecureStorageAvailable()) {
      Alert.alert(t("common.failed"), t("card.secureUnavailable"));
      return;
    }
    setBusy("saving");
    const saved = await storeApiKey(key);
    setBusy("idle");
    if (saved) {
      setInputKey("");
      await refreshKeyState();
      setStatusText(t("card.keySaved"));
    } else {
      Alert.alert(t("common.failed"), t("card.keySavedFail"));
    }
  };

  const handleDeleteKey = async () => {
    await clearStoredApiKey();
    await refreshKeyState();
    setStatusText(t("card.keyDeleted"));
  };

  const handleSaveTavilyKey = async () => {
    const key = tavilyInputKey.trim();
    if (!key) return;
    if (!isSecureStorageAvailable()) {
      Alert.alert(t("common.failed"), t("card.secureUnavailable"));
      return;
    }
    setBusy("saving");
    const saved = await storeTavilyApiKey(key);
    setBusy("idle");
    if (saved) {
      setTavilyInputKey("");
      await refreshKeyState();
      setStatusText(t("card.tavilySaved"));
    } else {
      Alert.alert(t("common.failed"), t("card.keySavedFail"));
    }
  };

  const handleDeleteTavilyKey = async () => {
    await clearStoredTavilyApiKey();
    await refreshKeyState();
    setStatusText(t("card.tavilyDeleted"));
  };

  const handleTestTavily = async () => {
    if (!tavilyKey) {
      Alert.alert(t("common.failed"), t("card.tavilyNoKey"));
      return;
    }
    setBusy("running");
    setStatusText(t("card.tavilyTesting"));
    try {
      const results = await searchWeb("latest AI research news", {
        maxResults: 1,
        includeAnswer: true,
      });
      const item = results[0];
      if (!item) {
        throw new Error("Tavily returned no results.");
      }
      setStatusText(
        t("card.tavilySearchResult", { title: item.title, url: item.url }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(t("card.errorPrefix", { message }));
      Alert.alert(t("common.failed"), message);
    } finally {
      setBusy("idle");
    }
  };

  const handleRunBatch = async () => {
    setAnswers([]);
    setBatch(null);
    setStatusText(t("card.creating"));
    setBusy("running");
    try {
      const created = await createBatch(DEMO_JOBS);
      setBatch(created);
      setStatusText(
        t("card.batchCreated", { id: created.id, status: created.status }),
      );
      const done = await waitForBatch(created.id, {
        pollIntervalMs: 10_000,
        timeoutMs: 120 * 60_000,
        onPoll: (current) =>
          setStatusText(
            t("card.batchPolling", {
              id: current.id,
              status: current.status,
              completed: current.request_counts.completed,
              total: current.request_counts.total,
            }),
          ),
      });
      setBatch(done);
      setAnswers(extractBatchAnswers(done));
      setStatusText(
        t("card.batchDone", {
          status: done.status,
          total: done.request_counts.total,
          failed: done.request_counts.failed,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(t("card.errorPrefix", { message }));
      Alert.alert(t("card.batchError"), message);
    } finally {
      setBusy("idle");
    }
  };

  const hasAnyKey = Boolean(envKey || storedKey);

  return (
    <ThemedView type="backgroundElement" style={[styles.card, style]}>
      <View style={styles.rowBetween}>
        <ThemedText type="smallBold">{t("card.title")}</ThemedText>
        {busy === "running" && <ActivityIndicator size="small" />}
      </View>

      <View style={styles.inputRow}>
        <TextInput
          value={inputKey}
          onChangeText={setInputKey}
          placeholder={t("card.keyPlaceholder")}
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
          disabled={busy === "saving" || !inputKey.trim()}
          onPress={handleSaveKey}
          style={({ pressed }) => [
            styles.button,
            (pressed || busy === "saving" || !inputKey.trim()) &&
              styles.buttonDim,
          ]}
        >
          {busy === "saving" ? (
            <ActivityIndicator size="small" color={theme.background} />
          ) : (
            <ThemedText type="smallBold" themeColor="text">
              {storedKey ? t("card.change") : t("card.save")}
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
          ]}
        >
          <ThemedText
            type="small"
            themeColor={storedKey ? "textSecondary" : undefined}
          >
            {t("card.keyDelete")}
          </ThemedText>
        </Pressable>
        <Pressable
          disabled={!hasAnyKey || busy === "running"}
          onPress={handleRunBatch}
          style={({ pressed }) => [
            styles.button,
            (pressed || busy === "running" || !hasAnyKey) &&
              styles.buttonDisabled,
          ]}
        >
          <ThemedText type="smallBold" themeColor="backgroundElement">
            {t("card.runTest")}
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.sectionBreak} />

      <ThemedText type="smallBold">{t("card.tavilyTitle")}</ThemedText>
      <View style={styles.inputRow}>
        <TextInput
          value={tavilyInputKey}
          onChangeText={setTavilyInputKey}
          placeholder={t("card.tavilyPlaceholder")}
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
          disabled={busy === "saving" || !tavilyInputKey.trim()}
          onPress={handleSaveTavilyKey}
          style={({ pressed }) => [
            styles.button,
            (pressed || busy === "saving" || !tavilyInputKey.trim()) &&
              styles.buttonDim,
          ]}
        >
          <ThemedText type="smallBold" themeColor="text">
            {tavilyKey ? t("card.tavilyChange") : t("card.tavilySave")}
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          disabled={!tavilyKey}
          onPress={handleDeleteTavilyKey}
          style={({ pressed }) => [
            styles.buttonGhost,
            pressed && styles.buttonGhostPressed,
            !tavilyKey && styles.buttonDisabled,
          ]}
        >
          <ThemedText
            type="small"
            themeColor={tavilyKey ? "textSecondary" : undefined}
          >
            {t("card.tavilyDelete")}
          </ThemedText>
        </Pressable>
        <Pressable
          disabled={!tavilyKey || busy === "running"}
          onPress={handleTestTavily}
          style={({ pressed }) => [
            styles.button,
            (pressed || busy === "running" || !tavilyKey) &&
              styles.buttonDisabled,
          ]}
        >
          <ThemedText type="smallBold" themeColor="backgroundElement">
            {t("card.tavilyTest")}
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
          {batch.id} · {batch.status} · {batch.request_counts.completed}/
          {batch.request_counts.total}
        </ThemedText>
      ) : null}

      {answers.length > 0 ? (
        <View style={styles.answers}>
          {answers.map((answer) => (
            <ThemedView
              key={answer.custom_id}
              type="backgroundSelected"
              style={styles.answerRow}
            >
              <ThemedText type="code" themeColor="textSecondary">
                {answer.custom_id}
              </ThemedText>
              <ThemedText type="small">
                {answer.ok ? answer.answer : `❌ ${answer.error ?? "unknown"}`}
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
    alignSelf: "stretch",
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
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
    backgroundColor: "#3c87f7",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: "center",
    justifyContent: "center",
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
    backgroundColor: "rgba(128,128,128,0.15)",
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
