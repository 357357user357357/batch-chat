/**
 * Saves a text file (CSV / JSON / TXT) out of the app.
 *
 * Platform behavior:
 * - Android: tries a direct "Save to Downloads" via the system Storage Access
 *   Framework dialog; if the user rejects it, falls back to the share sheet.
 * - iOS: writes to the app cache and opens the system share sheet (Files,
 *   Mail, Messages, …).
 */
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { StorageAccessFramework } from 'expo-file-system/legacy';

/** SAF uri that makes the system picker open the Downloads folder. */
const DOWNLOADS_URI = 'content://com.android.externalstorage.documents/document/primary%3ADownload';

/** Fuzzy summary of what happened, used by the caller for the toast message. */
export type SaveOutcome = 'saved' | 'shared' | 'canceled' | 'unsupported';

export async function saveTextFile(
  filename: string,
  contents: string,
  mimeType: string
): Promise<SaveOutcome> {
  // Android: direct "Save as…" into (default) Downloads via the Storage
  // Access Framework. The user picks the folder once per save.
  if (Platform.OS === 'android') {
    try {
      const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync(
        DOWNLOADS_URI
      );
      if (permission.granted && permission.directoryUri) {
        const uri = await StorageAccessFramework.createFileAsync(
          permission.directoryUri,
          filename,
          mimeType
        );
        await StorageAccessFramework.writeAsStringAsync(uri, contents, {
          encoding: 'utf8',
        });
        return 'saved';
      }
    } catch (error) {
      console.warn('[files] SAF save failed, falling back to share sheet', error);
    }
  }

  // iOS + Android fallback: write to cache and open the share sheet.
  try {
    const file = new File(Paths.cache, filename);
    file.create({ overwrite: true, intermediates: true });
    file.write(contents);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename });
      return 'shared';
    }
  } catch (error) {
    console.warn('[files] cache+share failed', error);
  }
  return 'unsupported';
}