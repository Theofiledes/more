import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, Plus, User, X, File as FileIcon, Lock, Image as ImageIcon, Sparkles, Terminal, Volume2, ShieldCheck, ShieldAlert, Trash2, ChevronDown, GraduationCap, Loader2 } from 'lucide-react';
import TelemetryTerminal from './components/TelemetryTerminal';
import ChatFeed from './components/ChatFeed';
import HardwareControls from './components/HardwareControls';
import Settings from './components/Settings';
import Playbook from './components/Playbook';
import WorkspaceEditor from './components/WorkspaceEditor';
import OnboardingModal from './components/OnboardingModal';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { playClick, playChime, playCheer, playGlitch, playBeep, playCartridge } from './utils/soundEffects';

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
    } catch (e) {
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
    try { await TextToSpeech.stop(); if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { }
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

const USERS = { Anthony: { pin: '8436' }, Kayla: { pin: '4321' } };

const parseToolCall = (text) => {
  if (!text || typeof text !== 'string' || !text.trim().startsWith('{')) return null;
  try {
    const p = JSON.parse(text);
    if (p && typeof p.tool === 'string') return { tool: p.tool, action: p.action || null };
  } catch { }
  return null;
};

const getApiUrl = () => {
  const customUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('bmo_custom_api_url') : null;
  if (customUrl) return customUrl.replace(/\/$/, "");
  const envUrl = import.meta.env.VITE_BMO_API_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  const isDesktopLocal = typeof window !== 'undefined' && !window.Capacitor && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  if (isDesktopLocal) return "http://localhost:18789";
  return "http://100.84.254.37:18789";
};

const getApiToken = () => import.meta.env.VITE_BMO_API_KEY || "bmo-secret-key-2026";

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
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents })
    });
    if (!res.ok) throw new Error(`Gemini API returned ${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Gemini did not return a response.";
  } catch (e) {
    console.error("Gemini API error:", e);
    return `Gemini Error: ${e.message}`;
  }
};

const sendLocalBmoCommand = async (command, history = [], image = null, file = null, model = "ornith:9b", onStatusUpdate = null) => {
  const apiUrl = getApiUrl();
  const apiToken = getApiToken();
  const nc = typeof command === 'string' ? command.trim() : '';

  let promptText = nc;
  if (file && file.content) {
    promptText = `[Attached File: ${file.name}]\n\`\`\`\n${file.content}\n\`\`\`\n\n${nc || 'Please analyze this attached file.'}`;
  }

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

    // Fallback to Gemini Cloud Vision if Moondream was not available
    if (!imageDescription) {
      onStatusUpdate?.("☁️ Routing image to Gemini Cloud Vision...");
      return await fetchGemini(command, image, file, history);
    }

    // Step 2: Pass Moondream's optical description into BMO's core personality model
    onStatusUpdate?.("🤖 BMO BRAIN COMPUTING: Synthesizing personality response...");
    const visionContextPrompt = `[BMO OPTICAL SENSOR DATA (Moondream Vision)]:
"${imageDescription}"

User Question: "${nc || 'What do you see in this image?'}"`;

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
        body: JSON.stringify({ model: model || "ornith:9b", messages: msgs })
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
  const msgs = [...history.map(m => ({
    role: m.sender === 'user' ? 'user' : 'assistant',
    content: m.text || (m.type === 'image' ? '[User sent an image]' : '[User sent a file]')
  })), { role: 'user', content: rc }];

  try {
    const res = await fetch(`${apiUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiToken}` },
      body: JSON.stringify({ model: model || "ornith:9b", messages: msgs })
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content || null;
    }
  } catch (error) {
    console.error("Local BMO request failed:", error);
  }

  return null;
};


