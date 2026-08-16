import { StyleSheet, Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useI18n } from '@/i18n';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import type { Language } from '@/i18n/strings';

const LANGUAGES: Language[] = ['en', 'ru'];

/** Small EN | RU segmented control. The choice persists on the device. */
export function LanguageToggle() {
  const { language, setLanguage } = useI18n();
  const theme = useTheme();

  return (
    <View style={styles.container}>
      {LANGUAGES.map((lang) => {
        const active = language === lang;
        return (
          <Pressable
            key={lang}
            onPress={() => setLanguage(lang)}
            hitSlop={4}
            style={[styles.segment, active && styles.segmentActive]}>
            <ThemedText
              type="code"
              themeColor={active ? 'text' : 'textSecondary'}
              style={{ color: active ? theme.text : theme.textSecondary }}>
              {lang.toUpperCase()}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 2,
    borderRadius: Spacing.two,
    padding: 2,
    backgroundColor: 'rgba(128,128,128,0.18)',
  },
  segment: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Spacing.one + 2,
  },
  segmentActive: {
    backgroundColor: 'rgba(60,135,247,0.35)',
  },
});