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

/** True when secure storage is available on this platform. */
export function isSecureStorageAvailable(): boolean {
  return Platform.OS !== "web";
}

/** Returns the stored API key, or null if never saved. */
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
