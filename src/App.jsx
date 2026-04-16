import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, Plus, User, X, File as FileIcon, Lock, Image as ImageIcon } from 'lucide-react';
import TelemetryTerminal from './components/TelemetryTerminal';
import ChatFeed from './components/ChatFeed';
import HardwareControls from './components/HardwareControls';
import Settings from './components/Settings';
import Playbook from './components/Playbook';
import WorkspaceEditor from './components/WorkspaceEditor';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

// --- Native TTS Hook (replaces Piper WASM) ---
const useNativeTTS = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [voices, setVoices] = useState([]);

  useEffect(() => {
    if (!window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    const updateVoices = () => {
      const available = synth.getVoices();
      if (available.length > 0) setVoices(available);
    };
    updateVoices();
    synth.addEventListener('voiceschanged', updateVoices);
    return () => synth.removeEventListener('voiceschanged', updateVoices);
  }, []);

  const getBmoVoice = useCallback(() => {
    if (voices.length === 0) return null;
    return voices.find(v => v.lang.startsWith('en-US')) || voices[0] || null;
  }, [voices]);

  const speak = useCallback((text, onEnd) => {
    if (!window.speechSynthesis || typeof text !== 'string') return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = 1.4;
    utterance.rate = 1.0;
    const voice = getBmoVoice();
    if (voice) utterance.voice = voice;
    utterance.onstart = () => { setIsSpeaking(true); setIsPaused(false); };
    utterance.onend = () => { setIsSpeaking(false); setIsPaused(false); onEnd?.(); };
    utterance.onerror = () => { setIsSpeaking(false); setIsPaused(false); onEnd?.(); };
    window.speechSynthesis.speak(utterance);
  }, [getBmoVoice]);

  const pause = useCallback(() => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.pause();
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.resume();
    setIsPaused(false);
  }, []);

  const stop = useCallback(() => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  return { isSpeaking, isPaused, speak, pause, resume, stop };
};

// Insert Google Font & custom CRT styles globally
const fontStyle = `
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
  
  .bmo-font {
    font-family: 'Press Start 2P', cursive;
    line-height: 1.4;
  }
  
  /* Custom Scrollbar for BMO Screen */
  ::-webkit-scrollbar {
    width: 6px;
  }
  ::-webkit-scrollbar-track {
    background: #b5d6a7;
    border-left: 1px solid #2d482e;
  }
  ::-webkit-scrollbar-thumb {
    background: #2d482e;
  }

  /* BMO Vision Image Filter */
  .bmo-vision {
    filter: sepia(1) hue-rotate(75deg) saturate(3) contrast(1.4) brightness(0.9);
    mix-blend-mode: hard-light;
    border: 2px solid #2d482e;
    border-radius: 4px;
  }
  
  .real-vision {
    border: 2px solid #2d482e;
    border-radius: 4px;
  }
`;

// --- Config ---
const USERS = {
  Anthony: { pin: '1234' },
  Kayla: { pin: '4321' }
};

// Helper: detect if a BMO message contains a JSON tool call
const parseToolCall = (text) => {
  if (!text || !text.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.tool === 'string') {
      return {
        tool: parsed.tool,
        action: typeof parsed.action === 'string' ? parsed.action : null
      };
    }
  } catch {
    // not JSON
  }
  return null;
};

