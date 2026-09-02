import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useI18n } from "@/i18n";
import { exportBackup, pickAndRestoreBackup } from "@/services/backup";

type Busy = "idle" | "exporting" | "importing";

export function BackupCard() {
  const { t } = useI18n();
  const [busy, setBusy] = useState<Busy>("idle");
  const [statusText, setStatusText] = useState("");

  const handleExport = async () => {
    setBusy("exporting");
    setStatusText(t("backup.exporting"));
    try {
      const outcome = await exportBackup();
      if (outcome === "saved") setStatusText(t("backup.exportSaved"));
      else if (outcome === "shared") setStatusText(t("backup.exportShared"));
      else {
        setStatusText("");
        Alert.alert(t("common.failed"), t("backup.exportFail"));
      }
    } catch (error) {
      setStatusText("");
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert(t("common.failed"), message);
    } finally {
      setBusy("idle");
    }
  };

  const runImport = async () => {
    setBusy("importing");
    setStatusText(t("backup.importing"));
    try {
      const outcome = await pickAndRestoreBackup();
      if (outcome === "restored") setStatusText(t("backup.importDone"));
      else if (outcome === "invalid") {
        setStatusText("");
        Alert.alert(t("common.failed"), t("backup.importInvalid"));
      } else {
        setStatusText("");
      }
    } catch (error) {
      setStatusText("");
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert(t("common.failed"), message || t("backup.importFail"));
    } finally {
      setBusy("idle");
    }
  };

  const handleImport = () => {
    Alert.alert(t("backup.importConfirmTitle"), t("backup.importConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.ok"), style: "destructive", onPress: () => void runImport() },
    ]);
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.rowBetween}>
        <ThemedText type="smallBold">{t("backup.title")}</ThemedText>
        {busy !== "idle" && <ActivityIndicator size="small" />}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {t("backup.subtitle")}
      </ThemedText>

      <View style={styles.buttonRow}>
        <Pressable
          disabled={busy !== "idle"}
          onPress={handleExport}
          style={({ pressed }) => [
            styles.buttonGhost,
            (pressed || busy !== "idle") && styles.buttonDim,
          ]}
        >
          <ThemedText type="small" themeColor="textSecondary">
            {t("backup.export")}
          </ThemedText>
        </Pressable>
        <Pressable
          disabled={busy !== "idle"}
          onPress={handleImport}
          style={({ pressed }) => [
            styles.buttonGhost,
            (pressed || busy !== "idle") && styles.buttonDim,
          ]}
        >
          <ThemedText type="small" themeColor="textSecondary">
            {t("backup.import")}
          </ThemedText>
        </Pressable>
      </View>

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
