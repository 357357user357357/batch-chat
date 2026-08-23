import { Tabs } from 'expo-router/js-tabs';
import { Image, useColorScheme, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useI18n } from '@/i18n';

/** Height (in dp) of the tab bar content, above the system bottom inset. */
const TAB_BAR_CONTENT_HEIGHT = 44;

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];
  const { t } = useI18n();

  // Keep the bottom safe-area inset, but clamp it so a device reporting 0 or a
  // negative inset never shrinks the bar below its content height.
  const { bottom: rawBottom = 0 } = useSafeAreaInsets();
  const bottomInset = Math.max(0, rawBottom);

  const icon = (src: number, color: ColorValue) => (
    <Image source={src} style={{ width: 24, height: 24, tintColor: color }} />
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          height: TAB_BAR_CONTENT_HEIGHT + bottomInset,
          paddingBottom: bottomInset,
          backgroundColor: colors.background,
          borderTopColor: colors.backgroundSelected,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab.home'),
          tabBarIcon: ({ color }) => icon(require('@/assets/images/tabIcons/home.png'), color),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: t('tab.chat'),
          tabBarIcon: ({ color }) => icon(require('@/assets/images/tabIcons/chat.png'), color),
        }}
      />
      <Tabs.Screen
        name="batches"
        options={{
          title: t('tab.batches'),
          tabBarIcon: ({ color }) => icon(require('@/assets/images/tabIcons/batches.png'), color),
        }}
      />
      {/* Leftover template route — keep it out of the tab bar. */}
      <Tabs.Screen name="explore" options={{ href: null }} />
    </Tabs>
  );
}
