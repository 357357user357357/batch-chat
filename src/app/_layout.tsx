import {
    DarkTheme,
    DefaultTheme,
    ThemeProvider,
    router,
    usePathname,
    type Href,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import AppTabs from "@/components/app-tabs";
import { I18nProvider } from "@/i18n";
import { loadString, saveString } from "@/services/storage";

SplashScreen.preventAutoHideAsync();

const LAST_TAB_STORAGE_KEY = "app.lastTab.v1";
/** Tab routes the app knows about; used to keep restore safe. */
const KNOWN_TABS = new Set(["/", "/index", "/chat", "/batches"]);

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const [tabHydrated, setTabHydrated] = useState(false);

  // Reopen on the tab the user was last viewing (after restoring the saved
  // value, not before, so we don't overwrite it with the default "/").
  useEffect(() => {
    let cancelled = false;
    void loadString(LAST_TAB_STORAGE_KEY).then((tab) => {
      if (cancelled) return;
      if (tab && tab !== "/" && tab !== "/index" && KNOWN_TABS.has(tab)) {
        router.replace(tab as Href);
      }
      setTabHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Remember the active tab so the next launch resumes to it.
  useEffect(() => {
    if (!tabHydrated || !pathname) return;
    void saveString(LAST_TAB_STORAGE_KEY, pathname);
  }, [pathname, tabHydrated]);

  return (
    <I18nProvider>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <AppTabs />
      </ThemeProvider>
    </I18nProvider>
  );
}