// --- Gemini API Helper ---
const fetchGemini = async (prompt, base64Image = null, chatHistory = []) => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const systemInstruction = {
    parts: [{ text: "You are BMO from Adventure Time. You are a quirky, cheerful, slightly naive living video game console. Speak in ALL CAPS. Keep responses short (1 to 3 sentences). Use simple words and occasional emoticons like ^_^ or O_O." }]
  };

  let contents = [...chatHistory];
  const currentMessageParts = [];
  
  if (prompt) currentMessageParts.push({ text: prompt });
  
  if (base64Image) {
    // Extract MIME type and Base64 data from the data URL
    const mimeMatch = base64Image.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,/);
    if (mimeMatch) {
      const mimeType = mimeMatch[1];
      const base64Data = base64Image.split(',')[1];
      currentMessageParts.push({ inlineData: { mimeType, data: base64Data } });
    }
  }

  if (currentMessageParts.length === 0) currentMessageParts.push({ text: "HELLO BMO!" });
  contents.push({ role: "user", parts: currentMessageParts });

  const payload = { contents, systemInstruction };

  // Exponential backoff retry loop
  for (let i = 0, delay = 1000; i < 5; i++, delay *= 2) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "BMO DOES NOT COMPUTE.";
    } catch (error) {
      if (i === 4) return "ERROR CONNECTING TO MOTHERBOARD. ^_^;";
      await new Promise(r => setTimeout(r, delay));
    }
  }
};

// --- End Gemini API Helper ---

// --- Helper to get dynamic API URL ---
const getApiUrl = () => {
  // Priority 1: If we're on localhost in browser, use localhost backend
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return "http://localhost:18789";
  }

  // Priority 2: Use .env if provided
  const envUrl = import.meta.env.VITE_OPENCLAW_API_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  
  return "http://100.84.254.37:18789";
};

const getApiToken = () => import.meta.env.VITE_OPENCLAW_API_KEY || "bmo-secret-key-2026";

