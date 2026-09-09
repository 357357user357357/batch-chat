import { useEffect, useRef, useState } from "react";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { completeOAuthFromUrl } from "@/services/sync";

/** Deep-link target for batchchat://oauth#token=… — completes the Google
 * sign-in started from the Sync card, then jumps to the Chat tab.
 * The link can arrive in several ways depending on cold/warm start and the
 * device's browser: as the initial URL, as a runtime 'url' event, or via
 * expo-router's useURL — all three are handled, first one wins. */
export default function OAuthScreen() {
  const linkingUrl = Linking.useURL();
  const params = useLocalSearchParams<{ token?: string }>();
  const [message, setMessage] = useState("Completing sign-in…");
  const handled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const handle = (url: string | null) => {
      if (cancelled || handled.current || !url) return;
      if (!url.startsWith("batchchat://")) return;
      handled.current = true;
      completeOAuthFromUrl(url)
        .then(() => {
          if (!cancelled) router.replace("/chat");
        })
        .catch((error) => {
          if (!cancelled) {
            handled.current = false;
            setMessage(error instanceof Error ? error.message : String(error));
          }
        });
    };

    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener("url", ({ url }) => handle(url));
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // Fallback: expo-router sometimes delivers the deep link as query params
  // on this route instead of a Linking event (depends on Android flavor).
  useEffect(() => {
    if (handled.current || !params.token) return;
    handled.current = true;
    const hash = `#token=${String(params.token)}`;
    completeOAuthFromUrl(`batchchat://oauth${hash}`)
      .then(() => router.replace("/chat"))
      .catch((error) => {
        handled.current = false;
        setMessage(error instanceof Error ? error.message : String(error));
      });
  }, [params.token]);

  return (
    <ThemedView style={styles.container}>
      <ActivityIndicator size="large" />
      <ThemedText style={styles.message}>{message}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24,
  },
  message: {
    textAlign: "center",
  },
});