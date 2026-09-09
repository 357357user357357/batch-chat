import { useEffect, useState } from "react";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { ActivityIndicator, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { completeOAuthFromUrl } from "@/services/sync";

/** Deep-link target for batchchat://oauth#token=… — completes the Google
 * sign-in started from the Sync card, then jumps to the Chat tab. */
export default function OAuthScreen() {
  const url = Linking.useURL();
  const [message, setMessage] = useState("Completing sign-in…");

  useEffect(() => {
    if (!url) return;
    completeOAuthFromUrl(url)
      .then(() => {
        router.replace("/chat");
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : String(error));
      });
  }, [url]);

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