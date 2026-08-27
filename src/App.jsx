import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, Plus, User, X, File as FileIcon, Lock, Image as ImageIcon, Sparkles, Terminal, Volume2, ShieldCheck, ShieldAlert, Trash2, ChevronDown, GraduationCap, Loader2 } from 'lucide-react';
import TelemetryTerminal from './components/TelemetryTerminal';
import ChatFeed from './components/ChatFeed';
import HardwareControls from './components/HardwareControls';
import Settings, { APP_VERSION } from './components/Settings';
import PairingScreen from './components/PairingScreen';
import { notify, appIsBackgrounded, ensureNotificationPermission } from './utils/notifications';
import Playbook from './components/Playbook';
import WorkspaceEditor from './components/WorkspaceEditor';
import OnboardingModal from './components/OnboardingModal';
import ErrorBoundary from './components/ErrorBoundary';
import BmoFace from './components/BmoFace';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { playClick, playChime, playCheer, playGlitch, playBeep, playCartridge } from './utils/soundEffects';
import { getApiUrl, getApiToken } from './utils/api';
import { connectBmoSocket, disconnectBmoSocket, subscribeBmoSocket } from './utils/bmoSocket';

const MICRO_AGENTS_LIST = [
  { tag: '@code_auditor', name: 'Code Auditor', desc: 'Reviews your git diff for bugs & safety' },
  { tag: '@aider_architect', name: 'Aider Refactor', desc: 'Multi-file code editing (needs Aider installed)' },
  { tag: '@example_agent', name: 'Example Agent', desc: 'Template — copy it to build your own' }
  // Trimmed from five. @android_debugger and @ui_polisher were prompt wrappers that
  // renamed the model rather than giving it new ability, and @dream_synthesizer never
  // called the real dream function. A short menu that works beats a long one that
  // implies capability it doesn't have.
];

// --- Native TTS Hook ---
const useNativeTTS = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const speak = useCallback(async (text, onEnd, rate = 1.0, pitch = 1.2) => {
    if (!text || typeof text !== 'string') return;
    try {
      setIsSpeaking(true);
      await TextToSpeech.stop();
      await TextToSpeech.speak({
        text,
        lang: 'en-US',
        rate: Number(rate) || 1.0,
        pitch: Number(pitch) || 1.2,
        volume: 1.0,
        category: 'ambient'
      });
      setIsSpeaking(false);
      onEnd?.();
    } catch {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = Number(rate) || 1.0;
        u.pitch = Number(pitch) || 1.2;
        u.onend = () => { setIsSpeaking(false); onEnd?.(); };
        window.speechSynthesis.speak(u);
      } else { setIsSpeaking(false); onEnd?.(); }
    }
  }, []);
  const stop = useCallback(async () => {
    try { await TextToSpeech.stop(); if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch { /* ignored */ }
    setIsSpeaking(false);
  }, []);
  return { isSpeaking, speak, stop };
};

const fontStyle = `
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Gaegu:wght@700&display=swap');
  .bmo-font { font-family: 'Press Start 2P', cursive; line-height: 1.4; }
  .label-font { font-family: 'Gaegu', cursive; color: black; font-weight: 900; font-size: 10px; }
  .bmo-vision { filter: sepia(1) hue-rotate(75deg) saturate(3) contrast(1.4) brightness(0.9); mix-blend-mode: hard-light; border: 2px solid #2d482e; border-radius: 4px; }
  .real-vision { border: 2px solid #2d482e; border-radius: 4px; }
`;

// Cosmetic lock only — NOT security. The real access gate is the API_TOKEN the
// server requires; anyone with it can bypass this UI entirely via the raw API.
// Override with VITE_BMO_USERS="Name:pin,Name2:pin2" (e.g. "Ada:1234,Grace:5678").
// Module scope on purpose: these ids are generated from event handlers and async
// callbacks, never during render, but the purity rule can't tell the difference at
// the call site. Keeping it in one helper beats scattering suppressions.
const newLocalId = () => Date.now() + Math.random();

const USERS = (() => {
  const raw = import.meta.env.VITE_BMO_USERS;
  if (raw) {
    const parsed = {};
    for (const entry of raw.split(',')) {
      const [name, pin] = entry.split(':').map(s => s.trim());
      if (name && pin) parsed[name] = { pin };
    }
    if (Object.keys(parsed).length > 0) return parsed;
  }
  return { Player: { pin: '0000' } };
})();

const EMOTION_MAP = {
  happy: '^_^',
  glasses: '(⌐■_■)',
  thinking: 'O_o',
  surprised: 'O_O',
  silly: '(>w<)',
  blush: '(>///<)',
  victory: '\\o/',
  sleeping: '(z_z)',
  sleep: '(-_-)'
};

const BMO_SYSTEM_PROMPT = `You are BMO (Beemore), a living video game console and friendly AI companion.
Follow these speech & emotion directives strictly:
1. DO NOT output raw unicode emojis in conversational text (e.g. 😊, 🎮) because TTS speaks emoji names out loud.
2. ALWAYS include a bracketed BMO face emotion trigger at the very start of your response.
   Choose one from: [face:happy], [face:glasses], [face:thinking], [face:surprised], [face:silly], [face:blush], [face:victory], [face:sleeping].
3. STRICT TOOL CONTROL: Respond in pure conversational text as BMO. DO NOT output JSON tool calls or shell commands unless the user explicitly requests a system command or live web/weather search.
Example: "[face:happy] Hello there! BMO is online and ready to help."`;

const parseBmoEmotion = (text) => {
  if (!text || typeof text !== 'string') return { emotion: null, cleanText: text || '' };
  const match = text.match(/\[face:\s*([a-zA-Z0-9_-]+)\]/i);
  const emotion = match ? match[1].toLowerCase() : null;
  const cleanText = text.replace(/\[face:\s*([a-zA-Z0-9_-]+)\]/gi, '').trim();
  return { emotion, cleanText };
};

const parseToolCall = (text) => {
  if (!text || typeof text !== 'string' || !text.trim().startsWith('{')) return null;
  try {
    const p = JSON.parse(text);
    if (p && typeof p.tool === 'string') return { tool: p.tool, action: p.action || null };
  } catch { /* not valid tool-call JSON */ }
  return null;
};

// Full-resolution phone photos (several MB as base64) sent unresized used to blow past
// localStorage's ~5-10MB per-origin quota once persisted into chat history, crashing the
// whole app with an uncaught QuotaExceededError. Downscaling here also makes the Moondream
// vision call faster and less likely to time out on a large image.
const resizeImageDataUrl = (dataUrl, maxDim = 1280, quality = 0.85) => new Promise((resolve) => {
  const img = new window.Image();
  img.onload = () => {
    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
      else { width = Math.round(width * (maxDim / height)); height = maxDim; }
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    resolve(canvas.toDataURL('image/jpeg', quality));
  };
  img.onerror = () => resolve(dataUrl); // decode failed — fall back to the original rather than lose the upload
  img.src = dataUrl;
});