export default function App() {
  const [currentUser, setCurrentUser] = useState('Anthony');
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('bmo_authenticated') === 'true');
  const [isServerSleeping, setIsServerSleeping] = useState(false);
  useEffect(() => { localStorage.setItem('bmo_authenticated', isAuthenticated); }, [isAuthenticated]);
  const [messages, setMessages] = useState(() => { const s = localStorage.getItem('bmo_messages'); return s ? JSON.parse(s) : []; });
  useEffect(() => { localStorage.setItem('bmo_messages', JSON.stringify(messages)); }, [messages]);
  const [inputText, setInputText] = useState(() => localStorage.getItem('bmo_input_buffer') || '');
  useEffect(() => { localStorage.setItem('bmo_input_buffer', inputText); }, [inputText]);
  const [history, setHistory] = useState([]);
  const [activeChatId, setActiveChatId] = useState(() => { const s = localStorage.getItem('bmo_active_chat_id'); return s ? parseInt(s) : null; });
  useEffect(() => { if (activeChatId) localStorage.setItem('bmo_active_chat_id', activeChatId); }, [activeChatId]);
  
  const [activeModel, setActiveModel] = useState(() => localStorage.getItem('bmo_active_model') || 'moondream');
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

  const [isLoading, setIsLoading] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState('');
  const isSendingRef = useRef(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [isEncoding, setIsEncoding] = useState(false);
  const [isHappy, setIsHappy] = useState(false);
  const [isEating, setIsEating] = useState(false);
  const [face, setFace] = useState('^_^');
  const [systemHealth, setSystemHealth] = useState({ backend: 'OFFLINE', ollama: 'OFFLINE' });
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingImageUrl, setPendingImageUrl] = useState(null);
  const [useCrtFilter, setUseCrtFilter] = useState(true);
  const [activeBrain, setActiveBrain] = useState('local');
  const [speakingMsgId, setSpeakingMsgId] = useState(null);
  const [activeDashboardTab, setActiveDashboardTab] = useState('telemetry');
  const [isTerminalOverlayOpen, setIsTerminalOverlayOpen] = useState(false);
  const [isDashboardOverlayOpen, setIsDashboardOverlayOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

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
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/[*_#>`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const tts = useNativeTTS();

  const checkBackendDeploymentStatus = useCallback(async () => {
    const apiUrl = getApiUrl();
    const apiToken = getApiToken();

    try {
      const res = await fetch(`${apiUrl}/v1/health`, { headers: { "Authorization": `Bearer ${apiToken}` } });
      if (res.ok) {
        const health = await res.json();
        setSystemHealth(health);
        setIsServerSleeping(false);

        const newStatus = health.backend === 'OK' ? 'OK' : 'RESTARTING';
        if (lastStatusRef.current !== null && lastStatusRef.current !== newStatus) {
          if (newStatus === 'OK') {
            showToast('🟢 LINK STABLE: Server online.', 'success');
            playChime();
          } else {
            showToast('🟡 SERVER RESTARTING...', 'warning');
            playGlitch();
          }
        }
        lastStatusRef.current = newStatus;
        setServerStatus(newStatus);
      } else {
        setSystemHealth({ backend: 'OFFLINE', ollama: 'OFFLINE' });
        setIsServerSleeping(true);
        if (lastStatusRef.current !== 'RESTARTING' && lastStatusRef.current !== null) {
          showToast('🟡 SERVER RESTARTING...', 'warning');
          playGlitch();
        }
        lastStatusRef.current = 'RESTARTING';
        setServerStatus('RESTARTING');
      }
    } catch (e) {
      setSystemHealth({ backend: 'OFFLINE', ollama: 'OFFLINE' });
      setIsServerSleeping(true);
      if (lastStatusRef.current !== 'RESTARTING' && lastStatusRef.current !== null) {
        showToast('🟡 SERVER RESTARTING...', 'warning');
        playGlitch();
      }
      lastStatusRef.current = 'RESTARTING';
      setServerStatus('RESTARTING');
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
    } catch (e) { }
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
      } catch (e) { }
    };
    syncState();
  }, [safetyStride, isDreaming]);

  useEffect(() => {
    if (systemHealth.backend !== 'OK') { setFace('X_X'); return; }

    if (isLoading) { setFace('O_O'); return; }
    if (isHappy) { setFace('\\o/'); return; }
    if (isEating) { setFace('>_<'); const sw = setTimeout(() => setFace('~_~'), 500); const fi = setTimeout(() => setIsEating(false), 1500); return () => { clearTimeout(sw); clearTimeout(fi); }; }
    setFace('^_^');
    const blink = setInterval(() => { setFace('-_-'); setTimeout(() => setFace(p => p === '-_-' ? '^_^' : p), 200); }, 4000 + Math.random() * 2000);
    return () => clearInterval(blink);
  }, [isLoading, isHappy, isEating, systemHealth]);

  const messagesEndRef = useRef(null);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, currentUser, activeChatId, isAuthenticated]);

  const handleUserToggle = (user) => {
    playClick();
    setIsAuthenticated(false);
    localStorage.removeItem('bmo_authenticated');
    localStorage.removeItem('bmo_messages');
    localStorage.removeItem('bmo_input_buffer');
    setSpeakingMsgId(null);
    setCurrentUser(user);
    setIsServerSleeping(false);
    setPinInput('');
    setIsMenuOpen(false);
    setMessages([]);
    setHistory([]);
    setActiveChatId(null);
  };

  const performServerHandshake = async (user) => {
    const apiUrl = getApiUrl();
    const apiToken = getApiToken();
    try {
      const res = await fetch(`${apiUrl}/v1/chat/history`, { headers: { "Authorization": `Bearer ${apiToken}` } });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.chats || []);
        if (messages.length === 0) setMessages(data.messages || []);
        const uc = (data.chats || []).filter(h => h.user === user);
        let rid = activeChatId || (uc.length > 0 ? uc[0].id : 1);
        if (history.length === 0 && uc.length === 0) setHistory([{ id: rid, user: user, title: 'NEW SESSION' }]);
        setActiveChatId(rid); setIsAuthenticated(true); setIsServerSleeping(false);
        playChime();
      } else {
        setIsAuthenticated(true); setIsServerSleeping(false); if (!activeChatId) setActiveChatId(1);
        playChime();
      }
    } catch (e) {
      setIsServerSleeping(true);
      if (history.length === 0) { setHistory([{ id: 1, user: user, title: 'OFFLINE_MODE' }]); setActiveChatId(1); }
      playGlitch();
    }
  };

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
    } catch (e) { }
  };

  const handleNewChat = (uo = null) => {
    playChime();
    const u = uo || currentUser;
    const existingIds = history.map(h => h.id).filter(id => typeof id === 'number');
    const ni = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
    const greetingMsg = { id: Date.now() + Math.random(), chatId: ni, user: u, sender: 'bmo', type: 'text', text: `GREETINGS ${u.toUpperCase()}! NEW CHAT SESSION READY. 🎮✨` };
    
    const updatedHistory = [{ id: ni, user: u, title: `SESSION #${ni}` }, ...history];
    const updatedMessages = [...messages.filter(m => m.chatId !== ni), greetingMsg];
    
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
    setMessages(updatedMsgs);
    setIsMenuOpen(false);
    saveServerHistory(history, updatedMsgs);
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
    let nm = { id: Date.now() + Math.random(), chatId: activeChatId, user: currentUser, sender: 'user', text: ci, type: 'text' };
    if (cim) { 
      nm.type = 'image'; nm.imageUrl = cim; nm.text = ci; 
    } else if (cf) { 
      nm.type = 'file'; nm.fileName = cf.name; nm.text = ci ? `${ci}\n[Attached: ${cf.name}]` : `[Attached: ${cf.name}]`; 
    }
    const cam = messages.filter(m => m.chatId === activeChatId && m.user === currentUser);
    setMessages(prev => [...prev, nm]); setInputText(''); setPendingFile(null); setPendingImageUrl(null); setIsLoading(true);

    if (cim) {
      setThinkingStatus('🤖 BMO GOT YOUR IMAGE! WAKING UP VISION BRAIN... 👁️✨');
    } else if (cf) {
      setThinkingStatus(`📼 BMO EATING CARTRIDGE! READING ${cf.name.toUpperCase()}... 📄⚡`);
    } else {
      setThinkingStatus('💭 BMO COMPUTING... *BOOP BEEP BLOOP!* 🎮');
    }

    let brt = "BMO COMPUTES COMMAND.";
    if (activeBrain === 'gemini') { 
      const fh = cam.slice(-6).map(m => ({ role: m.sender === 'user' ? 'user' : 'model', parts: [{ text: m.text || (m.type === 'image' ? '[User sent an image]' : '[User sent a file]') }] })); 
      brt = await fetchGemini(ci, cim, cf, fh); 
    } else { 
      setFace('O_O'); 
      const res = await sendLocalBmoCommand(ci, cam.slice(-6), cim, cf, activeModel, (msg) => setThinkingStatus(msg)); 
      brt = res || "BMO is computing... If there is no reply, please check local server link! ^_^;"; 
    }

    setIsLoading(false); setIsHappy(true); isSendingRef.current = false;
    const bmi = Date.now() + Math.random();
    const bmsg = { id: bmi, chatId: activeChatId, user: currentUser, sender: 'bmo', type: 'text', text: brt };
    setMessages(prev => [...prev, bmsg]);
    
    if (autoSpeak && !parseToolCall(brt)) {
      const speech = cleanTextForTts(brt);
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
        r.onloadend = () => { setPendingImageUrl(r.result); setPendingFile(null); setIsEncoding(false); setIsEating(true); };
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

  return (
    <>
      <style>{fontStyle}</style>
      <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileSelect} />
      <input type="file" ref={cameraInputRef} accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFileSelect} />
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-2 sm:p-4 font-sans selection:bg-[#2d482e] selection:text-[#b5d6a7]">
        <div className="w-full max-w-md lg:max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-6 items-start h-[95vh]">
          <div className="bg-[#5acbb5] w-full h-full rounded-[40px] shadow-[inset_0_-10px_20px_rgba(0,0,0,0.2),0_15px_30px_rgba(0,0,0,0.5)] flex flex-col p-3 sm:p-5 relative overflow-hidden border-8 border-[#4ba896]">
            <div className="flex justify-center mb-3"><div className="w-16 h-2 bg-[#2d482e] rounded-full opacity-50"></div></div>
            <div className={`bg-[#1a2e1d] rounded-[24px] p-3 flex-1 flex flex-col relative shadow-[inset_0_4px_10px_rgba(0,0,0,0.6)] overflow-hidden`}>
              <div className={`bg-[#b5d6a7] w-full h-full rounded-[12px] flex flex-col overflow-hidden relative border-4 border-[#2d482e] bmo-font text-[10px] sm:text-xs ${useCrtFilter ? 'crt-scanlines' : ''}`}>
                <header className="border-b-4 border-[#2d482e] p-2 sm:p-3 flex justify-between items-center bg-[#9fc28e] z-10 relative">
                  <button type="button" onClick={() => { playClick(); setIsMenuOpen(true); }} className="text-[#2d482e] hover:text-[#007aff] transition-colors z-10"><Menu size={20} strokeWidth={3} /></button>
                  <div className={`text-lg sm:text-xl font-bold tracking-widest text-[#2d482e] transition-all duration-200 absolute left-1/2 -translate-x-1/2 ${isHappy ? 'animate-face-pop scale-125 text-green-900' : ''}`}>{face}</div>
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
                <div className="flex-1 overflow-hidden flex flex-col relative">
                  {toastMessage && (
                    <div className="absolute top-2 left-2 right-2 z-30 bg-[#2d482e] text-[#b5d6a7] border-2 border-[#b5d6a7] px-3 py-2 rounded-lg text-[9px] font-bold shadow-xl flex items-center justify-between animate-in slide-in-from-top duration-300">
                      <span className="truncate">{toastMessage.text}</span>
                      <button type="button" onClick={() => setToastMessage(null)} className="text-white hover:text-red-400 ml-2">
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  {isServerSleeping ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#2d482e]">
                      <div className="text-4xl mb-4">z_z</div><p className="mb-2">OFFLINE...</p>
                      <button type="button" onClick={() => { playClick(); runDiagnostic(); }} className="px-4 py-2 bg-[#007aff] text-white border-2 border-[#2d482e] rounded shadow-[2px_2px_0_#2d482e] hover:translate-y-[2px] transition-all bmo-btn-tactile">RETRY LINK</button>
                    </div>
                  ) : !isAuthenticated ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#2d482e]">
                      <Lock size={48} className="mb-4 opacity-80" strokeWidth={2} /><h2 className="mb-6">SECURE CONNECTION:<br/>{currentUser.toUpperCase()}</h2>
                      <div className="w-full max-w-[200px]">
                        <input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAuth(e)} placeholder="ENTER PIN" className="w-full bg-[#9fc28e] border-2 border-[#2d482e] text-[#2d482e] p-3 rounded text-center mb-4" />
                      </div>
                    </div>
                  ) : (
                    <>
                      <ChatFeed messages={activeMessages} currentUser={currentUser} activeChatId={activeChatId} useCrtFilter={useCrtFilter} tts={tts} speakingMsgId={speakingMsgId} setSpeakingMsgId={setSpeakingMsgId} getApiUrl={getApiUrl} getApiToken={getApiToken} />
                      {isLoading && (
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
                      <div className="border-t-4 border-[#2d482e] bg-[#9fc28e] p-2 flex items-center gap-2">
                        <textarea ref={textareaRef} value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={handleKeyDown} placeholder="> TYPE..." className="flex-1 bg-[#b5d6a7] border-2 border-[#2d482e] text-[#2d482e] p-2 rounded resize-none focus:outline-none text-xs" rows={2} />
                        <button type="button" title="Dismiss Keyboard" onClick={() => { playClick(); textareaRef.current?.blur(); }} className="p-2 bg-[#7ba068] text-[#2d482e] border-2 border-[#2d482e] rounded shadow-[1px_1px_0_#2d482e] hover:bg-[#b5d6a7] active:translate-y-[1px] bmo-btn-tactile flex items-center justify-center h-10 w-10 shrink-0"><ChevronDown size={18} strokeWidth={3} /></button>
                      </div>
                    </>
                  )}
                </div>
                {isMenuOpen && (
                  <div className="absolute inset-0 bg-[#2d482e]/90 z-20 flex animate-in fade-in duration-200">
                    <div className="w-[85%] max-w-[250px] bg-[#b5d6a7] h-full border-r-4 border-[#2d482e] flex flex-col shadow-[5px_0_15px_rgba(0,0,0,0.5)]">
                      <div className="p-3 border-b-4 border-[#2d482e] flex justify-between items-center bg-[#9fc28e]">
                        <span className="font-bold text-[#2d482e]">SYSTEM (v7.1.0)</span>
                        <button type="button" onClick={() => { playClick(); setIsMenuOpen(false); }} className="text-[#ff3b30]"><X size={20} /></button>
                      </div>
                      <div className="p-3 border-b-4 border-[#2d482e] bg-[#cbe3c0] overflow-y-auto">
                         <div className="text-[8px] text-[#2d482e] mb-2 font-bold uppercase tracking-widest">Preferences</div>
                         <button type="button" onClick={async () => { 
                            playChime();
                            const h = await runDiagnostic();
                            const msg = h?.backend === 'OK' ? "BMO IS AWAKE. LOCAL BRAIN NOMINAL." : "BMO IS AWAKE. BUT LOCAL SERVER IS OFFLINE.";
                            tts.speak(msg, undefined, voiceRate, voicePitch); setIsMenuOpen(false); 
                         }} className="w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] bg-[#007aff] text-white flex items-center justify-center gap-2 font-bold uppercase text-center shadow-[1px_1px_0_black] bmo-btn-tactile">🔊 WAKE & SYNC</button>
                         <button type="button" onClick={() => { playClick(); setIsDashboardOverlayOpen(true); setIsMenuOpen(false); }} className="w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] bg-[#ffcc00] text-[#2d482e] flex items-center justify-center gap-2 font-bold uppercase text-center shadow-[1px_1px_0_black] bmo-btn-tactile">🎮 BMO DASHBOARD</button>
                         <button type="button" onClick={() => { playClick(); setIsTerminalOverlayOpen(true); setIsMenuOpen(false); }} className="w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] bg-[#2d482e] text-[#b5d6a7] flex items-center justify-center gap-2 font-bold uppercase text-center shadow-[1px_1px_0_white] bmo-btn-tactile">📟 SYSTEM TERMINAL</button>
                         <button type="button" onClick={() => { playChime(); setIsOnboardingOpen(true); setIsMenuOpen(false); }} className="w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] bg-[#34c759] text-white flex items-center justify-center gap-2 font-bold uppercase text-center shadow-[1px_1px_0_black] bmo-btn-tactile">🎓 REPLAY TUTORIAL</button>
                         <button type="button" onClick={() => { playClick(); setUseCrtFilter(!useCrtFilter); }} className={`w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] bmo-btn-tactile ${useCrtFilter ? 'bg-[#7ba068] text-[#2d482e] shadow-[1px_1px_0_black]' : 'bg-gray-300 text-black shadow-[1px_1px_0_black]'}`}>BMO CRT FILTER: {useCrtFilter ? 'ON' : 'OFF'}</button>
                         <button type="button" onClick={() => { playChime(); setActiveBrain(b => b === 'local' ? 'gemini' : 'local'); }} className={`w-full p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] transition-colors bmo-btn-tactile ${activeBrain === 'local' ? 'bg-[#ff3b30] text-white shadow-[1px_1px_0_black]' : 'bg-[#007aff] text-white shadow-[1px_1px_0_black]'}`}>{activeBrain === 'local' ? '🤖 LOCAL BMO (OLLAMA)' : '☁️ GEM BMO (CLOUD)'}</button>
                      </div>

                      <div className="p-3 border-b-4 border-[#2d482e] bg-[#7ba068]">
                        <div className="text-[8px] text-white mb-2 flex items-center justify-between font-bold uppercase tracking-widest">Accounts</div>
                        <div className="flex flex-col gap-2 text-xs">
                          {Object.keys(USERS).map(user => (
                            <button key={user} type="button" onClick={() => handleUserToggle(user)} className={`p-2 rounded border-2 border-[#2d482e] text-left bmo-btn-tactile ${currentUser === user ? 'bg-[#007aff] text-white shadow-[1px_1px_0_black]' : 'bg-[#b5d6a7] shadow-[1px_1px_0_black]'}`}>{user.toUpperCase()}</button>
                          ))}
                        </div>
                      </div>
                      {isAuthenticated && (
                        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                          <button type="button" onClick={() => handleNewChat()} className="w-full p-3 bg-[#ff3b30] text-white border-2 border-[#2d482e] rounded shadow-[2px_2px_0_#2d482e] flex items-center justify-center gap-2 mb-1 font-bold text-xs bmo-btn-tactile"><Plus size={16} /> NEW CHAT</button>
                          <button type="button" onClick={() => handleClearActiveChat()} className="w-full p-2 bg-[#ffcc00] text-[#2d482e] border-2 border-[#2d482e] rounded shadow-[1px_1px_0_black] flex items-center justify-center gap-2 mb-2 text-[8px] font-bold uppercase bmo-btn-tactile"><Trash2 size={12} /> CLEAR SCREEN BUFFER</button>
                          {activeHistory.map(chat => (
                            <button key={chat.id} type="button" onClick={() => { playClick(); setActiveChatId(chat.id); setIsMenuOpen(false); }} className={`p-3 border-2 border-[#2d482e] rounded text-left truncate text-[8px] sm:text-[10px] shadow-[1px_1px_0_black] bmo-btn-tactile ${activeChatId === chat.id ? 'bg-[#9fc28e] font-bold' : 'bg-[#cbe3c0]'}`}>{'>'} {chat.title}</button>
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
               <HardwareControls onSend={handleSend} onUploadFile={() => fileInputRef.current?.click()} onOpenCamera={() => cameraInputRef.current?.click()} onDeleteLast={deleteLastMessage} onClearActiveChat={handleClearActiveChat} onStopTTS={onStopTTS} onScrollUp={handleScrollUp} onScrollDown={handleScrollDown} />
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
