import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

/**
 * Local notifications for batch results. No push, no third-party service:
 * the batch poller fires a local notification when an in-flight batch
 * settles while the app is in the background (the user switched away and
 * no longer sees the Live status). Foreground transitions are silent —
 * the user is already looking at the screen.
 */

let permissionRequested = false;

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (permissionRequested && !current.canAskAgain) return false;
  permissionRequested = true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

/** True if the app is backgrounded right now (notification-worthy moment). */
function isBackgrounded(): boolean {
  return AppState.currentState !== "active";
}

export async function notifyBatchSettled(
  title: string,
  ok: boolean,
  detail: string,
): Promise<void> {
  try {
    if (!isBackgrounded()) return;
    if (!(await ensurePermission())) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: ok ? `✅ ${title} — completed` : `❌ ${title} — failed`,
        body: detail,
        sound: "default",
      },
      trigger: null, // fire immediately
    });
  } catch {
    // Notification is best-effort polish; never break the batch flow.
  }
}
