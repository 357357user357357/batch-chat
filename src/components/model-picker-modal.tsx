import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ModelBrowser } from "@/components/model-browser";
import { ModelChips } from "@/components/model-chips";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useI18n } from "@/i18n";

export type ModelPickerModalProps = {
  visible: boolean;
  mode: "batch" | "live";
  value: string;
  onChange: (id: string) => void;
  onClose: () => void;
};

/**
 * Bottom-sheet model picker (chips + full browser), opened on demand so the
 * catalog doesn't sit inline between the message list and the composer.
 */
export function ModelPickerModal({
  visible,
  mode,
  value,
  onChange,
  onClose,
}: ModelPickerModalProps) {
  const theme = useTheme();
  const { t } = useI18n();

  const pick = (id: string) => {
    onChange(id);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel={t("common.close")}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.background,
              borderColor: theme.backgroundSelected,
            },
          ]}
        >
          <View
            style={[
              styles.header,
              { borderBottomColor: theme.backgroundSelected },
            ]}
          >
            <ThemedText type="smallBold">{t("models.title")}</ThemedText>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeButton}>
              <ThemedText type="subtitle" style={styles.closeText}>
                ×
              </ThemedText>
            </Pressable>
          </View>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            <ModelChips
              mode={mode}
              value={value}
              onChange={pick}
              visibleCount={6}
            />
            <ModelBrowser selectedId={value} onSelect={pick} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "80%",
    borderTopWidth: 1,
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
  },
  closeButton: {
    paddingHorizontal: Spacing.two,
  },
  closeText: {
    lineHeight: 26,
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
});
