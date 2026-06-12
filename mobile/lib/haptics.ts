/**
 * Haptic feedback wrappers — "premium feel".
 *
 * Usage guide (keep it tasteful — interactions, never scrolls):
 *   tap()       light impact — play/pause, skip, mini-player button
 *   press()     medium impact — long-press sheets opening, radial switcher open
 *   selection() tick — tab switches, radial hover changes, filter chips, seek release
 *   success()   notification — keep/flag saved, profile assigned, download queued
 *   warn()      notification — delete confirmations, skip-marked-for-deletion
 *
 * All wrappers swallow errors (haptics are best-effort, some devices lack motors).
 */
import * as Haptics from 'expo-haptics';

export const tap = () =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

export const press = () =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

export const selection = () =>
  Haptics.selectionAsync().catch(() => {});

export const success = () =>
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

export const warn = () =>
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
