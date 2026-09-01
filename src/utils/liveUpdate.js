// Over-the-air web-bundle updates, pointed at YOUR server, not a cloud service.
//
// The Android app is a WebView around the same `dist/` bundle the server serves, so a
// UI change used to mean rebuilding and side-loading a whole APK. With this, the host
// running `git pull && npm run build` IS the update: the app checks in, sees a different
// bundle, downloads it and swaps it in. Only native changes — a new Capacitor plugin, a
// permission, the Android shell itself — still need a real APK.
//
// Two deliberate choices:
//   * updateUrl is set at RUNTIME from the address in Settings > Server Address, not
//     baked into capacitor.config.json. Everyone self-hosts, so there is no one URL to
//     compile in, and the same APK has to work against anybody's server.
//   * statsUrl is blanked. The plugin's default is Capgo's cloud; a local-first
//     companion app should not be reporting its update lifecycle to a third party.
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { getApiUrl } from './api';

export const initLiveUpdates = async () => {
  // Web builds are served by the same server they'd update from — a plain reload
  // already gets the newest bundle, so there is nothing to do here.
  if (!Capacitor.isNativePlatform?.()) return;

  try {
    // MUST run, and early. If the app never reports itself healthy within
    // appReadyTimeout, the plugin assumes the new bundle broke the app and rolls back
    // to the previous one. That is the safety net that makes auto-update survivable:
    // a bundle that white-screens is undone on its own, without a USB cable.
    await CapacitorUpdater.notifyAppReady();
  } catch (e) {
    console.warn('[liveUpdate] notifyAppReady failed:', e);
  }

  try {
    await CapacitorUpdater.setUpdateUrl({ url: `${getApiUrl()}/v1/updates/check` });
    await CapacitorUpdater.setStatsUrl({ url: '' });
  } catch (e) {
    // Not fatal — the app runs fine on its current bundle, it just won't self-update.
    console.warn('[liveUpdate] could not point the updater at this server:', e);
  }
};

/** Ask the server what it would serve. Returns null if it can't be reached. */
export const getServerBundleVersion = async (apiToken) => {
  try {
    const res = await fetch(`${getApiUrl()}/v1/updates/current`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};
