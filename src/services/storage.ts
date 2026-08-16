/**
 * Tiny persistence wrapper over AsyncStorage.
 *
 * The same API is used on Android, iOS and the web (AsyncStorage falls back to
 * localStorage in the browser), so app data survives app restarts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function loadString(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch (error) {
    console.warn('[storage] load string failed', key, error);
    return null;
  }
}

export async function saveString(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch (error) {
    console.warn('[storage] save string failed', key, error);
  }
}

export async function removeValue(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.warn('[storage] remove failed', key, error);
  }
}

export async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await loadString(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn('[storage] corrupt JSON', key, error);
    return fallback;
  }
}

export async function saveJSON(key: string, value: unknown): Promise<void> {
  try {
    await saveString(key, JSON.stringify(value));
  } catch (error) {
    console.warn('[storage] save JSON failed', key, error);
  }
}