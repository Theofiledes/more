import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './App.css'
import * as Sentry from "@sentry/capacitor";
import * as SentryReact from "@sentry/react";

Sentry.init(
  {
    dsn: "https://ceb037926f29acc2f6b46c2d08c3e5c9@o4511237071634432.ingest.us.sentry.io/4511237074059264",
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
