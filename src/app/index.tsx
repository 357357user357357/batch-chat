import * as Device from 'expo-device';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedIcon } from '@/components/animated-icon';
import { BatchTestCard } from '@/components/batch-test-card';
import { HintRow } from '@/components/hint-row';
import { LanguageToggle } from '@/components/language-toggle';
import { MathView } from '@/components/math-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useI18n } from '@/i18n';
import MyRustModule from '../../modules/my-rust-module/src/MyRustModule';

export default function HomeScreen() {
  const { t } = useI18n();
  const rustMessage =
    Platform.OS === 'web' ? t('home.rustUnavailable') : MyRustModule.hello();

  let devHint: string;
  if (Platform.OS === 'web') {
    devHint = t('home.webDevtools');
  } else if (Device.isDevice) {
    devHint = t('home.shakeDevice');
  } else {
    const shortcut = Platform.OS === 'android' ? 'cmd+m (or ctrl+m)' : 'cmd+d';
    devHint = t('home.pressShortcut', { shortcut });
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.topRow}>
          <ThemedText type="code" themeColor="textSecondary">
            {t('lang.tagline')}
          </ThemedText>
          <LanguageToggle />
        </View>

        <ThemedView style={styles.heroSection}>
          <AnimatedIcon />
          <ThemedText type="title" style={styles.title}>
            {t('home.heroTitle')}
          </ThemedText>
        </ThemedView>

        <ThemedText type="code" style={styles.code}>
          {t('home.getStarted')}
        </ThemedText>

        <ThemedText type="default" style={styles.rustMessage}>
          {rustMessage}
        </ThemedText>

        <MathView
          tex={'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'}
          style={styles.math}
          fontSize={16}
        />

        <BatchTestCard style={styles.batchCard} />

        <ThemedView type="backgroundElement" style={styles.stepContainer}>
          <HintRow
            title={t('home.tryEditing')}
            hint={<ThemedText type="code">{t('home.deployHint')}</ThemedText>}
          />
          <HintRow title={t('home.devTools')} hint={<ThemedText type="small">{devHint}</ThemedText>} />
          <HintRow
            title={t('home.freshStart')}
            hint={<ThemedText type="code">{t('home.resetHint')}</ThemedText>}
          />
        </ThemedView>

        {Platform.OS === 'web' && <WebBadge />}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  topRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  heroSection: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  title: {
    textAlign: 'center',
  },
  code: {
    textTransform: 'uppercase',
  },
  rustMessage: {
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  math: {
    alignSelf: 'stretch',
    marginHorizontal: Spacing.three,
  },
  batchCard: {
    marginHorizontal: Spacing.three,
  },
  stepContainer: {
    gap: Spacing.three,
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    borderRadius: Spacing.four,
  },
});