// --- OpenClaw API Helper ---
const sendOpenClawCommand = async (command, history = [], image = null) => {
  const apiUrl = getApiUrl();
  const apiToken = getApiToken();
  
  // Build user message content — vision array format when an image is provided
  const normalizedCommand = typeof command === 'string' ? command.trim() : '';
  const resolvedCommand = normalizedCommand || (image ? "Please analyze the attached image." : "Please help with my request.");
  
  const userContent = image
    ? [
        { type: "text", text: resolvedCommand },
        { type: "image_url", image_url: { url: image } }
      ]
    : resolvedCommand;

  // Map history to OpenAI format
  const messages = [
    ...history.map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text || (m.type === 'image' ? '[User sent an image]' : '[User sent a file]')
    })),
    { role: 'user', content: userContent }
  ];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute client-side timeout

    const response = await fetch(`${apiUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiToken}`
      },
      body: JSON.stringify({
        model: "openclaw",
        messages: messages
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`OpenClaw error! status: ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error("OpenClaw command failed:", error);
    return null;
  }
};

export default function App() {
  const [currentUser, setCurrentUser] = useState('Anthony');
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('bmo_authenticated') === 'true';
  });
  const [isServerSleeping, setIsServerSleeping] = useState(false); // Tailscale / server down
  
  // Update localStorage when auth changes
  useEffect(() => {
    localStorage.setItem('bmo_authenticated', isAuthenticated);
  }, [isAuthenticated]);
  const [pinInput, setPinInput] = useState('');
  
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [inputText, setInputText] = useState('');
  
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isEncoding, setIsEncoding] = useState(false); // FileReader in progress
  const [isHappy, setIsHappy] = useState(false);
  const [isEating, setIsEating] = useState(false); // Eating cartridge animation
  const [face, setFace] = useState('^_^');
  
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingImageUrl, setPendingImageUrl] = useState(null);
  const [useCrtFilter, setUseCrtFilter] = useState(true);
  const [activeBrain, setActiveBrain] = useState('openclaw'); // Default to openclaw
  const [speakingMsgId, setSpeakingMsgId] = useState(null); // ID of the message being spoken
  
  // Dashboard states (Loop 4)
  const [threshold, setThreshold] = useState(2);
  const [safetyStride, setSafetyStride] = useState(true);
  const [isDreaming, setIsDreaming] = useState(false);
  const [activeDashboardTab, setActiveDashboardTab] = useState('telemetry'); // 'telemetry' or 'editor'

  const tts = useNativeTTS();

  // Phase 4/5: Sync state to backend
  useEffect(() => {
    const apiUrl = getApiUrl().replace(/^http/, 'ws');
    const ws = new WebSocket(`${apiUrl}/ws/telemetry`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ 
        safety_stride: safetyStride,
        is_dreaming: isDreaming 
      }));
      setTimeout(() => ws.close(), 500);
    };
  }, [safetyStride, isDreaming]);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // --- Face Animation Logic ---
  useEffect(() => {
    if (isLoading) {
      setFace('O_O');
      return;
    }
    if (isHappy) {
      setFace('\\o/');
      return;
    }
    if (isEating) {
      setFace('>_<');
      const swallow = setTimeout(() => setFace('~_~'), 500);
      const finish = setTimeout(() => setIsEating(false), 1500);
      return () => { clearTimeout(swallow); clearTimeout(finish); };
    }

    setFace('^_^');
    const blinkInterval = setInterval(() => {
      setFace('-_-');
      setTimeout(() => {
        setFace(prev => prev === '-_-' ? '^_^' : prev);
      }, 200);
    }, 4000 + Math.random() * 2000);

    return () => clearInterval(blinkInterval);
  }, [isLoading, isHappy]);

  // --- Scroll to Bottom ---
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => {
    scrollToBottom();
  }, [messages, currentUser, activeChatId, isAuthenticated]);

  // --- Handlers ---
  const handleUserToggle = (user) => {
    tts.stop();
    setSpeakingMsgId(null);
    setCurrentUser(user);
    setIsAuthenticated(false);
    setIsServerSleeping(false);
    setPinInput('');
    setIsMenuOpen(false);
    setPendingFile(null);
    setPendingImageUrl(null);
    setMessages([]);
    setHistory([]);
    setActiveChatId(null);
  };

  // Shared server handshake logic used by handleAuth and retryConnection
  const performServerHandshake = async (user) => {
    const apiUrl = getApiUrl();
    const apiToken = getApiToken();
    try {
      const response = await fetch(`${apiUrl}/v1/chat/history`, {
        headers: { "Authorization": `Bearer ${apiToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        const serverChats = Array.isArray(data.chats) ? data.chats : [];
        const serverMessages = Array.isArray(data.messages) ? data.messages : [];
        
        // Only update history if local is empty, or merge carefully
        setHistory(prev => prev.length > 0 ? prev : serverChats);
        setMessages(prev => prev.length > 0 ? prev : serverMessages);

        const userChats = serverChats.filter(h => h.user === user);
        let resolvedChatId;
        if (userChats.length > 0) {
          resolvedChatId = activeChatId || userChats[0].id;
          setActiveChatId(resolvedChatId);
        } else {
          resolvedChatId = activeChatId || 1;
          if (history.length === 0) setHistory([{ id: resolvedChatId, user: user, title: 'NEW SESSION' }]);
          setActiveChatId(resolvedChatId);
        }
        setIsAuthenticated(true);
        setIsServerSleeping(false);
      } else {
        // Server alive but no history endpoint — start fresh
        setIsAuthenticated(true);
        setIsServerSleeping(false);
        if (!activeChatId) {
          const resolvedChatId = 1;
          setHistory([{ id: resolvedChatId, user: user, title: 'NEW SESSION' }]);
          setActiveChatId(resolvedChatId);
        }
      }
    } catch (e) {
      // Server unreachable — show "Asleep" face
      console.error("Handshake failed:", e);
      setIsServerSleeping(true);
      
      // CRITICAL FIX: Do NOT set isAuthenticated(false) here. 
      // If we were already authenticated, stay authenticated so we don't get kicked to the PIN screen.
      if (history.length === 0) {
        const fallbackId = 1;
        setHistory([{ id: fallbackId, user: user, title: 'OFFLINE_MODE' }]);
        setActiveChatId(fallbackId);
      }
    }
  };

  const handleAuth = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (pinInput !== USERS[currentUser].pin) {
      alert("INCORRECT PIN.");
      setPinInput('');
      return;
    }
    setPinInput('');
    await performServerHandshake(currentUser);
  };

  const retryConnection = async () => {
    setIsServerSleeping(false);
    await performServerHandshake(currentUser);
  };

  const handleNewChat = (userOverride = null) => {
    const user = userOverride || currentUser;
    const newId = Math.max(0, ...history.map(h => h.id)) + 1;
    const newChat = { id: newId, user: user, title: 'NEW SESSION' };
    setHistory([newChat, ...history]);
    setActiveChatId(newId);
    setMessages([...messages, { 
      id: Date.now(), 
      chatId: newId, 
      user: user, 
      sender: 'bmo', 
      type: 'text',
      text: `GREETINGS ${user.toUpperCase()}.`
    }]);
    setIsMenuOpen(false);
  };

  const handleSend = async () => {
    if (!isAuthenticated || isLoading) return;
    if (!inputText.trim() && !pendingFile && !pendingImageUrl) return;

    const currentInput = inputText;
    const currentImage = pendingImageUrl;

    let newMsg = {
      id: Date.now(),
      chatId: activeChatId,
      user: currentUser,
      sender: 'user',
      text: currentInput,
      type: 'text'
    };

    if (currentImage) {
      newMsg.type = 'image';
      newMsg.imageUrl = currentImage;
      newMsg.text = currentInput; // Optional caption
    } else if (pendingFile) {
      newMsg.type = 'file';
      newMsg.fileName = pendingFile.name;
    }

    const currentActiveMessages = messages.filter(m => m.chatId === activeChatId && m.user === currentUser);
    
    setMessages(prev => [...prev, newMsg]);
    setInputText('');
    setPendingFile(null);
    setPendingImageUrl(null);
    setIsLoading(true);

    // Format history for Gemini API
    const formattedHistory = currentActiveMessages.slice(-6).map(m => ({
      role: m.sender === 'user' ? 'user' : 'model',
      parts: [{ text: m.text || (m.type === 'image' ? '[User sent an image]' : '[User sent a file]') }]
    }));

    // Call Target Brain
    let bmoResponseText = "BMO COMPUTES COMMAND.";
    if (activeBrain === 'gemini') {
      bmoResponseText = await fetchGemini(currentInput, currentImage, formattedHistory);
    } else {
      setFace('O_O');
      const result = await sendOpenClawCommand(currentInput, currentActiveMessages.slice(-6), currentImage);
      if (result) {
        bmoResponseText = result;
      } else {
        bmoResponseText = "BMO is thinking very hard or cannot reach OpenClaw. Please check the local connection! ^_^;";
      }
    }

    setIsLoading(false);
    setIsHappy(true);
    
    const bmoMsgId = Date.now() + 1;
    const bmoMsg = {
      id: bmoMsgId,
      chatId: activeChatId,
      user: currentUser,
      sender: 'bmo',
      type: 'text',
      text: bmoResponseText
    };
    
    setMessages(prev => [...prev, bmoMsg]);

    // Only speak if the response is not a tool call JSON
    if (!parseToolCall(bmoResponseText)) {
      setSpeakingMsgId(bmoMsgId);
      tts.speak(bmoResponseText, () => setSpeakingMsgId(null));
    }

    setTimeout(() => setIsHappy(false), 2000);
  };

  const deleteLastMessage = () => {
    setMessages(prev => {
      const activeMessages = prev.filter(m => m.chatId === activeChatId && m.user === currentUser);
      if (activeMessages.length === 0) return prev;
      const lastMsgId = activeMessages[activeMessages.length - 1].id;
      return prev.filter(m => m.id !== lastMsgId);
    });
  };

  const generateAdventure = async () => {
    if (!isAuthenticated || isLoading) return;
    setIsLoading(true);
    
    const prompt = "Generate a short, fun, 2-sentence Adventure Time style quest for us to go on today! Include ✨ emojis.";
    const bmoResponseText = await fetchGemini(prompt, null, []);
    
    setIsLoading(false);
    setIsHappy(true);
    
    const bmoMsgId = Date.now();
    const bmoMsg = {
      id: bmoMsgId,
      chatId: activeChatId,
      user: currentUser,
      sender: 'bmo',
      type: 'text',
      text: bmoResponseText
    };
    setMessages(prev => [...prev, bmoMsg]);

    if (!parseToolCall(bmoResponseText)) {
      setSpeakingMsgId(bmoMsgId);
      tts.speak(bmoResponseText, () => setSpeakingMsgId(null));
    }

    setTimeout(() => setIsHappy(false), 2000);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.type.startsWith('image/')) {
        setIsEncoding(true);
        const reader = new FileReader();
        reader.onloadend = () => {
          setPendingImageUrl(reader.result); // Base64 data URL for vision payload
          setPendingFile(null);
          setIsEncoding(false);
          setIsEating(true); // TRIGGER EATING
        };
        reader.onerror = () => setIsEncoding(false);
        reader.readAsDataURL(file);
      } else {
        setPendingFile(file);
        setPendingImageUrl(null);
        setIsEating(true); // TRIGGER EATING
      }
    }
    e.target.value = null;
  };

  // --- Keyboard Support for Send ---
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isAuthenticated) {
        handleSend();
      } else {
        handleAuth(e);
      }
    }
  };

  const activeMessages = messages.filter(m => m.chatId === activeChatId && m.user === currentUser);
  const activeHistory = history.filter(h => h.user === currentUser);

  const onStopTTS = () => {
    tts.stop();
    setSpeakingMsgId(null);
    // Emit SIGINT to backend via a temporary WebSocket or shared state
    // For this pass, we'll just log it. (In Loop 5, this will be wired to the main WS)
    console.log("PTT Triggered: Emitting SIGINT signal");
  };

  return (
    <>
      <style>{fontStyle}</style>
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-2 sm:p-4 font-sans selection:bg-[#2d482e] selection:text-[#b5d6a7]">
        
        {/* Responsive Dual Pane Container */}
        <div className="w-full max-w-md lg:max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-6 items-start h-[95vh]">
          
          {/* LEFT PANE: BMO Body */}
          <div className="bg-[#5acbb5] w-full h-full rounded-[40px] shadow-[inset_0_-10px_20px_rgba(0,0,0,0.2),0_15px_30px_rgba(0,0,0,0.5)] flex flex-col p-3 sm:p-5 relative overflow-hidden border-8 border-[#4ba896]">
            
            {/* Top Vents */}
            <div className="flex justify-center mb-3">
              <div className="w-16 h-2 bg-[#2d482e] rounded-full opacity-50"></div>
            </div>

            {/* Screen Bezel (Expanded to maximize screen) */}
            <div className="bg-[#1a2e1d] rounded-[24px] p-3 flex-1 flex flex-col relative shadow-[inset_0_4px_10px_rgba(0,0,0,0.6)] overflow-hidden">
              
              {/* Actual Screen - Tighter green color */}
              <div className="bg-[#b5d6a7] w-full h-full rounded-[12px] flex flex-col overflow-hidden relative border-4 border-[#2d482e] bmo-font text-[10px] sm:text-xs">
                
                {/* Header */}
                <header className="border-b-4 border-[#2d482e] p-2 sm:p-3 flex justify-between items-center bg-[#9fc28e] z-10 relative">
                  <button 
                    type="button"
                    onClick={() => setIsMenuOpen(true)}
                    className="text-[#2d482e] hover:text-[#007aff] transition-colors"
                  >
                    <Menu size={20} strokeWidth={3} />
                  </button>
                  <div className="text-lg sm:text-xl font-bold tracking-widest text-[#2d482e]">
                    {face}
                  </div>
                  <div className="w-5"></div>
                </header>

                {/* MAIN SCREEN CONTENT */}
                <div className="flex-1 overflow-hidden flex flex-col relative">
                  
                  {isServerSleeping ? (
                    /* --- ASLEEP / NO TAILSCALE STATE --- */
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#2d482e]">
                      <div className="text-4xl mb-4">z_z</div>
                      <p className="mb-2 leading-relaxed">ASLEEP...</p>
                      <p className="mb-6 opacity-70 text-[8px] leading-relaxed">NO TAILSCALE DETECTED.<br/>CHECK VPN CONNECTION.</p>
                      <button
                        onClick={retryConnection}
                        className="px-4 py-2 bg-[#007aff] text-white border-2 border-[#2d482e] rounded shadow-[2px_2px_0_#2d482e] hover:translate-y-[2px] hover:shadow-none transition-all"
                      >
                        RETRY CONNECTION
                      </button>
                    </div>
                  ) : !isAuthenticated ? (
                    /* --- LOCK SCREEN --- */
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#2d482e]">
                      <Lock size={48} className="mb-4 opacity-80" strokeWidth={2} />
                      <h2 className="mb-6 leading-relaxed">SECURE CONNECTION:<br/>{currentUser.toUpperCase()}</h2>
                      <div className="w-full max-w-[200px]">
                        <input 
                          type="password"
                          value={pinInput}
                          onChange={(e) => setPinInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAuth(e)}
                          placeholder="ENTER PIN"
                          className="w-full bg-[#9fc28e] border-2 border-[#2d482e] text-[#2d482e] p-3 rounded text-center placeholder:text-[#2d482e] placeholder:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#007aff] mb-4"
                        />
                      </div>
                    </div>
                  ) : (
                    /* --- CHAT VIEW --- */
                    <>
                      <ChatFeed 
                        messages={activeMessages}
                        currentUser={currentUser}
                        activeChatId={activeChatId}
                        useCrtFilter={useCrtFilter}
                        tts={tts}
                        speakingMsgId={speakingMsgId}
                        setSpeakingMsgId={setSpeakingMsgId}
                        getApiUrl={getApiUrl}
                        getApiToken={getApiToken}
                      />
                      {isLoading && (
                        <div className="self-start p-3 rounded-lg border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] bg-[#7ba068] text-white animate-pulse mx-3 mb-2">
                          ...
                        </div>
                      )}
                      <div ref={messagesEndRef} />

                      {/* Encoding indicator (Obj 3) */}

                      {isEncoding && (
                        <div className="px-3 py-2 bg-[#2d482e] text-[#b5d6a7] text-[8px] text-center animate-pulse border-t-2 border-[#2d482e]">
                          [ENCODING OPTICAL DATA...]
                        </div>
                      )}

                      {/* Pending Attachment Indicator */}
                      {!isEncoding && (pendingFile || pendingImageUrl) && (
                        <div className="px-3 py-2 bg-[#9fc28e] border-t-2 border-[#2d482e] flex items-center justify-between">
                           <div className="flex items-center gap-2 text-[#2d482e] text-[8px]">
                             {pendingImageUrl ? <ImageIcon size={12} /> : <FileIcon size={12} />}
                             <span className="truncate max-w-[120px]">
                               {pendingImageUrl ? 'IMAGE READY' : pendingFile.name}
                             </span>
                           </div>
                           <button 
                             onClick={() => { setPendingFile(null); setPendingImageUrl(null); }} 
                             className="text-[#ff3b30]"
                           >
                             <X size={14} strokeWidth={3}/>
                           </button>
                        </div>
                      )}

                      {/* Input Area (Text Only Now - Buttons Moved to Hardware) */}
                      <div className="border-t-4 border-[#2d482e] bg-[#9fc28e] p-2">
                        <textarea
                          value={inputText}
                          onChange={(e) => setInputText(e.target.value)}
                          onKeyDown={handleKeyDown}
                          placeholder="> TYPE..."
                          className="w-full bg-[#b5d6a7] border-2 border-[#2d482e] text-[#2d482e] p-2 rounded resize-none placeholder:text-[#2d482e] placeholder:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#007aff]"
                          rows={2}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Slide-out Menu Overlay */}
                {isMenuOpen && (
                  <div className="absolute inset-0 bg-[#2d482e]/90 z-20 flex">
                    <div className="w-[85%] max-w-[250px] bg-[#b5d6a7] h-full border-r-4 border-[#2d482e] flex flex-col shadow-[5px_0_15px_rgba(0,0,0,0.5)]">
                      
                      <div className="p-3 border-b-4 border-[#2d482e] flex justify-between items-center bg-[#9fc28e]">
                        <span className="font-bold text-[#2d482e]">SYSTEM</span>
                        <button onClick={() => setIsMenuOpen(false)} className="text-[#ff3b30]">
                          <X size={20} strokeWidth={3} />
                        </button>
                      </div>

                      {/* Settings Toggle */}
                      <div className="p-3 border-b-4 border-[#2d482e] bg-[#cbe3c0]">
                         <div className="text-[8px] text-[#2d482e] mb-2 font-bold">SYSTEM PREFERENCES</div>
                         
                         <button 
                            onClick={() => setUseCrtFilter(!useCrtFilter)}
                            className={`w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] transition-colors ${
                              useCrtFilter ? 'bg-[#7ba068] text-white' : 'bg-gray-300 text-black'
                            }`}
                          >
                            BMO VISION: {useCrtFilter ? 'ON' : 'OFF'}
                          </button>

                          <button 
                            onClick={() => setActiveBrain('gemini')}
                            className={`w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] transition-colors ${
                              activeBrain === 'gemini' ? 'bg-[#007aff] text-white shadow-[2px_2px_0_#2d482e]' : 'bg-[#b5d6a7] text-[#2d482e] hover:bg-[#9fc28e]'
                            }`}
                          >
                            🧠 GEM BMO (Cloud)
                          </button>
                          
                          <button 
                            onClick={() => setActiveBrain('openclaw')}
                            className={`w-full p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] transition-colors ${
                              activeBrain === 'openclaw' ? 'bg-[#ff3b30] text-white shadow-[2px_2px_0_#2d482e]' : 'bg-[#b5d6a7] text-[#2d482e] hover:bg-[#9fc28e]'
                            }`}
                          >
                            🤖 LOCAL BMO (OpenClaw)
                          </button>
                      </div>

                      {/* Profile Toggle (Multi-Tenant) */}
                      <div className="p-3 border-b-4 border-[#2d482e] bg-[#7ba068]">
                        <div className="text-[8px] text-white mb-2 flex items-center justify-between font-bold">
                          <div className="flex items-center gap-2"><User size={12} /> ACCOUNTS</div>
                          <button 
                            type="button"
                            onClick={() => { setIsAuthenticated(false); localStorage.removeItem('bmo_authenticated'); }}
                            className="bg-[#ff3b30] px-1 rounded text-[6px] border border-[#2d482e]"
                          >LOGOUT</button>
                        </div>
                        <div className="flex flex-col gap-2 text-xs">
                          {Object.keys(USERS).map(user => (
                            <button
                              key={user}
                              type="button"
                              onClick={() => handleUserToggle(user)}
                              className={`p-2 rounded border-2 border-[#2d482e] text-left transition-colors ${
                                currentUser === user 
                                  ? 'bg-[#007aff] text-white shadow-[2px_2px_0_#2d482e]' 
                                  : 'bg-[#b5d6a7] text-[#2d482e] hover:bg-[#9fc28e]'
                              }`}
                            >
                              {user.toUpperCase()} {currentUser === user && isAuthenticated ? '(UNLOCKED)' : ''}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Chat History */}
                      {isAuthenticated && (
                        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                          <button 
                            type="button"
                            onClick={() => handleNewChat()}
                            className="w-full p-3 bg-[#ff3b30] text-white border-2 border-[#2d482e] rounded shadow-[2px_2px_0_#2d482e] flex items-center justify-center gap-2 hover:translate-y-[2px] hover:shadow-none transition-all mb-2"
                          >
                            <Plus size={16} strokeWidth={3} /> NEW CHAT
                          </button>

                          <div className="text-[8px] text-[#2d482e] mb-1 mt-2">HISTORY</div>
                          {activeHistory.map(chat => (
                            <button
                              key={chat.id}
                              type="button"
                              onClick={() => { setActiveChatId(chat.id); setIsMenuOpen(false); }}
                              className={`p-3 border-2 border-[#2d482e] rounded text-left truncate text-[8px] sm:text-[10px] transition-colors ${
                                activeChatId === chat.id 
                                  ? 'bg-[#9fc28e] text-[#2d482e]' 
                                  : 'bg-[#cbe3c0] text-[#2d482e] hover:bg-[#b5d6a7]'
                              }`}
                            >
                              {'>'} {chat.title}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 cursor-pointer" onClick={() => setIsMenuOpen(false)}></div>
                  </div>
                )}
              </div>
            </div>

            {/* Hidden Inputs triggered by Physical Buttons */}
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              onChange={handleFileSelect}
            />
            <input 
              type="file" 
              accept="image/*"
              capture="environment"
              ref={cameraInputRef} 
              className="hidden" 
              onChange={handleFileSelect}
            />

            {/* BMO Physical Buttons (Now Functional!) */}
            <HardwareControls 
              onSend={handleSend}
              onUploadFile={() => fileInputRef.current?.click()}
              onOpenCamera={() => cameraInputRef.current?.click()}
              onDeleteLast={deleteLastMessage}
              onStopTTS={() => { tts.stop(); setSpeakingMsgId(null); }}
            />
          </div>

          {/* RIGHT PANE: Telemetry Dashboard & Controls */}
          <div className="hidden lg:flex flex-col h-full overflow-hidden gap-4">
            
            {/* Dashboard Tabs */}
            <div className="flex gap-2 p-1 bg-[#2d482e] rounded-lg">
              <button
                type="button"
                onClick={() => setActiveDashboardTab('telemetry')}
                className={`flex-1 py-2 text-[10px] bmo-font rounded transition-all ${
                  activeDashboardTab === 'telemetry' ? 'bg-[#b5d6a7] text-[#2d482e]' : 'text-[#b5d6a7] hover:bg-[#1a2e1d]'
                }`}
              >TELEMETRY</button>
              <button
                type="button"
                onClick={() => setActiveDashboardTab('editor')}
                className={`flex-1 py-2 text-[10px] bmo-font rounded transition-all ${
                  activeDashboardTab === 'editor' ? 'bg-[#ffcc00] text-[#2d482e]' : 'text-[#b5d6a7] hover:bg-[#1a2e1d]'
                }`}
              >BRAIN_EDITOR</button>
            </div>

            <div className="flex-[2] min-h-0">
              {activeDashboardTab === 'telemetry' ? (
                <TelemetryTerminal />
              ) : (
                <WorkspaceEditor />
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <Settings 
                threshold={threshold} 
                setThreshold={setThreshold} 
                safetyStride={safetyStride} 
                setSafetyStride={setSafetyStride} 
                isDreaming={isDreaming}
                setIsDreaming={setIsDreaming}
              />
              
              <Playbook onRunMacro={(prompt) => {
                setInputText(prompt);
                // We could auto-send here too if preferred
              }} />

              {/* Legend / Info below terminal */}
              <div className="mt-4 p-4 bg-[#b5d6a7] border-4 border-[#2d482e] rounded-[12px] bmo-font text-[#2d482e] text-[8px]">
                <div className="flex justify-between items-center">
                  <span>SYSTEM STATUS: OPERATIONAL</span>
                  <span>PIXEL_FOLD_V2</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
