/**
 * User-provided API keys, stored in the device's secure storage
 * (Android Keystore / iOS Keychain) instead of the JS bundle.
 *
 * This keeps the user's OpenRouter key out of the shipped code: nothing is
 * baked into the bundle at build time. The app asks the user for the key,
 * stores it here, and reads it back at request time.
 */
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const STORAGE_KEY = "openrouter_api_key";
const SYNC_TOKEN_STORAGE_KEY = "batch_chat_sync_token";
const SYNC_REMEMBERED_CREDENTIALS_KEY = "batch_chat_sync_credentials";

/** True when secure storage is available on this platform. */
export function isSecureStorageAvailable(): boolean {
  return Platform.OS !== "web";
}

/** Returns remembered sync login credentials from device-only secure storage. */
export async function getStoredSyncCredentials(): Promise<{
  login: string;
  password: string;
} | null> {
  if (!isSecureStorageAvailable()) return null;
  try {
    const raw = await SecureStore.getItemAsync(SYNC_REMEMBERED_CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { login?: unknown; password?: unknown };
    if (typeof parsed.login !== "string" || typeof parsed.password !== "string") return null;
    return { login: parsed.login, password: parsed.password };
  } catch {
    return null;
  }
}

/** Saves remembered sync login credentials in device-only secure storage. */
export async function storeSyncCredentials(credentials: {
  login: string;
  password: string;
} | null): Promise<boolean> {
  if (!isSecureStorageAvailable()) return false;
  try {
    if (credentials === null) {
      await SecureStore.deleteItemAsync(SYNC_REMEMBERED_CREDENTIALS_KEY);
    } else {
      await SecureStore.setItemAsync(
        SYNC_REMEMBERED_CREDENTIALS_KEY,
        JSON.stringify(credentials),
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
      );
    }
    return true;
  } catch (error) {
    console.warn("[key-store] sync credentials save failed", error);
    return false;
  }
}


export async function getStoredApiKey(): Promise<string | null> {
  if (!isSecureStorageAvailable()) return null;
  try {
    return await SecureStore.getItemAsync(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Saves the API key to secure storage (Android Keystore / iOS Keychain). */
export async function storeApiKey(key: string): Promise<boolean> {
  if (!isSecureStorageAvailable()) return false;
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return true;
  } catch (error) {
    console.warn("[key-store] save failed", error);
    return false;
  }
}

/** Removes the stored API key. */
export async function clearStoredApiKey(): Promise<void> {
  if (!isSecureStorageAvailable()) return;
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  } catch (error) {
    console.warn("[key-store] delete failed", error);
  }
}

/** Returns the server session token from secure storage. */
export async function getStoredSyncToken(): Promise<string | null> {
  if (!isSecureStorageAvailable()) return null;
  try {
    return await SecureStore.getItemAsync(SYNC_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Saves the server session token in device-only secure storage. */
export async function storeSyncToken(token: string): Promise<boolean> {
  if (!isSecureStorageAvailable()) return false;
  try {
    await SecureStore.setItemAsync(SYNC_TOKEN_STORAGE_KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return true;
  } catch (error) {
    console.warn("[key-store] sync token save failed", error);
    return false;
  }
}

/** Removes the server session token. */
export async function clearStoredSyncToken(): Promise<void> {
  if (!isSecureStorageAvailable()) return;
  try {
    await SecureStore.deleteItemAsync(SYNC_TOKEN_STORAGE_KEY);
  } catch (error) {
    console.warn("[key-store] sync token delete failed", error);
  }
}

const TAVILY_STORAGE_KEY = "tavily_api_key";

export async function getStoredTavilyApiKey(): Promise<string | null> {
  if (!isSecureStorageAvailable()) return null;
  try {
    return await SecureStore.getItemAsync(TAVILY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function storeTavilyApiKey(key: string): Promise<boolean> {
  if (!isSecureStorageAvailable()) return false;
  try {
    await SecureStore.setItemAsync(TAVILY_STORAGE_KEY, key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return true;
  } catch (error) {
    console.warn("[key-store] tavily save failed", error);
    return false;
  }
}

export async function clearStoredTavilyApiKey(): Promise<void> {
  if (!isSecureStorageAvailable()) return;
  try {
    await SecureStore.deleteItemAsync(TAVILY_STORAGE_KEY);
  } catch (error) {
    console.warn("[key-store] tavily delete failed", error);
  }
}
