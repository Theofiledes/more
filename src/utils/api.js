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

export const getApiToken = () => import.meta.env.VITE_BMO_API_KEY || '';
