import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './App.css'
import * as Sentry from "@sentry/capacitor";
import * as SentryReact from "@sentry/react";
import { initLiveUpdates } from './utils/liveUpdate';

// No DSN by default — Sentry only activates if you set one up and configure it here.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init(
    {
      dsn: SENTRY_DSN,
      integrations: [
        SentryReact.browserTracingIntegration(),
        SentryReact.replayIntegration(),
      ],
      // Performance Monitoring
      tracesSampleRate: 1.0,
      // Session Replay
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
    },
    // Forward the init method from @sentry/react
    SentryReact.init
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// After render, so notifyAppReady() only fires once the UI has actually mounted —
// that is the signal the updater's rollback watchdog is waiting for.
initLiveUpdates();
