import { LocalNotifications } from '@capacitor/local-notifications';

/**
 * Notifications for a self-hosted app.
 *
 * Deliberately LOCAL notifications rather than push. Real push (FCM) would mean every
 * self-hoster registering a Firebase project and shipping google-services.json, and
 * routing their private conversation through Google's servers to reach their own phone —
 * which defeats the point of running BMO on your own hardware.
 *
 * The tradeoff, stated plainly: these fire while BMO is running (foreground or
 * backgrounded). If Android kills the process, nothing arrives until you reopen the app.
 * For a companion you already keep open that's a fair trade for not needing a cloud
 * dependency at all.
 */

let permissionState = null;   // null = not asked yet
let supported = null;

const isSupported = async () => {
  if (supported !== null) return supported;
  try {
    // On web the plugin exists but does nothing useful, so treat it as unsupported
    // rather than firing notifications into the void.
    supported = typeof LocalNotifications?.schedule === 'function'
      && !!window?.Capacitor?.isNativePlatform?.();
  } catch {
    supported = false;
  }
  return supported;
};

export const ensureNotificationPermission = async () => {
  if (!(await isSupported())) return false;
  if (permissionState === 'granted') return true;
  try {
    const current = await LocalNotifications.checkPermissions();
    permissionState = current.display;
    if (permissionState === 'granted') return true;
    if (permissionState === 'denied') return false;   // don't nag on every note
    const asked = await LocalNotifications.requestPermissions();
    permissionState = asked.display;
    return permissionState === 'granted';
  } catch {
    return false;
  }
};

/**
 * Show one notification. No-ops silently when unsupported or not permitted — a companion
 * app should never break because it couldn't post a notification.
 */
export const notify = async ({ title, body, id }) => {
  if (!(await ensureNotificationPermission())) return false;
  try {
    await LocalNotifications.schedule({
      notifications: [{
        // Android notification ids must fit in a 32-bit int; message ids here are
        // Date.now()-based and would overflow.
        id: Math.abs(Number(id) % 2147483647) || Math.floor(Math.random() * 100000),
        title: title || 'BMO',
        body: (body || '').slice(0, 240),
        smallIcon: 'ic_launcher_foreground',
        iconColor: '#5FD3BC',
        schedule: { at: new Date(Date.now() + 200) },   // immediate, but off the UI thread
      }],
    });
    return true;
  } catch {
    return false;
  }
};

/** True when the app isn't the thing the user is currently looking at. */
export const appIsBackgrounded = () =>
  typeof document !== 'undefined' && document.visibilityState !== 'visible';
