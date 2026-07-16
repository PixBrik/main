import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

/**
 * One photo in: camera first on native (falling back to the library when the
 * camera is unavailable or denied), file dialog on web. Returns the picked
 * asset URI, or null when the user cancels.
 */
export async function pickPhoto(): Promise<string | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };

  if (Platform.OS !== 'web') {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.granted) {
        const result = await ImagePicker.launchCameraAsync(options);
        if (!result.canceled && result.assets[0]) {
          return result.assets[0].uri;
        }
        if (!result.canceled) {
          return null;
        }
      }
    } catch {
      // Camera unavailable (simulator, denied hardware) — fall back to the library.
    }
  }

  const result = await ImagePicker.launchImageLibraryAsync(options);
  if (!result.canceled && result.assets[0]) {
    return result.assets[0].uri;
  }
  return null;
}
