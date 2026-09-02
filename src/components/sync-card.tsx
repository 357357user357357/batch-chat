import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useI18n } from "@/i18n";
import {
  getSyncSettings,
  pairDevice,
  runSync,
  unpairDevice,
  type SyncSettings,
} from "@/services/sync";

type Busy = "idle" | "pairing" | "syncing";

export function SyncCard() {
  const theme = useTheme();
  const { t } = useI18n();
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<Busy>("idle");
  const [statusText, setStatusText] = useState("");

  const refresh = useCallback(async () => {
    setSettings(await getSyncSettings());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handlePair = async () => {
    if (!serverUrl.trim() || !password) return;
    setBusy("pairing");
    setStatusText("");
    try {
      await pairDevice(serverUrl, password);
      setPassword("");
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert(t("sync.pairFail"), message);
    } finally {
      setBusy("idle");
    }
  };

  const handleUnpair = () => {
    Alert.alert(t("sync.unpairConfirmTitle"), t("sync.unpairConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.ok"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            await unpairDevice();
            setStatusText("");
            await refresh();
          })();
        },
      },
    ]);
  };

  const handleSync = async () => {
    setBusy("syncing");
    setStatusText(t("sync.syncing"));
    try {
      const result = await runSync();
      setStatusText(
        t("sync.syncDone", { pushed: result.pushed, pulled: result.pulled })
      );
      await refresh();
    } catch (error) {
      setStatusText("");
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert(t("sync.syncFail"), message);
    } finally {
      setBusy("idle");
    }
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.rowBetween}>
        <ThemedText type="smallBold">{t("sync.title")}</ThemedText>
        {busy !== "idle" && <ActivityIndicator size="small" />}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {t("sync.subtitle")}
      </ThemedText>

      {settings ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {t("sync.pairedWith", { server: settings.serverUrl })}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {settings.lastSyncAt
              ? t("sync.lastSynced", {
                  time: new Date(settings.lastSyncAt).toLocaleString(),
                })
              : t("sync.neverSynced")}
          </ThemedText>
          <View style={styles.buttonRow}>
            <Pressable
              disabled={busy !== "idle"}
              onPress={handleUnpair}
              style={({ pressed }) => [
                styles.buttonGhost,
                (pressed || busy !== "idle") && styles.buttonDim,
              ]}
            >
              <ThemedText type="small" themeColor="textSecondary">
                {t("sync.unpair")}
              </ThemedText>
            </Pressable>
            <Pressable
              disabled={busy !== "idle"}
              onPress={handleSync}
              style={({ pressed }) => [
                styles.buttonGhost,
                (pressed || busy !== "idle") && styles.buttonDim,
              ]}
            >
              <ThemedText type="small" themeColor="textSecondary">
                {t("sync.syncNow")}
              </ThemedText>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <TextInput
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder={t("sync.serverPlaceholder")}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[
              styles.input,
              {
                color: theme.text,
                borderColor: theme.backgroundSelected,
                backgroundColor: theme.background,
              },
            ]}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder={t("sync.passwordPlaceholder")}
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
            disabled={busy !== "idle" || !serverUrl.trim() || !password}
            onPress={handlePair}
            style={({ pressed }) => [
              styles.button,
              (pressed || busy !== "idle" || !serverUrl.trim() || !password) &&
                styles.buttonDim,
            ]}
          >
            {busy === "pairing" ? (
              <ActivityIndicator size="small" color={theme.background} />
            ) : (
              <ThemedText type="smallBold" themeColor="text">
                {t("sync.pair")}
              </ThemedText>
            )}
          </Pressable>
        </>
      )}

      {statusText ? (
        <ThemedText type="small" style={styles.status}>
          {statusText}
        </ThemedText>
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
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  button: {
    alignItems: "center",
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    backgroundColor: "#4f8cff",
  },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  buttonGhost: {
    flex: 1,
    alignItems: "center",
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(128,128,128,0.4)",
  },
  buttonDim: {
    opacity: 0.5,
  },
  status: {
    marginTop: Spacing.one,
  },
});
