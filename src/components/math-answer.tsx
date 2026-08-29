import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { MathArticle, type MathArticleHandle } from "@/components/math-article";
import { containsMath } from "@/components/math-segments";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useI18n } from "@/i18n";

/**
 * Renders AI text that may contain LaTeX: plain paragraphs + MathJax formulas.
 * The rendered text is selectable — select any portion, tap "Copy selection"
 * to copy just that part (formulas are copied as their LaTeX source), or open
 * the raw source view to copy the whole answer.
 */
export function MathAnswer({
  text,
  fontSize = 17,
}: {
  text: string;
  fontSize?: number;
}) {
  const { t } = useI18n();
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const articleRef = useRef<MathArticleHandle>(null);
  const hasMath = useMemo(() => containsMath(text), [text]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  // Selection inside the rendered math view copies only the selected portion
  // (LaTeX formulas included) straight to the clipboard — no source view.
  const handleMathCopy = (_copiedText: string) => {
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 5000);
  };

  // Raw Markdown view: the whole answer (text + `$$…$$` LaTeX) as selectable
  // text, so any chunk can be long-pressed and copied *with its formulas*.
  if (showSource) {
    return (
      <View style={styles.container}>
        <ThemedText type="code" selectable style={styles.sourceText}>
          {text}
        </ThemedText>
        <Pressable
          onPress={() => setShowSource(false)}
          hitSlop={6}
          style={styles.toggle}
        >
          <ThemedText type="code" themeColor="textSecondary">
            {t("math.rendered")}
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  // No math → plain selectable text (no webview needed).
  if (!hasMath) {
    return (
      <ThemedText type="small" selectable>
        {text}
      </ThemedText>
    );
  }

  return (
    <View style={styles.container}>
      <MathArticle
        ref={articleRef}
        text={text}
        fontSize={fontSize}
        onCopy={handleMathCopy}
        onSelectionChange={setHasSelection}
      />
      {hasSelection ? (
        <Pressable
          onPressIn={() => articleRef.current?.requestCopy()}
          hitSlop={6}
          style={styles.copySelection}
          accessibilityRole="button"
        >
          <ThemedText type="smallBold" style={styles.copySelectionText}>
            ⧉ {t("chat.copySelection")}
          </ThemedText>
        </Pressable>
      ) : null}
      <View style={styles.footerRow}>
        <ThemedText
          type="small"
          themeColor={copied ? "text" : "textSecondary"}
          style={styles.copyHint}
        >
          {copied ? `✓ ${t("chat.copied")}` : t("math.copyHint")}
        </ThemedText>
        <Pressable
          onPress={() => setShowSource(true)}
          hitSlop={6}
          style={styles.toggle}
        >
          <ThemedText type="code" themeColor="textSecondary">
            {t("math.source")}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  sourceText: {
    lineHeight: 20,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  copyHint: {
    flex: 1,
    alignSelf: "center",
  },
  copySelection: {
    alignSelf: "flex-end",
    backgroundColor: "#3c87f7",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  copySelectionText: {
    color: "#ffffff",
  },
  toggle: {
    alignSelf: "center",
    marginTop: 2,
  },
});
