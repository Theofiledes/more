// Single shared WebSocket connection to /v1/ws, replacing what used to be four separate
// polling loops (TelemetryTerminal's 1.5s/2.5s intervals, and the two 600ms
// thinking-status/approval polls in App.jsx's sendLocalBmoCommand/streamLocalBmoCommand).
// Plain functions rather than a hook because two of those three consumers are async
// functions, not components, and can't call hooks.
//
// Messages arrive as either a raw ANSI-colored log string (most backend broadcasts) or a
// JSON string (the initial snapshot, periodic metrics, and sentinel approval events) — see
// server.py's broadcast_fn/broadcast_to_managers call sites for the full vocabulary.
import { getApiUrl, getApiToken } from './api';

let socket = null;
let reconnectTimer = null;
let manualClose = true;
const listeners = new Set();
const statusListeners = new Set();

const toWsUrl = (httpUrl) => httpUrl.replace(/^http/, 'ws');

function notify(msg) {
  for (const fn of listeners) {
    try { fn(msg); } catch {
      // A subscriber's own error shouldn't take down the socket for everyone else.
    }
  }
}

function notifyStatus(status) {
  for (const fn of statusListeners) {
    try { fn(status); } catch {
      // Same as above — isolate subscriber errors.
    }
  }
}

function scheduleReconnect() {
  if (reconnectTimer || manualClose) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBmoSocket();
  }, 3000);
}

export function connectBmoSocket() {
  manualClose = false;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const token = getApiToken();
  if (!token || typeof WebSocket === 'undefined') return;

  let ws;
  try {
    ws = new WebSocket(`${toWsUrl(getApiUrl())}/v1/ws?token=${encodeURIComponent(token)}`);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => notifyStatus('connected');
  ws.onclose = () => {
    if (socket === ws) socket = null;
    notifyStatus('disconnected');
    scheduleReconnect();
  };
  ws.onerror = () => { /* onclose always follows onerror; nothing extra to do here */ };
  ws.onmessage = (event) => {
    let parsed;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      parsed = { type: 'log', line: event.data };
    }
    notify(parsed);
  };
}

export function disconnectBmoSocket() {
  manualClose = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (socket) { socket.close(); socket = null; }
}

/** Subscribe to every parsed message. Returns an unsubscribe function. */
export function subscribeBmoSocket(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe to 'connected' / 'disconnected' transitions. Returns an unsubscribe function. */
export function subscribeBmoSocketStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function isBmoSocketOpen() {
  return !!socket && socket.readyState === WebSocket.OPEN;
}
