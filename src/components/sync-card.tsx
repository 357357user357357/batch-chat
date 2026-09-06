import { useCallback, useEffect, useRef, useState } from "react";
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
  getRememberedCredentials,
  getSyncSettings,
  pairDevice,
  parsePairingCode,
  registerAccount,
  runSync,
  saveRememberedCredentials,
  signInWithGoogle,
  unpairDevice,
  type SyncSettings,
} from "@/services/sync";

type Busy = "idle" | "pairing" | "syncing";
type Mode = "pair" | "register";

export function SyncCard() {
  const theme = useTheme();
  const { t } = useI18n();
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [mode, setMode] = useState<Mode>("pair");
  const [busy, setBusy] = useState<Busy>("idle");
  const [statusText, setStatusText] = useState("");

  const refresh = useCallback(async () => {
    setSettings(await getSyncSettings());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const performSync = useCallback(async () => {
    setBusy("syncing");
    setStatusText(t("sync.syncing"));
    try {
      const result = await runSync();
      setStatusText(
        t("sync.syncDone", { pushed: result.pushed, pulled: result.pulled })
      );
      await refresh();
    } finally {
      setBusy("idle");
    }
  }, [t, refresh]);

  const handlePair = async () => {
    // A full pairing code ("https://host|id|key") carries the server address:
    // auto-fill the URL field when the user only pasted the code.
    const parsed = parsePairingCode(password);
    const effectiveUrl = serverUrl.trim() || parsed.serverUrl || "";
    if (parsed.serverUrl && !serverUrl.trim()) setServerUrl(parsed.serverUrl);
    if (!effectiveUrl || !password) return;
    setBusy("pairing");
    setStatusText("");
    try {
      await pairDevice(effectiveUrl, password, login);
      if (remember && login.trim()) {
        await saveRememberedCredentials({ login: login.trim(), password });
      } else {
        await saveRememberedCredentials(null);
      }
      setPassword("");
      await refresh();
      // Immediately push/pull so the freshly-paired device is up to date.
      try {
        await performSync();
      } catch {
        // Pairing succeeded; a sync error here can be retried via "Sync now".
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert(t("sync.pairFail"), message);
    } finally {
      setBusy("idle");
    }
  };

  const handleRegister = async () => {
    const effectiveUrl = serverUrl.trim();
    if (!effectiveUrl || !login.trim() || password.length < 6) return;
    setBusy("pairing");
    setStatusText("");
    try {
      const result = await registerAccount(effectiveUrl, login, password);
      if (remember) {
        await saveRememberedCredentials({ login: login.trim(), password });
      } else {
        await saveRememberedCredentials(null);
      }
      setPassword("");
      setMode("pair");
      setStatusText(
        result.detail || "Confirmation e-mail sent — check your inbox, then pair.",
      );
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert(t("sync.pairFail"), message);
    } finally {
      setBusy("idle");
    }
  };

  const handleGoogle = async () => {
    const effectiveUrl = serverUrl.trim();
    if (!effectiveUrl) return;
    setBusy("pairing");
    setStatusText("");
    try {
      await signInWithGoogle(effectiveUrl);
      await refresh();
      try {
        await performSync();
      } catch {
        // Sign-in succeeded; sync can be retried via "Sync now".
      }
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
    try {
      await performSync();
    } catch (error) {
      setStatusText("");
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert(t("sync.syncFail"), message);
    }
  };

  // Auto-sync once on mount when already paired (upload/download over the
  // internet without needing to tap "Sync now"). Pre-fill remembered
  // credentials so re-pairing after an expiry is one tap.
  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (autoSyncedRef.current) return;
    autoSyncedRef.current = true;
    void (async () => {
      const remembered = await getRememberedCredentials();
      if (remembered) {
        setLogin(remembered.login);
        setRemember(true);
      }
      const existing = await getSyncSettings();
      if (!existing) return;
      try {
        await performSync();
      } catch {
        // Silent on launch — the manual button still surfaces real errors.
      }
    })();
  }, [performSync]);

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
            value={login}
            onChangeText={setLogin}
            placeholder={
              mode === "register"
                ? "E-mail (you'll get a confirmation link)"
                : t("sync.loginPlaceholder")
            }
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={mode === "register" ? "email-address" : "default"}
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
            placeholder={
              mode === "register" ? "Password (min 6 chars)" : t("sync.passwordPlaceholder")
            }
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
            onPress={() => setRemember(!remember)}
            style={styles.rememberRow}
          >
            <ThemedText type="small" themeColor="textSecondary">
              {remember ? "☑" : "☐"} {t("sync.remember")}
            </ThemedText>
          </Pressable>
          <Pressable
            disabled={
              busy !== "idle" ||
              !password ||
              !(serverUrl.trim() || parsePairingCode(password).serverUrl) ||
              (mode === "register" && (!login.trim() || password.length < 6))
            }
            onPress={mode === "register" ? handleRegister : handlePair}
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
                {mode === "register" ? t("sync.registerTitle") : t("sync.pair")}
              </ThemedText>
            )}
          </Pressable>
          <Pressable
            disabled={busy !== "idle"}
            onPress={handleGoogle}
            style={({ pressed }) => [styles.buttonGhost, pressed && styles.buttonDim]}
          >
            <ThemedText type="small" themeColor="textSecondary">
              Sign in with Google
            </ThemedText>
          </Pressable>
          <Pressable
            disabled={busy !== "idle"}
            onPress={() => setMode(mode === "register" ? "pair" : "register")}
            style={({ pressed }) => [styles.buttonGhost, pressed && styles.buttonDim]}
          >
            <ThemedText type="small" themeColor="textSecondary">
              {mode === "register" ? t("sync.backToLogin") : t("sync.createAccount")}
            </ThemedText>
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
  rememberRow: {
    marginTop: -4,
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
