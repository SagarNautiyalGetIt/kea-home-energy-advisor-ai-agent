import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

let enabled = true;
let last = 0;
export const setHapticsEnabled = (value: boolean) => { enabled = value; };
/** Bounded selection feedback: streams/sliders never vibrate for each token/pixel. */
export function tactile(kind: 'selection' | 'response' | 'success' | 'error' = 'selection') {
  if (!enabled || Platform.OS === 'web' || Date.now() - last < (kind === 'response' ? 650 : 70)) return;
  last = Date.now();
  const action = kind === 'success' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    : kind === 'error' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    : kind === 'response' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) : Haptics.selectionAsync();
  void action.catch(() => undefined);
}