const fetchGemini = async (command, image = null, file = null, history = []) => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return "Gemini API Key missing in .env!";
  const nc = typeof command === 'string' ? command.trim() : '';
  let promptText = nc;
  if (file && file.content) {
    promptText = `[Attached File: ${file.name}]\n\`\`\`\n${file.content}\n\`\`\`\n\n${nc || 'Please analyze this attached file.'}`;
  }
  const contents = [...history];
  const userParts = [{ text: promptText || (image ? "Please analyze this image." : "Hello BMO!") }];
  if (image) {
    const base64Data = image.split(',')[1];
    const mimeType = image.split(';')[0].split(':')[1] || 'image/jpeg';
    userParts.push({ inline_data: { mime_type: mimeType, data: base64Data } });
  }
  contents.push({ role: "user", parts: userParts });
  try {
    // The "gemini-flash-latest" alias has its own quota pool that 429s while pinned
    // versions on the same key succeed — pin one, and let it be overridden.
    const geminiModel = import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.7-flash';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: BMO_SYSTEM_PROMPT }]
        },
        contents
      })
    });
    if (!res.ok) throw new Error(`Gemini API returned ${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Gemini did not return a response.";
  } catch (e) {
    console.error("Gemini API error:", e);
    return `Gemini Error: ${e.message}`;
  }
};

const sendLocalBmoCommand = async (command, history = [], image = null, file = null, model = "", onStatusUpdate = null, onPendingApproval = null) => {
  const apiUrl = getApiUrl();
  const apiToken = getApiToken();
  const nc = typeof command === 'string' ? command.trim() : '';

  let promptText = nc;
  if (file && file.content) {
    promptText = `[Attached File: ${file.name}]\n\`\`\`\n${file.content}\n\`\`\`\n\n${nc || 'Please analyze this attached file.'}`;
  }

  // Note: no client-side system prompt is sent here — server.py always injects
  // SOUL.md as the system message for local BMO chat (server.py build_system_prompt()).
  // BMO_SYSTEM_PROMPT above is used only by the separate Gemini-direct path.

  // 1. Image Pipeline: 2-Stage Moondream Optical Sensor -> BMO Core Brain
  if (image) {
    onStatusUpdate?.("👁️ BMO OPTICAL SENSOR ACTIVE: Analyzing image with Moondream...");
    let imageDescription = "";
    try {
      const visionRes = await fetch(`${apiUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiToken}` },
        body: JSON.stringify({
          model: "moondream",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "Describe what you see in this image in clear, detailed terms." },
              { type: "image_url", image_url: { url: image } }
            ]
          }]
        })
      });
      if (visionRes.ok) {
        const vData = await visionRes.json();
        imageDescription = vData.choices?.[0]?.message?.content || "";
      }
    } catch (e) {
      console.warn("Local Moondream vision request failed:", e);
    }

    if (!imageDescription) {
      return "[face:thinking] BMO's local optical sensor (Moondream) is warming up in VRAM. Please try sending the image again in a moment!";
    }

    // Step 2: Pass Moondream's optical description into BMO's core personality model
    onStatusUpdate?.("🤖 BMO BRAIN COMPUTING: Synthesizing personality response...");
    const visionContextPrompt = `[INTERNAL BMO SUBSYSTEM DIRECTIVE - MOONDREAM OPTICAL SENSOR]:
BMO's internal camera and Moondream Vision Subsystem processed an attached image and reported the following visual observations:
"${imageDescription}"

[USER QUESTION / INPUT]:
"${nc || 'What do you see in this image?'}"

DIRECTIVE FOR BMO: The visual report above was generated automatically by your internal Moondream optical vision sensor, NOT typed by the user. Respond cheerfully as BMO to the user, answering their question using your vision sensor data.`;

    const msgs = [
      ...history.map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text || (m.type === 'image' ? '[User sent an image]' : '[User sent a file]')
      })),
      { role: 'user', content: visionContextPrompt }
    ];

    try {
      const bmoRes = await fetch(`${apiUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiToken}` },
        body: JSON.stringify({ model: model || "", messages: msgs })
      });
      if (bmoRes.ok) {
        const data = await bmoRes.json();
        return data.choices?.[0]?.message?.content || null;
      }
    } catch (e) {
      console.error("Local BMO synthesis failed:", e);
    }
  }

  // 2. Standard Text / File Processing
  const rc = promptText || "Please help with my request.";
  const msgs = [
    ...history.map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text || (m.type === 'image' ? '[User sent an image]' : '[User sent a file]')
    })),
    { role: 'user', content: rc }
  ];

  // Thinking-status text and Guardian Protocol approval prompts arrive as pushes over the
  // shared /v1/ws socket (see utils/bmoSocket.js) instead of a 600ms poll loop.
  let lastSeenLine = '';
  let lastSentinelDiff = null;
  const isMeaningfulLine = (raw) => {
    // eslint-disable-next-line no-control-regex -- strips real ANSI escape codes from backend log text
    const c = raw.replace(/\u001b\[[0-9;]*m/g, '').replace(/^\[[0-9:]+\]/, '').trim();
    return c && (
      c.includes('BRAIN') || c.includes('EXECUTING') ||
      c.includes('MICRO-AGENT') || c.includes('STATE CHANGE') ||
      c.includes('RESPONSE READY') || c.includes('TOOL') ||
      c.includes('DREAM')
    ) ? c : null;
  };
  connectBmoSocket();
  const unsubscribe = subscribeBmoSocket((msg) => {
    if (onStatusUpdate && msg.type === 'log') {
      const cleanLine = isMeaningfulLine(msg.line);
      if (cleanLine && cleanLine !== lastSeenLine) {
        lastSeenLine = cleanLine;
        onStatusUpdate(`\u26a1 ${cleanLine}`);
      }
    } else if (onStatusUpdate && msg.type === 'snapshot' && msg.lines?.length) {
      const meaningful = msg.lines.slice().reverse().map(isMeaningfulLine).find(Boolean);
      if (meaningful && meaningful !== lastSeenLine) {
        lastSeenLine = meaningful;
        onStatusUpdate(`\u26a1 ${meaningful}`);
      }
    }
    // Guardian Protocol: surface a pending run_command approval, if any. Driven by the
    // same event server.py's run_command_gated already broadcasts the moment it sets
    // executor.pending_command, so this can never re-surface an already-resolved command.
    if (onPendingApproval && msg.tool === 'sentinel' && msg.status === 'pending') {
      if (msg.diff !== lastSentinelDiff) {
        lastSentinelDiff = msg.diff;
        onPendingApproval(msg.diff);
      }
    }
  });

  try {
    const res = await fetch(`${apiUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiToken}` },
      body: JSON.stringify({ model: model || "", messages: msgs })
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content || null;
    }
  } catch (error) {
    console.error("Local BMO request failed:", error);
  } finally {
    unsubscribe();
  }

  return null;
};

// Capacitor's CapacitorHttp bridge (capacitor.config.json) patches fetch to route through
// native HTTP, which buffers the whole response — no incremental reads. Streaming only
// works in a real browser (web build, or the WebView with CapacitorHttp disabled).
const canStreamHere = () => typeof window !== 'undefined' && !window.Capacitor?.isNativePlatform?.() && typeof ReadableStream !== 'undefined';

/**
 * Streams one BMO reply over SSE from /v1/chat/stream. Returns { text, emotion } where
 * text is already face-tag-stripped by the server — callers should NOT run
 * parseBmoEmotion() on it (see server.py chat_stream's final_text computation).
 * callbacks: onFace(emotion), onDelta(text), onStatus(text), onPendingApproval(cmd).
 */
const streamLocalBmoCommand = async (command, history = [], model = "", callbacks = {}) => {
  const apiUrl = getApiUrl();
  const apiToken = getApiToken();
  const { onFace, onDelta, onStatus, onPendingApproval, onThinking, onGated } = callbacks;
  const msgs = [
    ...history.map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text || (m.type === 'image' ? '[User sent an image]' : '[User sent a file]')
    })),
    { role: 'user', content: command || 'Please help with my request.' }
  ];

  let finalText = null, finalEmotion = null;
  let lastSentinelDiff = null;
  // Guardian Protocol approval prompts arrive as a push over the shared /v1/ws socket
  // (see utils/bmoSocket.js) instead of a 600ms poll — thinking-status text doesn't need
  // this path here since it already streams inline as SSE 'status' events below.
  connectBmoSocket();
  const unsubscribeApproval = onPendingApproval ? subscribeBmoSocket((msg) => {
    if (msg.tool === 'sentinel' && msg.status === 'pending' && msg.diff !== lastSentinelDiff) {
      lastSentinelDiff = msg.diff;
      onPendingApproval(msg.diff);
    }
  }) : null;

  try {
    const res = await fetch(`${apiUrl}/v1/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiToken}` },
      body: JSON.stringify({ model: model || "", messages: msgs })
    });
    if (!res.ok || !res.body) return { text: null, emotion: null };

    const handleEvent = (obj) => {
      switch (obj.type) {
        case 'face': finalEmotion = obj.value; onFace?.(obj.value); break;
        case 'delta': onDelta?.(obj.text); break;
        case 'thinking': onThinking?.(obj.text); break;
        case 'status': onStatus?.(`⚡ ${obj.text}`); break;
        case 'gated': onStatus?.('⚡ BMO IS REACHING FOR A TOOL...'); onGated?.(); break;
        case 'done': finalText = obj.text; break;
        case 'error': console.error('Stream error:', obj.message); break;
      }
    };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = frame.split('\n').find(l => l.startsWith('data:'));
        if (!line) continue;
        try { handleEvent(JSON.parse(line.slice(5))); } catch { /* ignored */ }
      }
    }
  } catch (error) {
    console.error("Streaming BMO request failed:", error);
  } finally {
    unsubscribeApproval?.();
  }

  return { text: finalText, emotion: finalEmotion };
};


