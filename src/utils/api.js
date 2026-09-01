// Shared API config helper — the single source of truth for where BMO's backend
// lives and how to authenticate to it. Previously duplicated (and diverging) across
// App.jsx, TelemetryTerminal.jsx, and WorkspaceEditor.jsx; only the App.jsx copy read
// the Settings "server address" override, so telemetry/workspace stayed pinned to
// whatever VITE_BMO_API_URL was baked in at build time.
//
// Precedence: per-device override (Settings > Server Address, stored in localStorage)
// > build-time env var > localhost. There is no "desktop vs. native" special case —
// phone/Tailscale access is expected to go through the localStorage override, not a
// personal IP baked into the build.
export const getApiUrl = () => {
  if (typeof localStorage !== 'undefined') {
    const customUrl = localStorage.getItem('bmo_custom_api_url');
    if (customUrl) return customUrl.replace(/\/$/, '');
  }
  const envUrl = import.meta.env.VITE_BMO_API_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');
  return 'http://localhost:18789';
};

// The per-device pairing token is the ONLY credential this bundle carries, and it is
// earned at runtime — never baked in at build time.
//
// There used to be an `import.meta.env.VITE_BMO_API_KEY` fallback here so a fresh
// install worked before pairing. That convenience was a critical hole: Vite inlines
// VITE_-prefixed vars as plaintext, server.py serves dist/assets with no auth, and
// wake-bmo.sh binds 0.0.0.0 by default. Anyone who could reach the port could GET the
// JS bundle, read the master token out of it, and use it to run shell commands on the
// host. The same string shipped inside every APK built from this tree.
//
// So the bundle now holds no secret at all. An unpaired device gets 401s and drops to
// PairingScreen, which is the intended first-run path. The server still accepts the
// shared token (BMO_SHARED_TOKEN=on) for break-glass curl access — that token just
// never travels to the client any more.
export const DEVICE_TOKEN_KEY = 'bmo_device_token';

export const getDeviceToken = () => {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(DEVICE_TOKEN_KEY) || '';
};

export const setDeviceToken = (token) => {
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem(DEVICE_TOKEN_KEY, token);
  else localStorage.removeItem(DEVICE_TOKEN_KEY);
};

export const getApiToken = () => getDeviceToken();
