import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { useI18n } from '@/i18n';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];
  const { t } = useI18n();

  return (
    <NativeTabs
      backgroundColor={colors.background}
      disableIndicator
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index" labelVisibilityMode="unlabeled">
        <NativeTabs.Trigger.Label>{t('tab.home')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="chat" labelVisibilityMode="unlabeled">
        <NativeTabs.Trigger.Label>{t('tab.chat')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/chat.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="batches" labelVisibilityMode="unlabeled">
        <NativeTabs.Trigger.Label>{t('tab.batches')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/batches.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
