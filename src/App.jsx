import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, Plus, User, X, File as FileIcon, Lock, Image as ImageIcon, Sparkles, Terminal, Volume2 } from 'lucide-react';
import TelemetryTerminal from './components/TelemetryTerminal';
import ChatFeed from './components/ChatFeed';
import HardwareControls from './components/HardwareControls';
import Settings from './components/Settings';
import Playbook from './components/Playbook';
import WorkspaceEditor from './components/WorkspaceEditor';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

// --- Native TTS Hook ---
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
    
    // ANDROID FIX: Ensure we have an active utterance
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = 1.4;
    utterance.rate = 1.0;
    utterance.volume = 1.0;
    
    const voice = getBmoVoice();
    if (voice) utterance.voice = voice;
    
    utterance.onstart = () => { console.log("TTS_DEBUG: Started"); setIsSpeaking(true); setIsPaused(false); };
    utterance.onend = () => { console.log("TTS_DEBUG: Ended"); setIsSpeaking(false); setIsPaused(false); onEnd?.(); };
    utterance.onerror = (e) => { console.error("TTS_DEBUG: Error", e); setIsSpeaking(false); setIsPaused(false); onEnd?.(); };
    
    window.speechSynthesis.speak(utterance);
  }, [getBmoVoice]);

  const stop = useCallback(() => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  return { isSpeaking, isPaused, speak, stop };
};

const fontStyle = `
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Gaegu:wght@700&display=swap');
  .bmo-font { font-family: 'Press Start 2P', cursive; line-height: 1.4; }
  .label-font { font-family: 'Gaegu', cursive; color: #2d482e; font-weight: 900; font-size: 10px; opacity: 0.8; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #b5d6a7; border-left: 1px solid #2d482e; }
  ::-webkit-scrollbar-thumb { background: #2d482e; }
  .bmo-vision { filter: sepia(1) hue-rotate(75deg) saturate(3) contrast(1.4) brightness(0.9); mix-blend-mode: hard-light; border: 2px solid #2d482e; border-radius: 4px; }
  .real-vision { border: 2px solid #2d482e; border-radius: 4px; }
`;

const USERS = { Anthony: { pin: '1234' }, Kayla: { pin: '4321' } };

const parseToolCall = (text) => {
  if (!text || typeof text !== 'string' || !text.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.tool === 'string') return { tool: parsed.tool, action: parsed.action || null };
  } catch { }
  return null;
};

const getApiUrl = () => {
  const envUrl = import.meta.env.VITE_OPENCLAW_API_URL;
  const isCapacitor = typeof window !== 'undefined' && !!window.Capacitor;
  const isDesktopLocal = typeof window !== 'undefined' && !window.Capacitor && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  if (isDesktopLocal) return "http://localhost:18789";
  return envUrl ? envUrl.replace(/\/$/, "") : "http://100.84.254.37:18789";
};

const getApiToken = () => import.meta.env.VITE_OPENCLAW_API_KEY || "bmo-secret-key-2026";

const sendOpenClawCommand = async (command, history = [], image = null, model = "moondream") => {
  const apiUrl = getApiUrl();
  const apiToken = getApiToken();
  const normalizedCommand = typeof command === 'string' ? command.trim() : '';
  const resolvedCommand = normalizedCommand || (image ? "Please analyze the attached image." : "Please help with my request.");
  const userContent = image ? [{ type: "text", text: resolvedCommand }, { type: "image_url", image_url: { url: image } }] : resolvedCommand;
  const messages = [...history.map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text || (m.type === 'image' ? '[User sent an image]' : '[User sent a file]') })), { role: 'user', content: userContent }];
  try {
    const response = await fetch(`${apiUrl}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiToken}` }, body: JSON.stringify({ model, messages }) });
    if (!response.ok) throw new Error("Proxy failed");
    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) { console.error("OpenClaw failed:", error); return null; }
};

