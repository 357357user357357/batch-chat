import { Tabs } from "expo-router/js-tabs";
import { Image, Pressable, useColorScheme, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors } from "@/constants/theme";
import { useI18n } from "@/i18n";

/** Height (in dp) of the tab bar content, above the system bottom inset. */
const TAB_BAR_CONTENT_HEIGHT = 44;

function TabIcon({
  src,
  color,
}: {
  src: number;
  color: ColorValue;
}) {
  // Static icon: no spring/scale animation on tab switches (user request).
  return <Image source={src} style={{ width: 24, height: 24, tintColor: color }} />;
}

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === "unspecified" ? "light" : scheme];
  const { t } = useI18n();

  // Keep the bottom safe-area inset, but clamp it so a device reporting 0 or a
  // negative inset never shrinks the bar below its content height.
  const { bottom: rawBottom = 0 } = useSafeAreaInsets();
  const bottomInset = Math.max(0, rawBottom);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textSecondary,
        // No press ripple / highlight on the tab buttons (user request).
        // The incoming ref/android_ripple types don't match RN's Pressable,
        // so strip them and render a plain, animation-free button.
        tabBarButton: ({ android_ripple: _ripple, ref: _ref, ...props }) => (
          <Pressable {...props} />
        ),
        tabBarStyle: {
          height: TAB_BAR_CONTENT_HEIGHT + bottomInset,
          paddingBottom: bottomInset,
          backgroundColor: colors.background,
          borderTopColor: colors.backgroundSelected,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tab.home"),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              src={require("@/assets/images/tabIcons/home.png")}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: t("tab.chat"),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              src={require("@/assets/images/tabIcons/chat.png")}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="batches"
        options={{
          title: t("tab.batches"),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              src={require("@/assets/images/tabIcons/batches.png")}
              color={color}
            />
          ),
        }}
      />
      {/* Leftover template route — keep it out of the tab bar. */}
      <Tabs.Screen name="explore" options={{ href: null }} />
    </Tabs>
  );
}