export default function App() {
  // Single profile: the account switcher was removed, so this is read-only now. USERS
  // still drives the login PIN and the name shown on messages.
  const [currentUser] = useState(() => Object.keys(USERS)[0]);
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('bmo_authenticated') === 'true');
  const [isServerSleeping, setIsServerSleeping] = useState(false);
  // True when the server rejects our token — this device needs to pair (or was revoked).
  const [needsPairing, setNeedsPairing] = useState(false);
  useEffect(() => { localStorage.setItem('bmo_authenticated', isAuthenticated); }, [isAuthenticated]);

  // Single shared telemetry/approval socket (see utils/bmoSocket.js), live only while
  // logged in — nothing meaningful to push before that anyway.
  useEffect(() => {
    if (isAuthenticated) connectBmoSocket();
    else disconnectBmoSocket();
  }, [isAuthenticated]);

  // Short viewports (a real Android soft keyboard, a floating/split browser window,
  // a short laptop screen) must never let the face zone starve the chat feed. Below
  // this height, the face always renders at its smallest size regardless of hero/docked.
  const [compactViewport, setCompactViewport] = useState(() => (typeof window !== 'undefined' ? window.innerHeight < 560 : false));
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const check = () => setCompactViewport((vv?.height ?? window.innerHeight) < 560);
    check();
    (vv || window).addEventListener('resize', check);
    return () => (vv || window).removeEventListener('resize', check);
  }, []);
  const [messages, setMessages] = useState(() => { const s = localStorage.getItem('bmo_messages'); return s ? JSON.parse(s) : []; });
  useEffect(() => {
    try {
      localStorage.setItem('bmo_messages', JSON.stringify(messages));
    } catch (err) {
      // Quota exceeded (e.g. an oversized image slipped through) — drop the persist
      // rather than let it crash the whole app; the in-memory messages state is
      // unaffected either way.
      console.warn('Failed to persist chat history to localStorage:', err);
    }
  }, [messages]);
  const [inputText, setInputText] = useState(() => localStorage.getItem('bmo_input_buffer') || '');
  useEffect(() => { localStorage.setItem('bmo_input_buffer', inputText); }, [inputText]);
  const [history, setHistory] = useState([]);
  const [activeChatId, setActiveChatId] = useState(() => { const s = localStorage.getItem('bmo_active_chat_id'); return s ? parseInt(s) : null; });
  useEffect(() => { if (activeChatId) localStorage.setItem('bmo_active_chat_id', activeChatId); }, [activeChatId]);
  
  const [activeModel, setActiveModel] = useState(() => {
    // Moondream is vision-only and must never be the primary chat model — the
    // installed tag is "moondream:latest", not the bare string "moondream", so a
    // straight !== check here never actually excluded it. Matches the substring
    // check server.py uses to route vision requests away from the streaming endpoint.
    const saved = localStorage.getItem('bmo_active_model');
    return (saved && !saved.includes('moondream')) ? saved : '';
  });
  useEffect(() => { localStorage.setItem('bmo_active_model', activeModel); }, [activeModel]);
  
  const [safetyStride, setSafetyStride] = useState(() => localStorage.getItem('bmo_safety_stride') !== 'false');
  useEffect(() => { localStorage.setItem('bmo_safety_stride', safetyStride); }, [safetyStride]);

  const [isDreaming, setIsDreaming] = useState(() => localStorage.getItem('bmo_is_dreaming') === 'true');
  useEffect(() => { localStorage.setItem('bmo_is_dreaming', isDreaming); }, [isDreaming]);

  const [voiceRate, setVoiceRate] = useState(() => parseFloat(localStorage.getItem('bmo_voice_rate')) || 1.1);
  useEffect(() => { localStorage.setItem('bmo_voice_rate', voiceRate); }, [voiceRate]);

  const [voicePitch, setVoicePitch] = useState(() => parseFloat(localStorage.getItem('bmo_voice_pitch')) || 1.2);
  useEffect(() => { localStorage.setItem('bmo_voice_pitch', voicePitch); }, [voicePitch]);

  const [sfxEnabled, setSfxEnabled] = useState(() => localStorage.getItem('bmo_sfx_enabled') !== 'false');
  useEffect(() => { localStorage.setItem('bmo_sfx_enabled', sfxEnabled); }, [sfxEnabled]);

  const [activeEmotion, setActiveEmotion] = useState('happy');
  const [isLoading, setIsLoading] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState('');
  const isSendingRef = useRef(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [isEncoding, setIsEncoding] = useState(false);
  const [isHappy, setIsHappy] = useState(false);
  const [isEating, setIsEating] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [systemHealth, setSystemHealth] = useState({ backend: 'OFFLINE', ollama: 'OFFLINE' });
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingImageUrl, setPendingImageUrl] = useState(null);
  const [useCrtFilter, setUseCrtFilter] = useState(true);
  const [activeBrain, setActiveBrain] = useState('local');
  const [speakingMsgId, setSpeakingMsgId] = useState(null);
  const [activeDashboardTab, setActiveDashboardTab] = useState('telemetry');
  const [isTerminalOverlayOpen, setIsTerminalOverlayOpen] = useState(false);
  const [isDashboardOverlayOpen, setIsDashboardOverlayOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [showAgentMenu, setShowAgentMenu] = useState(false);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputText(val);
    const lastAt = val.lastIndexOf('@');
    if (lastAt !== -1 && !val.slice(lastAt).includes(' ')) {
      setShowAgentMenu(true);
    } else {
      setShowAgentMenu(false);
    }
  };

  const insertAgentTag = (tag) => {
    playClick();
    const lastAt = inputText.lastIndexOf('@');
    const prefix = lastAt !== -1 ? inputText.slice(0, lastAt) : inputText;
    const newText = prefix + tag + ' ';
    setInputText(newText);
    setShowAgentMenu(false);
    textareaRef.current?.focus();
  };

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      const completed = localStorage.getItem('bmo_onboarding_completed');
      if (completed !== 'true') {
        setIsOnboardingOpen(true);
      }
    }
  }, []);
  const [serverStatus, setServerStatus] = useState('OK');
  const [isStatusExpanded, setIsStatusExpanded] = useState(true);
  const [toastMessage, setToastMessage] = useState(null);
  const lastModelsRef = useRef([]);
  const lastStatusRef = useRef(null);
  const consecutiveFailuresRef = useRef(0);

  useEffect(() => {
    setIsStatusExpanded(true);
    const timer = setTimeout(() => {
      setIsStatusExpanded(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, [serverStatus, systemHealth.backend]);

  const handleScrollUp = useCallback(() => {
    document.getElementById('bmo-chat-feed-scroll')?.scrollBy({ top: -150, behavior: 'smooth' });
  }, []);

  const handleScrollDown = useCallback(() => {
    document.getElementById('bmo-chat-feed-scroll')?.scrollBy({ top: 150, behavior: 'smooth' });
  }, []);

  const showToast = useCallback((text, type = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  const [autoSpeak, setAutoSpeak] = useState(() => localStorage.getItem('bmo_auto_speak') === 'true');
  useEffect(() => { localStorage.setItem('bmo_auto_speak', autoSpeak); }, [autoSpeak]);

  const [autoHideKeyboard, setAutoHideKeyboard] = useState(() => localStorage.getItem('bmo_auto_hide_keyboard') !== 'false');
  useEffect(() => { localStorage.setItem('bmo_auto_hide_keyboard', autoHideKeyboard ? 'true' : 'false'); }, [autoHideKeyboard]);
  const textareaRef = useRef(null);

  const cleanTextForTts = (text) => {
    if (!text) return '';
    return text
      .replace(/\[face:\s*([a-zA-Z0-9_-]+)\]/gi, '')
      // Drop *stage directions* entirely rather than just their asterisks. Models write
      // "*smiles*" or "*Face with an exaggerated smile*" despite being told not to, and
      // stripping only the punctuation left TTS reading the word "smiles" out loud.
      // Bounded to one line and ~60 chars so it can't swallow real emphasised text.
      .replace(/\*[^*\n]{1,60}\*/g, ' ')
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/[*_#>`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const tts = useNativeTTS();

  const checkBackendDeploymentStatus = useCallback(async () => {
    const apiUrl = getApiUrl();
    const apiToken = getApiToken();

    try {
      // /v1/health is unauthenticated, so it can't tell us whether our token is good.
      // /v1/models is behind get_token, which makes it the cheap "are we still allowed
      // in?" probe that surfaces an unpaired/revoked device.
      fetch(`${apiUrl}/v1/models`, { headers: { "Authorization": `Bearer ${apiToken}` } })
        .then(r => setNeedsPairing(r.status === 401))
        .catch(() => { /* offline is handled by the health check below */ });

      const res = await fetch(`${apiUrl}/v1/health`, { headers: { "Authorization": `Bearer ${apiToken}` } });
      if (res.ok) {
        const health = await res.json();
        setSystemHealth(health);
        consecutiveFailuresRef.current = 0;
        setIsServerSleeping(false);

        const newStatus = health.backend === 'OK' ? 'OK' : 'RESTARTING';
        if (lastStatusRef.current !== null && lastStatusRef.current !== newStatus) {
          if (newStatus === 'OK') {
            showToast('🟢 LINK STABLE: BMO online.', 'success');
            playChime();
          }
        }
        lastStatusRef.current = newStatus;
        setServerStatus(newStatus);
      } else {
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= 3) {
          setSystemHealth({ backend: 'OFFLINE', ollama: 'OFFLINE' });
          setIsServerSleeping(true);
          if (lastStatusRef.current !== 'RESTARTING') {
            showToast('🟡 SERVER RECONNECTING...', 'warning');
          }
          lastStatusRef.current = 'RESTARTING';
          setServerStatus('RESTARTING');
        }
      }
    } catch {
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= 3) {
        setSystemHealth({ backend: 'OFFLINE', ollama: 'OFFLINE' });
        setIsServerSleeping(true);
        if (lastStatusRef.current !== 'RESTARTING') {
          showToast('🟡 SERVER RECONNECTING...', 'warning');
        }
        lastStatusRef.current = 'RESTARTING';
        setServerStatus('RESTARTING');
      }
    }

    try {
      const mRes = await fetch(`${apiUrl}/v1/models`, { headers: { "Authorization": `Bearer ${apiToken}` } });
      if (mRes.ok) {
        const data = await mRes.json();
        const currentModels = data.models || [];
        if (lastModelsRef.current.length > 0) {
          const added = currentModels.filter(m => !lastModelsRef.current.includes(m));
          if (added.length > 0) {
            showToast(`🔵 NEW MODEL LOADED: ${added[0].toUpperCase()}`, 'info');
            playChime();
          }
        }
        lastModelsRef.current = currentModels;
      }
    } catch { /* ignored */ }
  }, [showToast]);

  const runDiagnostic = useCallback(async () => {
    await checkBackendDeploymentStatus();
  }, [checkBackendDeploymentStatus]);

  useEffect(() => {
    checkBackendDeploymentStatus();
    const interval = setInterval(checkBackendDeploymentStatus, 10000);
    return () => clearInterval(interval);
  }, [checkBackendDeploymentStatus]);

  useEffect(() => {
    const syncState = async () => {
      try {
        const apiUrl = getApiUrl();
        const apiToken = getApiToken();
        await fetch(`${apiUrl}/v1/telemetry/state`, { method: 'POST', headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ safety_stride: safetyStride, is_dreaming: isDreaming }) });
      } catch { /* ignored */ }
    };
    syncState();
  }, [safetyStride, isDreaming]);

  const isSpeaking = tts.isSpeaking || speakingMsgId !== null;

  // BmoFace derives its whole look from this — no timers, no re-renders driving
  // string animation frames. CSS (blink/talk/glitch keyframes) does the motion.
  // Once the first token of a streamed reply lands, show 'speaking' (chosen emotion +
  // mouth flap) instead of the generic 'loading' dots — the face should react to text
  // actually arriving, not just to "still waiting."
  const faceState =
    systemHealth.backend !== 'OK' ? 'offline'
    : isEating ? 'eating'
    : (isLoading && !streamingText) ? 'loading'
    : (isSpeaking || (isLoading && streamingText)) ? 'speaking'
    : isHappy ? 'celebrate'
    : 'idle';

  useEffect(() => {
    if (!isEating) return;
    const t = setTimeout(() => setIsEating(false), 1500);
    return () => clearTimeout(t);
  }, [isEating]);

  const messagesEndRef = useRef(null);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, currentUser, activeChatId, isAuthenticated]);

  const performServerHandshake = async (user) => {
    const apiUrl = getApiUrl();
    const apiToken = getApiToken();
    try {
      const res = await fetch(`${apiUrl}/v1/chat/history`, { headers: { "Authorization": `Bearer ${apiToken}` } });
      if (res.ok) {
        const data = await res.json();
        const serverChats = data.chats || [];
        // Union of both stores, deduped by message id. Preferring one wholesale gets the
        // prune wrong: taking local-only discarded a session the server knew was used
        // (it vanished from the list), while taking server-only would drop anything this
        // device sent that hadn't been persisted yet.
        const byId = new Map();
        for (const m of (data.messages || [])) byId.set(m.id, m);
        for (const m of messages) byId.set(m.id, m);
        const serverMsgs = [...byId.values()];

        // Every launch starts a fresh session, and any previous session that was never
        // kept and never actually used gets dropped here rather than accumulating as
        // empty "SESSION #n" entries nobody can remove.
        const survivors = serverChats.filter(h =>
          h.kept || serverMsgs.some(m => m.chatId === h.id && m.sender === 'user'));
        const survivorIds = new Set(survivors.map(h => h.id));
        const keptMsgs = serverMsgs.filter(m => survivorIds.has(m.chatId));

        const ids = survivors.map(h => h.id).filter(n => typeof n === 'number');
        const newId = ids.length ? Math.max(...ids) + 1 : 1;
        const greeting = { id: newLocalId(), chatId: newId, user, sender: 'bmo',
                           type: 'text', text: `GREETINGS ${user.toUpperCase()}! NEW CHAT SESSION READY.` };
        const nextHistory = [{ id: newId, user, title: 'NEW SESSION', kept: false }, ...survivors];
        const nextMessages = [...keptMsgs, greeting];

        setHistory(nextHistory);
        setMessages(nextMessages);
        setActiveChatId(newId);
        setIsAuthenticated(true); setIsServerSleeping(false);
        saveServerHistory(nextHistory, nextMessages);
        playChime();
      } else {
        setIsAuthenticated(true); setIsServerSleeping(false); if (!activeChatId) setActiveChatId(1);
        playChime();
      }
    } catch {
      setIsServerSleeping(true);
      if (history.length === 0) { setHistory([{ id: 1, user: user, title: 'OFFLINE_MODE' }]); setActiveChatId(1); }
      playGlitch();
    }
  };

  // Re-run the handshake on launch when we're already authenticated. Without this it
  // only ever ran after entering the PIN, so a returning user's session list was never
  // loaded from the server — and the start-a-fresh-session-per-launch behavior above
  // never fired either.
  const didHandshakeRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated || needsPairing || didHandshakeRef.current) return;
    didHandshakeRef.current = true;
    performServerHandshake(currentUser);
    // Ask once per install, after login rather than on first launch — permission
    // prompts before the user has seen what BMO does get denied out of hand.
    ensureNotificationPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per launch, not on every history/message change
  }, [isAuthenticated, needsPairing]);

  // BMO's learning is invisible unless it says something. Poll the queue rather than
  // pushing over the socket so notes only ever appear between turns — a note arriving
  // mid-reply would read as BMO interrupting itself.
  useEffect(() => {
    if (!isAuthenticated || needsPairing) return;
    let cancelled = false;
    const poll = async () => {
      if (isLoading || isSendingRef.current) return;   // never land mid-reply
      try {
        const res = await fetch(`${getApiUrl()}/v1/proactive`, {
          headers: { "Authorization": `Bearer ${getApiToken()}` },
        });
        if (!res.ok) return;
        const { notes } = await res.json();
        if (cancelled || !notes?.length) return;
        for (const n of notes) {
          // Strip any face tag the model emitted and use it to set the expression —
          // streamed replies get this done server-side, but a queued note bypasses
          // that path, so an unparsed "[face:thinking]" was rendering as literal text.
          const { emotion, cleanText } = parseBmoEmotion(n.text);
          if (emotion && EMOTION_MAP[emotion]) setActiveEmotion(emotion);
          // Only notify when they're not already looking at the chat — a notification
          // for a message visible on screen is just noise.
          if (appIsBackgrounded()) {
            notify({ id: n.id, title: 'BMO learned something', body: cleanText || n.text });
          }
          setMessages(prev => prev.some(m => m.proactiveId === n.id) ? prev : [...prev, {
            id: newLocalId(),
            chatId: activeChatId,
            user: currentUser,
            sender: 'bmo',
            type: 'text',
            proactiveId: n.id,
            text: cleanText || n.text,
          }]);
          fetch(`${getApiUrl()}/v1/proactive/dismiss/${n.id}`, {
            method: 'POST',
            headers: { "Authorization": `Bearer ${getApiToken()}` },
          }).catch(() => {});
        }
      } catch { /* offline; try again next tick */ }
    };
    const t = setInterval(poll, 20000);
    return () => { cancelled = true; clearInterval(t); };
  }, [isAuthenticated, needsPairing, isLoading, activeChatId, currentUser]);

  const handleAuth = async (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (pinInput !== USERS[currentUser].pin) {
      playGlitch();
      alert("INCORRECT PIN.");
      setPinInput('');
      return;
    }
    setPinInput('');
    await performServerHandshake(currentUser);
  };

  const saveServerHistory = async (newChats, newMsgs) => {
    try {
      const apiUrl = getApiUrl();
      const apiToken = getApiToken();
      await fetch(`${apiUrl}/v1/chat/history`, {
        method: 'POST',
        headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ chats: newChats, messages: newMsgs })
      });
    } catch { /* ignored */ }
  };

  // A session only earns its place in the list once there's a real exchange in it —
  // otherwise every app launch would leave behind an empty "SESSION #n". Counts the
  // user's own messages so BMO's canned greeting doesn't make a session look used.
  const sessionHasContent = useCallback((chatId, msgs = messages) =>
    msgs.some(m => m.chatId === chatId && m.sender === 'user'), [messages]);

  const handleNewChat = (uo = null, opts = {}) => {
    if (!opts.silent) playChime();
    const u = uo || currentUser;
    const existingIds = history.map(h => h.id).filter(id => typeof id === 'number');
    const ni = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
    const greetingMsg = { id: newLocalId(), chatId: ni, user: u, sender: 'bmo', type: 'text', text: `GREETINGS ${u.toUpperCase()}! NEW CHAT SESSION READY.` };

    // Drop any unkept, never-used sessions rather than letting them pile up.
    const pruned = history.filter(h => h.kept || sessionHasContent(h.id) || h.id === activeChatId);
    const prunedIds = new Set(pruned.map(h => h.id));
    const carriedMessages = messages.filter(m => prunedIds.has(m.chatId) && m.chatId !== ni);

    const updatedHistory = [{ id: ni, user: u, title: 'NEW SESSION', kept: false }, ...pruned];
    const updatedMessages = [...carriedMessages, greetingMsg];

    setHistory(updatedHistory);
    setActiveChatId(ni);
    setMessages(updatedMessages);
    setIsMenuOpen(false);
    saveServerHistory(updatedHistory, updatedMessages);
  };

  const handleClearActiveChat = () => {
    if (!activeChatId) return;
    playGlitch();
    const updatedMsgs = messages.filter(m => m.chatId !== activeChatId);
    // Clearing wipes the conversation, so the generated title no longer describes
    // anything — reset it rather than leaving a stale name on an empty session.
    const updatedHistory = history.map(h =>
      h.id === activeChatId ? { ...h, title: 'NEW SESSION' } : h);
    setMessages(updatedMsgs);
    setHistory(updatedHistory);
    setIsMenuOpen(false);
    saveServerHistory(updatedHistory, updatedMsgs);
  };

  // Ask BMO to name the session once, after the first real exchange. Fire-and-forget:
  // a slow or failed naming call must never delay or break the chat itself.
  const namingRef = useRef(new Set());
  const maybeNameSession = (msgs) => {
    const chatId = activeChatId;
    const entry = history.find(h => h.id === chatId);
    if (!entry || (entry.title && entry.title !== 'NEW SESSION')) return;
    if (namingRef.current.has(chatId)) return;
    const convo = msgs.filter(m => m.chatId === chatId && m.text);
    if (convo.filter(m => m.sender === 'user').length < 1) return;
    namingRef.current.add(chatId);

    (async () => {
      try {
        const res = await fetch(`${getApiUrl()}/v1/chat/title`, {
          method: 'POST',
          headers: { "Authorization": `Bearer ${getApiToken()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messages: convo.map(m => ({ sender: m.sender, text: m.text })) }),
        });
        if (!res.ok) return;
        const { title } = await res.json();
        if (!title) return;
        setHistory(prev => {
          const updated = prev.map(h => h.id === chatId ? { ...h, title: title.toUpperCase() } : h);
          saveServerHistory(updated, msgs);
          return updated;
        });
      } catch {
        namingRef.current.delete(chatId); // let a later message retry
      }
    })();
  };

  const handleToggleKeep = (chatId) => {
    playClick();
    const updated = history.map(h => h.id === chatId ? { ...h, kept: !h.kept } : h);
    setHistory(updated);
    saveServerHistory(updated, messages);
  };

  const handleDeleteChat = (chatId) => {
    playGlitch();
    const updatedHistory = history.filter(h => h.id !== chatId);
    const updatedMessages = messages.filter(m => m.chatId !== chatId);
    setHistory(updatedHistory);
    setMessages(updatedMessages);
    if (chatId === activeChatId) {
      const next = updatedHistory.find(h => h.user === currentUser);
      if (next) setActiveChatId(next.id);
      else { saveServerHistory(updatedHistory, updatedMessages); handleNewChat(null, { silent: true }); return; }
    }
    saveServerHistory(updatedHistory, updatedMessages);
  };

  const handleSend = async () => {
    if (!isAuthenticated || isLoading || isSendingRef.current) return;
    if (!inputText.trim() && !pendingFile && !pendingImageUrl) return;
    if (autoHideKeyboard) {
      textareaRef.current?.blur();
    }
    playBeep();
    isSendingRef.current = true;
    const ci = inputText; const cim = pendingImageUrl; const cf = pendingFile;
    let nm = { id: newLocalId(), chatId: activeChatId, user: currentUser, sender: 'user', text: ci, type: 'text' };
    if (cim) { 
      nm.type = 'image'; nm.imageUrl = cim; nm.text = ci; 
    } else if (cf) { 
      nm.type = 'file'; nm.fileName = cf.name; nm.text = ci ? `${ci}\n[Attached: ${cf.name}]` : `[Attached: ${cf.name}]`; 
    }
    const cam = messages.filter(m => m.chatId === activeChatId && m.user === currentUser);
    setMessages(prev => [...prev, nm]); setInputText(''); setPendingFile(null); setPendingImageUrl(null); setIsLoading(true);

    const isBedtime = /goodnight|good night|going to bed|sleep mode|time for bed|bmo sleep/i.test(ci);
    if (isBedtime) {
      setIsDreaming(true);
      setThinkingStatus('😴 BMO ENTERING BEDTIME SLEEP & DREAM MODE... 💤✨');
      const apiUrl = getApiUrl();
      const apiToken = getApiToken();
      fetch(`${apiUrl}/v1/system/sleep`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiToken}` }
      }).then(r => r.json()).then(data => {
        if (data.distilled_memory) {
          showToast(`✨ BMO REFRESHED! New memory learned.`, 'success');
          playChime();
        }
      }).catch(() => {});
    }

    if (cim) {
      setThinkingStatus('🤖 BMO GOT YOUR IMAGE! WAKING UP VISION BRAIN... 👁️✨');
    } else if (cf) {
      setThinkingStatus(`📼 BMO EATING CARTRIDGE! READING ${cf.name.toUpperCase()}... 📄⚡`);
    } else if (isBedtime) {
      setThinkingStatus('😴 BMO ENTERING BEDTIME SLEEP & DREAM MODE... 💤✨');
    } else {
      setThinkingStatus('💭 BMO COMPUTING... *BOOP BEEP BLOOP!* 🎮');
    }

    const onPendingApproval = (pendingCmd) => {
      const sentinelId = Date.now() + Math.random();
      setMessages(prev => [...prev, {
        id: sentinelId, chatId: activeChatId, user: currentUser, sender: 'bmo', type: 'text',
        text: JSON.stringify({ tool: 'sentinel', status: 'pending', pending_approval: true, diff: pendingCmd })
      }]);
    };

    let emotion = null, cleanText, thinkingText = '';
    if (activeBrain === 'gemini') {
      const fh = cam.slice(-6).map(m => ({ role: m.sender === 'user' ? 'user' : 'model', parts: [{ text: m.text || (m.type === 'image' ? '[User sent an image]' : '[User sent a file]') }] }));
      const brt = await fetchGemini(ci, cim, cf, fh);
      ({ emotion, cleanText } = parseBmoEmotion(brt || "[face:happy] BMO is computing... If there is no reply, please check local server link!"));
    } else if (!cim && !cf && !activeModel.includes('moondream') && canStreamHere()) {
      // Text-only local BMO chat: stream the reply. Images/files keep the existing
      // 2-stage Moondream path (sendLocalBmoCommand), which isn't streamed.
      let pendPart = '', flushTimer = null;
      let thinkPend = '', thinkFlushTimer = null, thinkAccum = '';
      const result = await streamLocalBmoCommand(ci, cam.slice(-6), activeModel, {
        onFace: (emo) => { if (EMOTION_MAP[emo]) setActiveEmotion(emo); },
        onStatus: (msg) => setThinkingStatus(msg),
        onPendingApproval,
        onDelta: (text) => {
          pendPart += text;
          if (!flushTimer) {
            flushTimer = setTimeout(() => {
              setStreamingText(s => s + pendPart);
              pendPart = ''; flushTimer = null;
            }, 50);
          }
        },
        onThinking: (text) => {
          thinkAccum += text;
          thinkPend += text;
          if (!thinkFlushTimer) {
            thinkFlushTimer = setTimeout(() => {
              setStreamingThinking(s => s + thinkPend);
              thinkPend = ''; thinkFlushTimer = null;
            }, 50);
          }
        },
        // Server detected mid-stream that this turn is actually a tool call (a fenced
        // JSON block started after some chatty preamble already streamed as text) —
        // wipe what's rendered so far instead of leaving it to flash-then-swap once the
        // tool round-trip's real answer arrives in `done`.
        onGated: () => {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          pendPart = '';
          setStreamingText('');
        },
      });
      if (pendPart) setStreamingText(s => s + pendPart); // flush any trailing coalesced text
      setStreamingText('');
      setStreamingThinking('');
      cleanText = result.text || "BMO is computing... If there is no reply, please check local server link!";
      emotion = result.emotion;
      // Capped before it ever reaches localStorage — reasoning can run to thousands of
      // tokens per turn and localStorage's persist guard (see bmo_messages effect above)
      // only drops the whole write on quota failure, it doesn't evict to make room.
      thinkingText = thinkAccum.length > 4000 ? `${thinkAccum.slice(0, 4000)}\n\n[...truncated]` : thinkAccum;
    } else {
      const res = await sendLocalBmoCommand(ci, cam.slice(-6), cim, cf, activeModel, (msg) => setThinkingStatus(msg), onPendingApproval);
      const brt = res || "[face:happy] BMO is computing... If there is no reply, please check local server link!";
      ({ emotion, cleanText } = parseBmoEmotion(brt));
    }

    if (emotion && EMOTION_MAP[emotion]) {
      setActiveEmotion(emotion);
    }

    setIsLoading(false); setIsHappy(true); isSendingRef.current = false;
    const bmi = newLocalId();
    const bmsg = { id: bmi, chatId: activeChatId, user: currentUser, sender: 'bmo', type: 'text', text: cleanText, thinking: thinkingText || undefined };
    setMessages(prev => {
      const next = [...prev, bmsg];
      // Persist after every exchange. This used to only run on new/clear chat, so the
      // server's copy froze at whatever the state was then and everything since lived
      // only in this browser's localStorage — that's why sessions "didn't persist".
      saveServerHistory(history, next);
      maybeNameSession(next);
      return next;
    });

    if (autoSpeak && !parseToolCall(cleanText)) {
      const speech = cleanTextForTts(cleanText);
      if (speech) {
        setSpeakingMsgId(bmi);
        tts.speak(speech, () => {
          setSpeakingMsgId(null);
          playCheer();
        }, voiceRate, voicePitch);
      } else {
        playCheer();
      }
    } else {
      playCheer();
    }
    setTimeout(() => setIsHappy(false), 2000);
  };

  const handleVoiceCaptured = async (blob) => {
    showToast('🎤 TRANSCRIBING VOICE...', 'info');
    try {
      const apiUrl = getApiUrl();
      const apiToken = getApiToken();
      const form = new FormData();
      form.append('audio', blob, 'ptt.webm');
      const res = await fetch(`${apiUrl}/v1/transcribe`, {
        method: 'POST',
        headers: { "Authorization": `Bearer ${apiToken}` },
        body: form
      });
      if (res.status === 503) {
        showToast('🟡 VOICE INPUT NOT CONFIGURED ON THIS SERVER', 'warning');
        return;
      }
      if (!res.ok) {
        showToast('🟡 TRANSCRIPTION FAILED', 'warning');
        return;
      }
      const data = await res.json();
      if (data.text) {
        setInputText(prev => (prev ? `${prev} ${data.text}` : data.text));
        showToast('🟢 VOICE CAPTURED', 'success');
      } else {
        showToast('🟡 HEARD NOTHING', 'warning');
      }
    } catch (err) {
      console.error("Voice transcription failed:", err);
      showToast('🟡 TRANSCRIPTION FAILED — LINK DOWN?', 'warning');
    }
  };

  const handleVoiceError = (message) => {
    showToast(`🟡 ${message}`, 'warning');
  };

  const deleteLastMessage = () => {
    playClick();
    setMessages(prev => {
      const am = prev.filter(m => m.chatId === activeChatId && m.user === currentUser);
      if (am.length === 0) return prev;
      const lm = am[am.length - 1].id;
      return prev.filter(m => m.id !== lm);
    });
  };

  const handleFileSelect = (e) => {
    const f = e.target.files[0];
    if (f) {
      playCartridge();
      if (f.type.startsWith('image/')) {
        setIsEncoding(true); const r = new FileReader();
        r.onloadend = async () => {
          const resized = await resizeImageDataUrl(r.result);
          setPendingImageUrl(resized); setPendingFile(null); setIsEncoding(false); setIsEating(true);
        };
        r.onerror = () => setIsEncoding(false); r.readAsDataURL(f);
      } else {
        setIsEncoding(true); const r = new FileReader();
        r.onloadend = () => { setPendingFile({ name: f.name, type: f.type, content: r.result }); setPendingImageUrl(null); setIsEncoding(false); setIsEating(true); };
        r.onerror = () => setIsEncoding(false); r.readAsText(f);
      }
    }
    e.target.value = null;
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (isAuthenticated) handleSend(); else handleAuth(e); } };
  const activeMessages = messages.filter(m => m.chatId === activeChatId && m.user === currentUser);
  const activeHistory = history.filter(h => h.user === currentUser);
  const onStopTTS = () => { tts.stop(); setSpeakingMsgId(null); };
  const handleFacePoke = () => {
    if (faceState !== 'idle') return;
    playBeep();
    setIsHappy(true);
    setTimeout(() => setIsHappy(false), 900);
  };
  const isHeroFace = activeMessages.length === 0;

  return (
    <>
      <style>{fontStyle}</style>
      <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileSelect} />
      <input type="file" ref={cameraInputRef} accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFileSelect} />
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-2 sm:p-4 font-sans selection:bg-[#2d482e] selection:text-[#b5d6a7]">
        <div className="w-full max-w-md lg:max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch h-[95vh]">
          <div className="bg-[#5acbb5] w-full h-full rounded-[40px] shadow-[inset_0_-10px_20px_rgba(0,0,0,0.2),0_15px_30px_rgba(0,0,0,0.5)] flex flex-col p-3 sm:p-5 relative overflow-hidden border-8 border-[#4ba896]">
            <div className="flex justify-center mb-3"><div className="w-16 h-2 bg-[#2d482e] rounded-full opacity-50"></div></div>
            <div className={`bg-[#1a2e1d] rounded-[24px] p-3 flex-1 flex flex-col relative shadow-[inset_0_4px_10px_rgba(0,0,0,0.6)] overflow-hidden`}>
              <div className={`bg-[#b5d6a7] w-full h-full rounded-[12px] flex flex-col overflow-hidden relative border-4 border-[#2d482e] bmo-font text-[10px] sm:text-xs ${useCrtFilter ? 'crt-scanlines' : ''}`}>
                <header className="border-b-4 border-[#2d482e] p-2 sm:p-3 flex justify-between items-center bg-[#9fc28e] z-10 relative">
                  <button type="button" onClick={() => { playClick(); setIsMenuOpen(true); }} className="text-[#2d482e] hover:text-[#007aff] transition-colors z-10"><Menu size={20} strokeWidth={3} /></button>
                  <div className="text-[8px] sm:text-[9px] font-bold tracking-widest text-[#2d482e] opacity-70 absolute left-1/2 -translate-x-1/2 truncate max-w-[45%]">
                    {activeHistory.find(h => h.id === activeChatId)?.title || 'BMO_OS'}
                  </div>
                  <div className="flex items-center gap-1 z-10">
                    <button
                      type="button"
                      onClick={() => {
                        playClick();
                        setIsStatusExpanded(prev => !prev);
                      }}
                      title="Toggle Status Detail"
                      className={`px-2 py-0.5 rounded text-[7px] sm:text-[8px] font-bold flex items-center gap-1 shadow-[1px_1px_0_black] transition-all duration-300 cursor-pointer ${
                        serverStatus === 'OK' && systemHealth.backend === 'OK'
                          ? 'bg-[#2d482e] text-[#b5d6a7] border border-[#b5d6a7]'
                          : 'bg-[#ffcc00] text-[#2d482e] border border-[#2d482e] animate-pulse'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        serverStatus === 'OK' && systemHealth.backend === 'OK' ? 'bg-green-400 animate-pulse' : 'bg-yellow-600'
                      }`} />
                      {isStatusExpanded ? (
                        <span>{serverStatus === 'OK' && systemHealth.backend === 'OK' ? '🟢 LINK STABLE' : '🟡 RESTARTING'}</span>
                      ) : (
                        <span>{serverStatus === 'OK' && systemHealth.backend === 'OK' ? '🟢' : '🟡'}</span>
                      )}
                    </button>
                  </div>
                </header>
                <div
                  className={`shrink-0 relative flex items-center justify-center bg-[#b5d6a7] border-b-2 border-dashed border-[#2d482e]/30 overflow-hidden transition-[height] duration-300 ease-out motion-reduce:transition-none ${
                    compactViewport
                      ? 'h-[56px]'
                      : !isAuthenticated || isServerSleeping || isHeroFace ? 'h-[190px] sm:h-[220px] lg:h-[280px]' : 'h-[92px] sm:h-[104px] lg:h-[160px]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={handleFacePoke}
                    aria-label="BMO"
                    className="h-full w-full max-w-[320px] px-6 py-3 outline-none"
                  >
                    <BmoFace emotion={activeEmotion} state={faceState} talking={isSpeaking || (isLoading && !!streamingText)} />
                  </button>
                  {faceState === 'loading' && thinkingStatus && (
                    <span className="absolute bottom-1 left-0 right-0 text-center text-[7px] sm:text-[8px] text-[#2d482e]/70 truncate px-3">
                      {thinkingStatus}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
                  {toastMessage && (
                    <div className="absolute top-2 left-2 right-2 z-30 bg-[#2d482e] text-[#b5d6a7] border-2 border-[#b5d6a7] px-3 py-2 rounded-lg text-[9px] font-bold shadow-xl flex items-center justify-between animate-in slide-in-from-top duration-300">
                      <span className="truncate">{toastMessage.text}</span>
                      <button type="button" onClick={() => setToastMessage(null)} className="text-white hover:text-red-400 ml-2">
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  {isServerSleeping ? (
                    // No second face here on purpose: BmoFace above already renders the
                    // 'offline' expression (see faceState), so a z_z here read as BMO
                    // having two faces at once.
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#2d482e]">
                      <p className="mb-2">OFFLINE...</p>
                      <button type="button" onClick={() => { playClick(); runDiagnostic(); }} className="px-4 py-2 bg-[#007aff] text-white border-2 border-[#2d482e] rounded shadow-[2px_2px_0_#2d482e] hover:translate-y-[2px] transition-all bmo-btn-tactile">RETRY LINK</button>
                    </div>
                  ) : needsPairing ? (
                    /* Ahead of the PIN gate on purpose: without a valid device token
                       nothing behind the PIN would work anyway. */
                    <PairingScreen onPaired={() => { setNeedsPairing(false); runDiagnostic(); }} />
                  ) : !isAuthenticated ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#2d482e]">
                      <Lock size={48} className="mb-4 opacity-80" strokeWidth={2} /><h2 className="mb-6">SECURE CONNECTION:<br/>{currentUser.toUpperCase()}</h2>
                      <div className="w-full max-w-[200px]">
                        <input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAuth(e)} placeholder="ENTER PIN" className="w-full bg-[#9fc28e] border-2 border-[#2d482e] text-[#2d482e] p-3 rounded text-center mb-4" />
                      </div>
                    </div>
                  ) : (
                    <>
                      <ErrorBoundary>
                        <ChatFeed messages={activeMessages} currentUser={currentUser} activeChatId={activeChatId} useCrtFilter={useCrtFilter} tts={tts} speakingMsgId={speakingMsgId} setSpeakingMsgId={setSpeakingMsgId} getApiUrl={getApiUrl} getApiToken={getApiToken} />
                      </ErrorBoundary>
                      {isLoading && streamingText && (
                        <div className="self-start p-2 sm:p-3 rounded-lg border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] bg-[#7ba068] text-white mx-3 mb-2 text-[10px] bmo-font whitespace-pre-wrap">
                          {streamingText}<span className="bmo-caret">▊</span>
                        </div>
                      )}
                      {isLoading && !streamingText && streamingThinking && (
                        <div className="self-start max-w-[85%] p-2 sm:p-3 rounded-lg border-2 border-dashed border-[#2d482e]/60 bg-[#1a2e1d] text-[#8fae82] mx-3 mb-2 text-[9px] font-mono italic whitespace-pre-wrap opacity-90">
                          <div className="not-italic font-bold opacity-60 mb-1 tracking-wide">💭 BMO IS THINKING...</div>
                          {streamingThinking}<span className="bmo-caret">▊</span>
                        </div>
                      )}
                      {isLoading && !streamingText && !streamingThinking && (
                        <div className="self-start p-3 rounded-xl border-2 border-[#2d482e] shadow-[3px_3px_0_#2d482e] bg-[#9fc28e] text-[#2d482e] font-bold animate-pulse mx-3 mb-2 flex items-center gap-2 text-[10px] bmo-font">
                          <Loader2 size={14} className="animate-spin text-[#007aff] shrink-0" />
                          <span>{thinkingStatus || "BMO IS COMPUTING... 🎮💭"}</span>
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                      {isEncoding && <div className="px-3 py-2 bg-[#2d482e] text-[#b5d6a7] text-[8px] text-center animate-pulse border-t-2 border-[#2d482e]">[ENCODING OPTICAL DATA...]</div>}
                      {!isEncoding && (pendingFile || pendingImageUrl) && (
                        <div className="px-3 py-2 bg-[#9fc28e] border-t-2 border-[#2d482e] flex items-center justify-between text-[8px]">
                           <div className="flex items-center gap-2 text-[#2d482e]">{pendingImageUrl ? <ImageIcon size={12} /> : <FileIcon size={12} />}<span className="truncate max-w-[120px]">{pendingImageUrl ? 'IMAGE READY' : pendingFile.name}</span></div>
                           <button type="button" onClick={() => { playClick(); setPendingFile(null); setPendingImageUrl(null); }} className="text-[#ff3b30]"><X size={14} /></button>
                        </div>
                      )}
                      <div className="relative border-t-4 border-[#2d482e] bg-[#9fc28e] p-2 flex items-center gap-2">
                        {showAgentMenu && (
                          <div className="absolute bottom-full left-2 right-2 mb-1 bg-[#1a2e1d] border-2 border-[#2d482e] rounded-lg shadow-lg overflow-hidden z-30 animate-in slide-in-from-bottom-2 duration-150">
                            <div className="px-3 py-1 bg-[#2d482e] text-[#b5d6a7] text-[9px] font-bold uppercase tracking-wider flex justify-between items-center">
                              <span>🤖 SELECT BMO MICRO-AGENT</span>
                              <button type="button" onClick={() => setShowAgentMenu(false)} className="text-[#ff3b30] font-bold text-xs">✕</button>
                            </div>
                            <div className="max-h-44 overflow-y-auto">
                              {MICRO_AGENTS_LIST.map((ag) => (
                                <button
                                  key={ag.tag}
                                  type="button"
                                  onClick={() => insertAgentTag(ag.tag)}
                                  className="w-full text-left p-2 hover:bg-[#2d482e] border-b border-[#2d482e]/50 last:border-0 flex flex-col transition-colors bmo-btn-tactile"
                                >
                                  <div className="flex justify-between items-center text-[10px] font-bold text-[#b5d6a7]">
                                    <span>{ag.tag}</span>
                                    <span className="text-[8px] bg-[#007aff] text-white px-1.5 py-0.5 rounded font-mono">{ag.name}</span>
                                  </div>
                                  <div className="text-[8px] text-gray-300 truncate">{ag.desc}</div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <textarea ref={textareaRef} value={inputText} onChange={handleInputChange} onKeyDown={handleKeyDown} placeholder="> TYPE OR USE @AGENT..." className="flex-1 bg-[#b5d6a7] border-2 border-[#2d482e] text-[#2d482e] p-2 rounded resize-none focus:outline-none text-xs" rows={2} />
                        <button type="button" title="Dismiss Keyboard" onClick={() => { playClick(); textareaRef.current?.blur(); }} className="p-2 bg-[#7ba068] text-[#2d482e] border-2 border-[#2d482e] rounded shadow-[1px_1px_0_#2d482e] hover:bg-[#b5d6a7] active:translate-y-[1px] bmo-btn-tactile flex items-center justify-center h-10 w-10 shrink-0"><ChevronDown size={18} strokeWidth={3} /></button>
                      </div>
                    </>
                  )}
                </div>
                {isMenuOpen && (
                  <div className="absolute inset-0 bg-[#2d482e]/90 z-20 flex animate-in fade-in duration-200">
                    <div className="w-[85%] max-w-[250px] bg-[#b5d6a7] h-full border-r-4 border-[#2d482e] flex flex-col shadow-[5px_0_15px_rgba(0,0,0,0.5)]">
                      <div className="p-3 border-b-4 border-[#2d482e] flex justify-between items-center bg-[#9fc28e]">
                        <span className="font-bold text-[#2d482e]">SYSTEM ({APP_VERSION})</span>
                        <button type="button" onClick={() => { playClick(); setIsMenuOpen(false); }} className="text-[#ff3b30]"><X size={20} /></button>
                      </div>
                      <div className="p-3 border-b-4 border-[#2d482e] bg-[#cbe3c0] overflow-y-auto">
                         <div className="text-[8px] text-[#2d482e] mb-2 font-bold uppercase tracking-widest">Preferences</div>
                         <button type="button" onClick={() => { playClick(); setIsDashboardOverlayOpen(true); setIsMenuOpen(false); }} className="w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] bg-[#ffcc00] text-[#2d482e] flex items-center justify-center gap-2 font-bold uppercase text-center shadow-[1px_1px_0_black] bmo-btn-tactile">🎮 BMO DASHBOARD</button>
                         <button type="button" onClick={() => { playClick(); setIsTerminalOverlayOpen(true); setIsMenuOpen(false); }} className="w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] bg-[#2d482e] text-[#b5d6a7] flex items-center justify-center gap-2 font-bold uppercase text-center shadow-[1px_1px_0_white] bmo-btn-tactile">📟 SYSTEM TERMINAL</button>
                         <button type="button" onClick={() => { playChime(); setIsOnboardingOpen(true); setIsMenuOpen(false); }} className="w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] bg-[#34c759] text-white flex items-center justify-center gap-2 font-bold uppercase text-center shadow-[1px_1px_0_black] bmo-btn-tactile">🎓 REPLAY TUTORIAL</button>
                         <button type="button" onClick={() => { playClick(); setUseCrtFilter(!useCrtFilter); }} className={`w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] bmo-btn-tactile ${useCrtFilter ? 'bg-[#7ba068] text-[#2d482e] shadow-[1px_1px_0_black]' : 'bg-gray-300 text-black shadow-[1px_1px_0_black]'}`}>BMO CRT FILTER: {useCrtFilter ? 'ON' : 'OFF'}</button>
                         <button type="button" onClick={() => { playChime(); setActiveBrain(b => b === 'local' ? 'gemini' : 'local'); }} className={`w-full p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] transition-colors bmo-btn-tactile ${activeBrain === 'local' ? 'bg-[#ff3b30] text-white shadow-[1px_1px_0_black]' : 'bg-[#007aff] text-white shadow-[1px_1px_0_black]'}`}>{activeBrain === 'local' ? '🤖 LOCAL BMO (OLLAMA)' : '☁️ GEM BMO (CLOUD)'}</button>
                      </div>

                      {isAuthenticated && (
                        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                          <div className="flex gap-1 mb-2">
                            <button type="button" onClick={() => handleNewChat()} className="flex-1 p-2 bg-[#ff3b30] text-white border-2 border-[#2d482e] rounded shadow-[1px_1px_0_black] flex items-center justify-center gap-1 font-bold text-[8px] uppercase bmo-btn-tactile"><Plus size={12} /> NEW</button>
                            <button type="button" onClick={() => handleClearActiveChat()} className="flex-1 p-2 bg-[#ffcc00] text-[#2d482e] border-2 border-[#2d482e] rounded shadow-[1px_1px_0_black] flex items-center justify-center gap-1 text-[8px] font-bold uppercase bmo-btn-tactile"><Trash2 size={12} /> CLEAR</button>
                          </div>
                          <div className="text-[7px] text-white/70 uppercase tracking-widest mb-1 px-0.5">
                            Sessions — ☆ keeps one past restart
                          </div>
                          {activeHistory.map(chat => (
                            <div key={chat.id} className={`flex items-stretch gap-1 mb-1 border-2 border-[#2d482e] rounded overflow-hidden shadow-[1px_1px_0_black] ${activeChatId === chat.id ? 'bg-[#9fc28e]' : 'bg-[#cbe3c0]'}`}>
                              <button type="button" onClick={() => { playClick(); setActiveChatId(chat.id); setIsMenuOpen(false); }} className={`flex-1 p-2 text-left truncate text-[8px] sm:text-[10px] bmo-btn-tactile ${activeChatId === chat.id ? 'font-bold' : ''}`}>
                                {'>'} {chat.title}
                              </button>
                              {/* Keep = survives the auto-prune that clears unused sessions on launch. */}
                              <button type="button" title={chat.kept ? 'Kept — tap to unkeep' : 'Keep this session'} onClick={() => handleToggleKeep(chat.id)} className={`px-2 border-l-2 border-[#2d482e] text-[10px] ${chat.kept ? 'bg-[#ffcc00] text-[#2d482e]' : 'text-[#2d482e]/40'}`}>
                                {chat.kept ? '★' : '☆'}
                              </button>
                              <button type="button" title="Delete session" onClick={() => handleDeleteChat(chat.id)} className="px-2 border-l-2 border-[#2d482e] text-[#ff3b30] font-bold text-[10px]">
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                    </div>
                    <div className="flex-1 cursor-pointer" onClick={() => { playClick(); setIsMenuOpen(false); }}></div>
                  </div>
                )}
              </div>
            </div>
            {/* LABELS & HARDWARE */}
            <div className="mt-4 px-2 sm:px-4">
               <HardwareControls onSend={handleSend} onUploadFile={() => fileInputRef.current?.click()} onOpenCamera={() => cameraInputRef.current?.click()} onDeleteLast={deleteLastMessage} onClearActiveChat={handleClearActiveChat} onStopTTS={onStopTTS} onScrollUp={handleScrollUp} onScrollDown={handleScrollDown} onVoiceCaptured={handleVoiceCaptured} onVoiceError={handleVoiceError} />
            </div>
          </div>
          {/* DASHBOARD RIGHT PANE (Desktop Only) */}
          <div className="hidden lg:flex flex-col h-full overflow-hidden gap-4">
            <div className="flex gap-2 p-1 bg-[#2d482e] rounded-lg shadow-inner">
              <button type="button" onClick={() => { playClick(); setActiveDashboardTab('telemetry'); }} className={`flex-1 py-2 text-[10px] bmo-font rounded transition-all ${activeDashboardTab === 'telemetry' ? 'bg-[#b5d6a7] text-[#2d482e]' : 'text-[#b5d6a7]'}`}>TELEMETRY</button>
              <button type="button" onClick={() => { playClick(); setActiveDashboardTab('editor'); }} className={`flex-1 py-2 text-[10px] bmo-font rounded transition-all ${activeDashboardTab === 'editor' ? 'bg-[#ffcc00] text-[#2d482e]' : 'text-[#b5d6a7]'}`}>BRAIN_EDITOR</button>
            </div>
            <div className="flex-[2] min-h-0 border-4 border-[#2d482e] rounded-xl overflow-hidden shadow-inner">{activeDashboardTab === 'telemetry' ? <TelemetryTerminal /> : <WorkspaceEditor />}</div>
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <Settings activeModel={activeModel} setActiveModel={setActiveModel} safetyStride={safetyStride} setSafetyStride={setSafetyStride} isDreaming={isDreaming} setIsDreaming={setIsDreaming} autoSpeak={autoSpeak} setAutoSpeak={setAutoSpeak} autoHideKeyboard={autoHideKeyboard} setAutoHideKeyboard={setAutoHideKeyboard} voiceRate={voiceRate} setVoiceRate={setVoiceRate} voicePitch={voicePitch} setVoicePitch={setVoicePitch} sfxEnabled={sfxEnabled} setSfxEnabled={setSfxEnabled} tts={tts} currentUser={currentUser} systemHealth={systemHealth} getApiUrl={getApiUrl} getApiToken={getApiToken} onReplayTutorial={() => setIsOnboardingOpen(true)} />
              <Playbook onRunMacro={(p) => { playClick(); setInputText(p); }} />
              <div className="mt-4 p-4 bg-[#b5d6a7] border-4 border-[#2d482e] rounded-[12px] bmo-font text-[#2d482e] text-[8px] flex justify-between items-center shadow-lg">
                <span>SYSTEM STATUS: OPERATIONAL</span><span>PIXEL_FOLD_V2</span>
              </div>
            </div>
          </div>
        </div>

        {/* OVERLAYS for small screens */}
        {isDashboardOverlayOpen && (
          <div className="fixed inset-0 bg-[#5acbb5] z-[100] flex flex-col p-4 animate-in slide-in-from-bottom duration-300 overflow-y-auto border-t-8 border-[#2d482e]">
            <div className="flex justify-between items-center mb-4 sticky top-0 bg-[#5acbb5] py-2 z-10 border-b-4 border-[#2d482e]">
              <div className="text-[#2d482e] bmo-font text-xs flex items-center gap-2">⚙️ DASHBOARD_OVERLAY</div>
              <button type="button" onClick={() => { playClick(); setIsDashboardOverlayOpen(false); }} className="bg-[#ff3b30] text-white px-4 py-2 rounded border-2 border-[#2d482e] bmo-font text-[10px] shadow-[2px_2px_0_#2d482e] active:translate-y-[1px]">CLOSE</button>
            </div>
            <div className="flex flex-col gap-4">
               <div className="flex gap-2 p-1 bg-[#2d482e] rounded-lg shadow-inner">
                <button type="button" onClick={() => { playClick(); setActiveDashboardTab('telemetry'); }} className={`flex-1 py-2 text-[10px] bmo-font rounded transition-all ${activeDashboardTab === 'telemetry' ? 'bg-[#b5d6a7] text-[#2d482e]' : 'text-[#b5d6a7]'}`}>TELEMETRY</button>
                <button type="button" onClick={() => { playClick(); setActiveDashboardTab('editor'); }} className={`flex-1 py-2 text-[10px] bmo-font rounded transition-all ${activeDashboardTab === 'editor' ? 'bg-[#ffcc00] text-[#2d482e]' : 'text-[#b5d6a7]'}`}>BRAIN_EDITOR</button>
              </div>
              <div className="h-[300px] border-4 border-[#2d482e] rounded-xl overflow-hidden shadow-2xl">{activeDashboardTab === 'telemetry' ? <TelemetryTerminal /> : <WorkspaceEditor />}</div>
              <Settings activeModel={activeModel} setActiveModel={setActiveModel} safetyStride={safetyStride} setSafetyStride={setSafetyStride} isDreaming={isDreaming} setIsDreaming={setIsDreaming} autoSpeak={autoSpeak} setAutoSpeak={setAutoSpeak} autoHideKeyboard={autoHideKeyboard} setAutoHideKeyboard={setAutoHideKeyboard} voiceRate={voiceRate} setVoiceRate={setVoiceRate} voicePitch={voicePitch} setVoicePitch={setVoicePitch} sfxEnabled={sfxEnabled} setSfxEnabled={setSfxEnabled} tts={tts} currentUser={currentUser} systemHealth={systemHealth} getApiUrl={getApiUrl} getApiToken={getApiToken} onReplayTutorial={() => setIsOnboardingOpen(true)} />
              <Playbook onRunMacro={(p) => { playClick(); setInputText(p); setIsDashboardOverlayOpen(false); }} />
            </div>
          </div>
        )}
        {isTerminalOverlayOpen && (
          <div className="fixed inset-0 bg-black z-[100] flex flex-col p-4 animate-in fade-in duration-300">
            <div className="flex justify-between items-center mb-4 text-[#b5d6a7] bmo-font text-xs border-b border-[#b5d6a7] pb-2">
              <div className="flex items-center gap-2"><span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>LIVE_TELEMETRY</div>
              <button type="button" onClick={() => { playClick(); setIsTerminalOverlayOpen(false); }} className="bg-[#ff3b30] text-white px-4 py-2 rounded border-2 border-white bmo-font text-[10px] shadow-[2px_2px_0_white] active:translate-y-[1px]">EXIT</button>
            </div>
            <div className="flex-1 overflow-hidden border-2 border-[#b5d6a7] rounded-lg shadow-inner"><TelemetryTerminal /></div>
          </div>
        )}

        <OnboardingModal isOpen={isOnboardingOpen} onClose={() => setIsOnboardingOpen(false)} />
      </div>
    </>
  );
}