export default function App() {
  const [currentUser, setCurrentUser] = useState('Anthony');
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('bmo_authenticated') === 'true');
  const [isServerSleeping, setIsServerSleeping] = useState(false);
  
  useEffect(() => { localStorage.setItem('bmo_authenticated', isAuthenticated); }, [isAuthenticated]);
  
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('bmo_messages');
    return saved ? JSON.parse(saved) : [];
  });
  useEffect(() => { localStorage.setItem('bmo_messages', JSON.stringify(messages)); }, [messages]);

  const [inputText, setInputText] = useState(() => localStorage.getItem('bmo_input_buffer') || '');
  useEffect(() => { localStorage.setItem('bmo_input_buffer', inputText); }, [inputText]);

  const [history, setHistory] = useState([]);
  const [activeChatId, setActiveChatId] = useState(() => {
    const saved = localStorage.getItem('bmo_active_chat_id');
    return saved ? parseInt(saved) : null;
  });
  useEffect(() => { if (activeChatId) localStorage.setItem('bmo_active_chat_id', activeChatId); }, [activeChatId]);

  const [isLoading, setIsLoading] = useState(false);
  const [isEncoding, setIsEncoding] = useState(false);
  const [isHappy, setIsHappy] = useState(false);
  const [isEating, setIsEating] = useState(false);
  const [face, setFace] = useState('^_^');
  
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingImageUrl, setPendingImageUrl] = useState(null);
  const [useCrtFilter, setUseCrtFilter] = useState(true);
  const [activeBrain, setActiveBrain] = useState('openclaw');
  const [speakingMsgId, setSpeakingMsgId] = useState(null);

  // PERSISTENCE: Model Selector
  const [activeModel, setActiveModel] = useState(() => localStorage.getItem('bmo_active_model') || 'moondream');
  useEffect(() => { localStorage.setItem('bmo_active_model', activeModel); }, [activeModel]);

  const [safetyStride, setSafetyStride] = useState(true);
  const [isDreaming, setIsDreaming] = useState(false);
  const [activeDashboardTab, setActiveDashboardTab] = useState('telemetry');
  const [isTerminalOverlayOpen, setIsTerminalOverlayOpen] = useState(false);
  const [isDashboardOverlayOpen, setIsDashboardOverlayOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const tts = useNativeTTS();

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
    if (isLoading) { setFace('O_O'); return; }
    if (isHappy) { setFace('\\o/'); return; }
    if (isEating) { setFace('>_<'); const sw = setTimeout(() => setFace('~_~'), 500); const fi = setTimeout(() => setIsEating(false), 1500); return () => { clearTimeout(sw); clearTimeout(fi); }; }
    setFace('^_^');
    const blink = setInterval(() => { setFace('-_-'); setTimeout(() => setFace(p => p === '-_-' ? '^_^' : p), 200); }, 4000 + Math.random() * 2000);
    return () => clearInterval(blink);
  }, [isLoading, isHappy, isEating]);

  const messagesEndRef = useRef(null);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, currentUser, activeChatId, isAuthenticated]);

  const handleUserToggle = (user) => { 
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
      const response = await fetch(`${apiUrl}/v1/chat/history`, { headers: { "Authorization": `Bearer ${apiToken}` } });
      if (response.ok) {
        const data = await response.json();
        setHistory(data.chats || []);
        if (messages.length === 0) setMessages(data.messages || []);
        const userChats = (data.chats || []).filter(h => h.user === user);
        let rid = activeChatId || (userChats.length > 0 ? userChats[0].id : 1);
        setActiveChatId(rid); setIsAuthenticated(true); setIsServerSleeping(false);
      } else { setIsAuthenticated(true); setIsServerSleeping(false); if (!activeChatId) setActiveChatId(1); }
    } catch (e) { console.error("Handshake failed:", e); setIsServerSleeping(true); if (history.length === 0) { const fid = 1; setHistory([{ id: fid, user: user, title: 'OFFLINE_MODE' }]); setActiveChatId(fid); } }
  };

  const handleAuth = async (e) => { if (e) { e.preventDefault(); e.stopPropagation(); } if (pinInput !== USERS[currentUser].pin) { alert("INCORRECT PIN."); setPinInput(''); return; } setPinInput(''); await performServerHandshake(currentUser); };

  const retryConnection = async () => { setIsServerSleeping(false); await performServerHandshake(currentUser); };

  const handleNewChat = (userOverride = null) => {
    const user = userOverride || currentUser;
    const newId = Math.max(0, ...history.map(h => h.id)) + 1;
    setHistory([{ id: newId, user: user, title: 'NEW SESSION' }, ...history]);
    setActiveChatId(newId);
    setMessages([{ id: Date.now(), chatId: newId, user: user, sender: 'bmo', type: 'text', text: `GREETINGS ${user.toUpperCase()}.` }]);
    setIsMenuOpen(false);
  };

  const handleSend = async () => {
    if (!isAuthenticated || isLoading) return;
    if (!inputText.trim() && !pendingFile && !pendingImageUrl) return;
    const currentInput = inputText; const currentImage = pendingImageUrl;
    let newMsg = { id: Date.now(), chatId: activeChatId, user: currentUser, sender: 'user', text: currentInput, type: 'text' };
    if (currentImage) { newMsg.type = 'image'; newMsg.imageUrl = currentImage; newMsg.text = currentInput; } else if (pendingFile) { newMsg.type = 'file'; newMsg.fileName = pendingFile.name; }
    const currentActiveMessages = messages.filter(m => m.chatId === activeChatId && m.user === currentUser);
    setMessages(prev => [...prev, newMsg]); setInputText(''); setPendingFile(null); setPendingImageUrl(null); setIsLoading(true);
    const formattedHistory = currentActiveMessages.slice(-6).map(m => ({ role: m.sender === 'user' ? 'user' : 'model', parts: [{ text: m.text || (m.type === 'image' ? '[User sent an image]' : '[User sent a file]') }] }));
    let bmoResponseText = "BMO COMPUTES COMMAND.";
    if (activeBrain === 'gemini') { bmoResponseText = await fetchGemini(currentInput, currentImage, formattedHistory); }
    else { setFace('O_O'); const result = await sendOpenClawCommand(currentInput, currentActiveMessages.slice(-6), currentImage, activeModel); bmoResponseText = result || "BMO is thinking very hard or cannot reach OpenClaw. Please check the local connection! ^_^;"; }
    setIsLoading(false); setIsHappy(true);
    const bmoMsgId = Date.now() + 1;
    const bmoMsg = { id: bmoMsgId, chatId: activeChatId, user: currentUser, sender: 'bmo', type: 'text', text: bmoResponseText };
    setMessages(prev => [...prev, bmoMsg]);
    if (!parseToolCall(bmoResponseText)) { setSpeakingMsgId(bmoMsgId); tts.speak(bmoResponseText, () => setSpeakingMsgId(null)); }
    setTimeout(() => setIsHappy(false), 2000);
  };

  const deleteLastMessage = () => { setMessages(prev => { const am = prev.filter(m => m.chatId === activeChatId && m.user === currentUser); if (am.length === 0) return prev; const lm = am[am.length - 1].id; return prev.filter(m => m.id !== lm); }); };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.type.startsWith('image/')) {
        setIsEncoding(true); const reader = new FileReader();
        reader.onloadend = () => { setPendingImageUrl(reader.result); setPendingFile(null); setIsEncoding(false); setIsEating(true); };
        reader.onerror = () => setIsEncoding(false); reader.readAsDataURL(file);
      } else { setPendingFile(file); setPendingImageUrl(null); setIsEating(true); }
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
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-2 sm:p-4 font-sans selection:bg-[#2d482e] selection:text-[#b5d6a7]">
        <div className="w-full max-w-md lg:max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-6 items-start h-[95vh]">
          {/* BMO LEFT PANE */}
          <div className="bg-[#5acbb5] w-full h-full rounded-[40px] shadow-[inset_0_-10px_20px_rgba(0,0,0,0.2),0_15px_30px_rgba(0,0,0,0.5)] flex flex-col p-3 sm:p-5 relative overflow-hidden border-8 border-[#4ba896]">
            <div className="flex justify-center mb-3"><div className="w-16 h-2 bg-[#2d482e] rounded-full opacity-50"></div></div>
            <div className={`bg-[#1a2e1d] rounded-[24px] p-3 flex-1 flex flex-col relative shadow-[inset_0_4px_10px_rgba(0,0,0,0.6)] overflow-hidden`}>
              <div className="bg-[#b5d6a7] w-full h-full rounded-[12px] flex flex-col overflow-hidden relative border-4 border-[#2d482e] bmo-font text-[10px] sm:text-xs">
                <header className="border-b-4 border-[#2d482e] p-2 sm:p-3 flex justify-between items-center bg-[#9fc28e] z-10 relative">
                  <button type="button" onClick={() => setIsMenuOpen(true)} className="text-[#2d482e] hover:text-[#007aff] transition-colors"><Menu size={20} strokeWidth={3} /></button>
                  <div className="text-lg sm:text-xl font-bold tracking-widest text-[#2d482e]">{face}</div>
                  <div className="w-5"></div>
                </header>
                <div className="flex-1 overflow-hidden flex flex-col relative">
                  {isServerSleeping ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#2d482e]">
                      <div className="text-4xl mb-4">z_z</div><p className="mb-2">ASLEEP...</p>
                      <button type="button" onClick={retryConnection} className="px-4 py-2 bg-[#007aff] text-white border-2 border-[#2d482e] rounded shadow-[2px_2px_0_#2d482e] hover:translate-y-[2px] transition-all">RETRY</button>
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
                      {isLoading && <div className="self-start p-3 rounded-lg border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] bg-[#7ba068] text-white animate-pulse mx-3 mb-2">...</div>}
                      <div ref={messagesEndRef} />
                      {isEncoding && <div className="px-3 py-2 bg-[#2d482e] text-[#b5d6a7] text-[8px] text-center animate-pulse border-t-2 border-[#2d482e]">[ENCODING OPTICAL DATA...]</div>}
                      {!isEncoding && (pendingFile || pendingImageUrl) && (
                        <div className="px-3 py-2 bg-[#9fc28e] border-t-2 border-[#2d482e] flex items-center justify-between text-[8px]">
                           <div className="flex items-center gap-2 text-[#2d482e]">{pendingImageUrl ? <ImageIcon size={12} /> : <FileIcon size={12} />}<span className="truncate max-w-[120px]">{pendingImageUrl ? 'IMAGE READY' : pendingFile.name}</span></div>
                           <button type="button" onClick={() => { setPendingFile(null); setPendingImageUrl(null); }} className="text-[#ff3b30]"><X size={14} /></button>
                        </div>
                      )}
                      <div className="border-t-4 border-[#2d482e] bg-[#9fc28e] p-2">
                        <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={handleKeyDown} placeholder="> TYPE..." className="w-full bg-[#b5d6a7] border-2 border-[#2d482e] text-[#2d482e] p-2 rounded resize-none focus:outline-none" rows={2} />
                      </div>
                    </>
                  )}
                </div>
                {isMenuOpen && (
                  <div className="absolute inset-0 bg-[#2d482e]/90 z-20 flex animate-in fade-in duration-200">
                    <div className="w-[85%] max-w-[250px] bg-[#b5d6a7] h-full border-r-4 border-[#2d482e] flex flex-col shadow-[5px_0_15px_rgba(0,0,0,0.5)]">
                      <div className="p-3 border-b-4 border-[#2d482e] flex justify-between items-center bg-[#9fc28e]"><span className="font-bold text-[#2d482e]">SYSTEM</span><button type="button" onClick={() => setIsMenuOpen(false)} className="text-[#ff3b30]"><X size={20} /></button></div>
                      <div className="p-3 border-b-4 border-[#2d482e] bg-[#cbe3c0] overflow-y-auto">
                         <div className="text-[8px] text-[#2d482e] mb-2 font-bold uppercase tracking-widest">Preferences</div>
                         <button type="button" onClick={() => { tts.speak("BMO IS AWAKE!"); setIsMenuOpen(false); }} className="w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] bg-[#007aff] text-white flex items-center justify-center gap-2">🔊 WAKE AUDIO</button>
                         <button type="button" onClick={() => { tts.speak("HEARTBEAT OK"); }} className="w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] bg-purple-600 text-white flex items-center justify-center gap-2">🩺 DEBUG AUDIO</button>
                         <button type="button" onClick={() => { setIsDashboardOverlayOpen(true); setIsMenuOpen(false); }} className="w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] bg-[#ffcc00] text-[#2d482e] flex items-center justify-center gap-2 font-bold">🎮 BMO DASHBOARD</button>
                         <button type="button" onClick={() => { setIsTerminalOverlayOpen(true); setIsMenuOpen(false); }} className="w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] bg-[#2d482e] text-[#b5d6a7] flex items-center justify-center gap-2 font-bold">📟 SYSTEM TERMINAL</button>
                         <button type="button" onClick={() => setUseCrtFilter(!useCrtFilter)} className={`w-full mb-2 p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] ${useCrtFilter ? 'bg-[#7ba068] text-white' : 'bg-gray-300 text-black'}`}>BMO VISION: {useCrtFilter ? 'ON' : 'OFF'}</button>
                         <button type="button" onClick={() => setActiveBrain('openclaw')} className={`w-full p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] ${activeBrain === 'openclaw' ? 'bg-[#ff3b30] text-white' : 'bg-[#b5d6a7]'}`}>🤖 LOCAL BMO</button>
                      </div>
                      <div className="p-3 border-b-4 border-[#2d482e] bg-[#7ba068]">
                        <div className="text-[8px] text-white mb-2 flex items-center justify-between font-bold uppercase">Accounts</div>
                        <div className="flex flex-col gap-2 text-xs">
                          {Object.keys(USERS).map(user => (
                            <button key={user} type="button" onClick={() => handleUserToggle(user)} className={`p-2 rounded border-2 border-[#2d482e] text-left ${currentUser === user ? 'bg-[#007aff] text-white' : 'bg-[#b5d6a7]'}`}>{user.toUpperCase()}</button>
                          ))}
                        </div>
                      </div>
                      {isAuthenticated && (
                        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                          <button type="button" onClick={() => handleNewChat()} className="w-full p-3 bg-[#ff3b30] text-white border-2 border-[#2d482e] rounded shadow-[2px_2px_0_#2d482e] flex items-center justify-center gap-2 mb-2 font-bold"><Plus size={16} /> NEW CHAT</button>
                          {activeHistory.map(chat => (
                            <button key={chat.id} type="button" onClick={() => { setActiveChatId(chat.id); setIsMenuOpen(false); }} className={`p-3 border-2 border-[#2d482e] rounded text-left truncate text-[8px] sm:text-[10px] ${activeChatId === chat.id ? 'bg-[#9fc28e]' : 'bg-[#cbe3c0]'}`}>{'>'} {chat.title}</button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 cursor-pointer" onClick={() => setIsMenuOpen(false)}></div>
                  </div>
                )}
              </div>
            </div>
            {/* LABELS & HARDWARE */}
            <div className="h-28 mt-4 flex justify-between items-center px-2 sm:px-6 relative">
               <div className="absolute -top-4 left-6 label-font transform -rotate-12 pointer-events-none text-black">UPLOAD</div>
               <div className="absolute -top-4 left-1/2 -translate-x-1/2 label-font pointer-events-none text-black">PTT</div>
               <div className="absolute -top-4 right-10 label-font transform rotate-12 pointer-events-none text-black">SEND</div>
               <HardwareControls onSend={handleSend} onUploadFile={() => fileInputRef.current?.click()} onOpenCamera={() => cameraInputRef.current?.click()} onDeleteLast={deleteLastMessage} onStopTTS={onStopTTS} />
               <div className="absolute bottom-2 right-12 label-font transform rotate-12 pointer-events-none text-black">ACTION</div>
            </div>
          </div>
          {/* DASHBOARD RIGHT PANE (Desktop Only) */}
          <div className="hidden lg:flex flex-col h-full overflow-hidden gap-4">
            <div className="flex gap-2 p-1 bg-[#2d482e] rounded-lg">
              <button type="button" onClick={() => setActiveDashboardTab('telemetry')} className={`flex-1 py-2 text-[10px] bmo-font rounded transition-all ${activeDashboardTab === 'telemetry' ? 'bg-[#b5d6a7] text-[#2d482e]' : 'text-[#b5d6a7]'}`}>TELEMETRY</button>
              <button type="button" onClick={() => setActiveDashboardTab('editor')} className={`flex-1 py-2 text-[10px] bmo-font rounded transition-all ${activeDashboardTab === 'editor' ? 'bg-[#ffcc00] text-[#2d482e]' : 'text-[#b5d6a7]'}`}>BRAIN_EDITOR</button>
            </div>
            <div className="flex-[2] min-h-0">{activeDashboardTab === 'telemetry' ? <TelemetryTerminal /> : <WorkspaceEditor />}</div>
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <Settings activeModel={activeModel} setActiveModel={setActiveModel} safetyStride={safetyStride} setSafetyStride={setSafetyStride} isDreaming={isDreaming} setIsDreaming={setIsDreaming} />
              <Playbook onRunMacro={(prompt) => { setInputText(prompt); }} />
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
              <button type="button" onClick={() => setIsDashboardOverlayOpen(false)} className="bg-[#ff3b30] text-white px-4 py-2 rounded border-2 border-[#2d482e] bmo-font text-[10px] shadow-[2px_2px_0_#2d482e] active:translate-y-[1px]">CLOSE</button>
            </div>
            <div className="flex flex-col gap-4">
               <div className="flex gap-2 p-1 bg-[#2d482e] rounded-lg shadow-inner">
                <button type="button" onClick={() => setActiveDashboardTab('telemetry')} className={`flex-1 py-2 text-[10px] bmo-font rounded transition-all ${activeDashboardTab === 'telemetry' ? 'bg-[#b5d6a7] text-[#2d482e]' : 'text-[#b5d6a7]'}`}>TELEMETRY</button>
                <button type="button" onClick={() => setActiveDashboardTab('editor')} className={`flex-1 py-2 text-[10px] bmo-font rounded transition-all ${activeDashboardTab === 'editor' ? 'bg-[#ffcc00] text-[#2d482e]' : 'text-[#b5d6a7]'}`}>BRAIN_EDITOR</button>
              </div>
              <div className="h-[300px] border-4 border-[#2d482e] rounded-xl overflow-hidden shadow-2xl">{activeDashboardTab === 'telemetry' ? <TelemetryTerminal /> : <WorkspaceEditor />}</div>
              <Settings activeModel={activeModel} setActiveModel={setActiveModel} safetyStride={safetyStride} setSafetyStride={setSafetyStride} isDreaming={isDreaming} setIsDreaming={setIsDreaming} />
              <Playbook onRunMacro={(prompt) => { setInputText(prompt); setIsDashboardOverlayOpen(false); }} />
            </div>
          </div>
        )}
        {isTerminalOverlayOpen && (
          <div className="fixed inset-0 bg-black z-[100] flex flex-col p-4 animate-in fade-in duration-300">
            <div className="flex justify-between items-center mb-4 text-[#b5d6a7] bmo-font text-xs border-b border-[#b5d6a7] pb-2">
              <div className="flex items-center gap-2"><span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>LIVE_TELEMETRY</div>
              <button type="button" onClick={() => setIsTerminalOverlayOpen(false)} className="bg-[#ff3b30] text-white px-4 py-2 rounded border-2 border-white bmo-font text-[10px] shadow-[2px_2px_0_white] active:translate-y-[1px]">EXIT</button>
            </div>
            <div className="flex-1 overflow-hidden border-2 border-[#b5d6a7] rounded-lg shadow-inner"><TelemetryTerminal /></div>
          </div>
        )}
      </div>
    </>
  );
}
