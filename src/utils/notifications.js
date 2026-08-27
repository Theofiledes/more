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
        // Two things keep this on the immediate path, and BOTH are required.
        //
        // No `schedule` field: any `schedule.at` — even 200ms out — hands the
        // notification to AlarmManager instead of posting it. Without one, the plugin
        // calls NotificationManager.notify() directly.
        //
        // `isExactNotification: false`: this defaults to TRUE and is checked *before*
        // the schedule is looked at, so on Android 12+ an unscheduled notification still
        // triggers the "Alarms & reminders" settings screen and posts nothing. That
        // permission is separate from the normal notification prompt, so a user who
        // granted notifications sees BMO bounce them to a settings page and never
        // notify. BMO never needs an exact alarm — it notifies about what just happened.
        isExactNotification: false,
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

/**
 * Fire a test notification and report exactly what happened.
 *
 * Notifications are otherwise only observable by waiting for BMO to spontaneously learn
 * something, which makes "is this set up right?" impossible to answer. Returns a
 * human-readable reason rather than a bare boolean so the UI can say why nothing showed.
 */
export const testNotification = async () => {
  if (!(await isSupported())) {
    return { ok: false, reason: 'Only works in the Android app, not the browser.' };
  }
  const granted = await ensureNotificationPermission();
  if (!granted) {
    return { ok: false, reason: `Permission is "${permissionState || 'unknown'}" — enable notifications for BMO in Android settings.` };
  }
  const id = Date.now();
  const sent = await notify({
    id,
    title: 'BMO test',
    body: 'Notifications are working. This is what BMO will look like when it learns something.',
  });
  if (!sent) {
    return { ok: false, reason: 'Android accepted the permission but rejected the notification.' };
  }

  // Don't trust `sent`. The plugin resolves successfully in cases where it posted
  // nothing at all — an exact-alarm notification on Android 12+ opens a settings screen
  // and still resolves, so this button once reported "Sent" while nothing was delivered.
  // A test that can pass without the thing under test happening is worse than no test.
  try {
    const wanted = Math.abs(id % 2147483647);
    const { notifications } = await LocalNotifications.getDeliveredNotifications();
    if (!notifications?.some((n) => n.id === wanted)) {
      return { ok: false, reason: 'Android reported success but delivered nothing. Check BMO under Settings > Apps > Notifications.' };
    }
  } catch {
    // Some platforms don't implement getDeliveredNotifications; absence of the check
    // isn't evidence of failure, so fall through to the optimistic answer.
  }
  return { ok: true, reason: 'Sent. Check your notification shade.' };
};
