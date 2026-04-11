import React, { useState, useEffect, useRef } from 'react';
import { Menu, Plus, User, X, File as FileIcon, Lock, Image as ImageIcon } from 'lucide-react';
import * as tts from '@mintplex-labs/piper-tts-web';

// --- Piper TTS WASM Initialization ---
tts.PATH_MAP['bmo'] = 'bmo';

// Intercept huggingface CDN to serve our local models
const originalFetch = window.fetch;
window.fetch = async (url, ...args) => {
  if (typeof url === 'string') {
    if (url === `${tts.HF_BASE}/bmo.json`) return originalFetch('./voices/bmo.onnx.json', ...args);
    if (url === `${tts.HF_BASE}/bmo`) return originalFetch('./voices/bmo.onnx', ...args);
  }
  return originalFetch(url, ...args);
};

let globalTtsSession = null;

// Force Piper to use single-threaded WASM to bypass Vite Dev Server isolation limits
const originalConcurrency = navigator.hardwareConcurrency;
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 1, configurable: true });

// Initialize Piper off the main thread silently in the background
tts.TtsSession.create({ 
  voiceId: 'bmo',
  wasmPaths: {
    onnxWasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/',
    piperData: `${tts.WASM_BASE}.data`,
    piperWasm: `${tts.WASM_BASE}.wasm`
  }
})
  .then(session => {
    globalTtsSession = session;
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => originalConcurrency, configurable: true });
  })
  .catch(err => {
    console.error("Piper WASM Initialization failed:", err);
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => originalConcurrency, configurable: true });
  });

const playBmoVoice = async (text) => {
  if (!globalTtsSession) return;
  try {
    const audioBlob = await globalTtsSession.predict(text);
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.play();
  } catch (e) {
    console.error("Piper TTS Playback failed:", e);
  }
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

// --- Mock Data & Config ---
const USERS = {
  Anthony: { pin: '1234' },
  Kayla: { pin: '4321' }
};

const MOCK_HISTORY = [
  { id: 1, user: 'Anthony', title: 'VIDEO GAMES' },
  { id: 2, user: 'Anthony', title: 'SKATEBOARDING' },
  { id: 3, user: 'Kayla', title: 'SCIENCE STUFF' },
];

const MOCK_MESSAGES = [
  { id: 1, chatId: 1, user: 'Anthony', sender: 'bmo', type: 'text', text: 'HELLO ANTHONY. I AM BMO!' },
  { id: 2, chatId: 3, user: 'Kayla', sender: 'bmo', type: 'text', text: 'BMO CHOP! JUST KIDDING, HI KAYLA.' },
];

const BMO_RESPONSES = [
  "WHO WANTS TO PLAY VIDEO GAMES?",
  "I AM NOT A TOY. I AM A LITTLE LIVING BOY.",
  "COMPUTING... YES.",
  "THAT DOES NOT COMPUTE.",
  "YAY! \\o/",
  "BMO IS PROUD OF YOU.",
];

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

export default function App() {
  const [currentUser, setCurrentUser] = useState('Anthony');
  const [isAuthenticated, setIsAuthenticated] = useState(false); // PIN lock state
  const [pinInput, setPinInput] = useState('');
  
  const [messages, setMessages] = useState(MOCK_MESSAGES);
  const [history, setHistory] = useState(MOCK_HISTORY);
  const [activeChatId, setActiveChatId] = useState(1);
  const [inputText, setInputText] = useState('');
  
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isHappy, setIsHappy] = useState(false);
  const [face, setFace] = useState('^_^');
  
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingImageUrl, setPendingImageUrl] = useState(null);
  const [useCrtFilter, setUseCrtFilter] = useState(true);

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
    setCurrentUser(user);
    setIsAuthenticated(false); // Lock the account
    setPinInput('');
    setIsMenuOpen(false);
    setPendingFile(null);
    setPendingImageUrl(null);
  };

  const handleAuth = (e) => {
    e.preventDefault();
    if (pinInput === USERS[currentUser].pin) {
      setIsAuthenticated(true);
      setPinInput('');
      
      // Auto-select first chat or create new
      const userHistory = history.filter(h => h.user === currentUser);
      if (userHistory.length > 0) {
        setActiveChatId(userHistory[0].id);
      } else {
        handleNewChat(currentUser);
      }
    } else {
      alert("INCORRECT PIN.");
      setPinInput('');
    }
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

    // Call Gemini API
    const bmoResponseText = await fetchGemini(currentInput, currentImage, formattedHistory);

    setIsLoading(false);
    setIsHappy(true);
    
    const bmoMsg = {
      id: Date.now() + 1,
      chatId: activeChatId,
      user: currentUser,
      sender: 'bmo',
      type: 'text',
      text: bmoResponseText
    };
    
    setMessages(prev => [...prev, bmoMsg]);
    playBmoVoice(bmoResponseText); // Trigger WASM local TTS
    setTimeout(() => setIsHappy(false), 2000);
  };

  const generateAdventure = async () => {
    if (!isAuthenticated || isLoading) return;
    setIsLoading(true);
    
    const prompt = "Generate a short, fun, 2-sentence Adventure Time style quest for us to go on today! Include ✨ emojis.";
    const bmoResponseText = await fetchGemini(prompt, null, []);
    
    setIsLoading(false);
    setIsHappy(true);
    
    const bmoMsg = {
      id: Date.now(),
      chatId: activeChatId,
      user: currentUser,
      sender: 'bmo',
      type: 'text',
      text: bmoResponseText
    };
    setMessages(prev => [...prev, bmoMsg]);
    playBmoVoice(bmoResponseText); // Trigger WASM local TTS
    setTimeout(() => setIsHappy(false), 2000);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setPendingImageUrl(reader.result); // Base64 string for Gemini
          setPendingFile(null);
        };
        reader.readAsDataURL(file);
      } else {
        setPendingFile(file);
        setPendingImageUrl(null);
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

  return (
    <>
      <style>{fontStyle}</style>
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-2 sm:p-4 font-sans selection:bg-[#2d482e] selection:text-[#b5d6a7]">
        
        {/* BMO Body */}
        <div className="bg-[#5acbb5] w-full max-w-md h-[95vh] min-h-[650px] rounded-[40px] shadow-[inset_0_-10px_20px_rgba(0,0,0,0.2),0_15px_30px_rgba(0,0,0,0.5)] flex flex-col p-3 sm:p-5 relative overflow-hidden border-8 border-[#4ba896]">
          
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
                
                {!isAuthenticated ? (
                  /* --- LOCK SCREEN --- */
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#2d482e]">
                    <Lock size={48} className="mb-4 opacity-80" strokeWidth={2} />
                    <h2 className="mb-6 leading-relaxed">SECURE CONNECTION:<br/>{currentUser.toUpperCase()}</h2>
                    <form onSubmit={handleAuth} className="w-full max-w-[200px]">
                      <input 
                        type="password"
                        value={pinInput}
                        onChange={(e) => setPinInput(e.target.value)}
                        placeholder="ENTER PIN"
                        className="w-full bg-[#9fc28e] border-2 border-[#2d482e] text-[#2d482e] p-3 rounded text-center placeholder:text-[#2d482e] placeholder:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#007aff] mb-4"
                      />
                      {/* Hint for demo purposes */}
                      <p className="text-[8px] opacity-60">Hint: {USERS[currentUser].pin}</p>
                    </form>
                  </div>
                ) : (
                  /* --- CHAT VIEW --- */
                  <>
                    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
                      {activeMessages.length === 0 ? (
                        <div className="text-center text-[#2d482e] opacity-50 mt-10">
                          NO MESSAGES YET.
                        </div>
                      ) : (
                        activeMessages.map((msg) => (
                          <div 
                            key={msg.id} 
                            className={`flex flex-col max-w-[85%] ${msg.sender === 'user' ? 'self-end items-end' : 'self-start items-start'}`}
                          >
                            <div 
                              className={`p-2 sm:p-3 rounded-lg border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] ${
                                msg.sender === 'user' 
                                  ? 'bg-[#cbe3c0] text-[#2d482e]' 
                                  : 'bg-[#7ba068] text-white'
                              }`}
                            >
                              {/* File Rendering */}
                              {msg.type === 'file' && (
                                <div className="flex items-center gap-2 mb-1 p-2 bg-[#b5d6a7] border border-[#2d482e] rounded text-[8px] text-[#2d482e]">
                                  <FileIcon size={12} />
                                  <span className="truncate max-w-[100px]">{msg.fileName}</span>
                                </div>
                              )}
                              
                              {/* Image Rendering */}
                              {msg.type === 'image' && (
                                <img 
                                  src={msg.imageUrl} 
                                  alt="User attachment" 
                                  className={`max-w-full h-auto mb-2 ${useCrtFilter ? 'bmo-vision' : 'real-vision'}`}
                                />
                              )}
                              
                              {msg.text && <p style={{ wordBreak: 'break-word' }}>{msg.text}</p>}
                            </div>
                            <span className="text-[8px] text-[#2d482e] mt-1 opacity-70">
                              {msg.sender === 'user' ? currentUser.toUpperCase() : 'BMO'}
                            </span>
                          </div>
                        ))
                      )}
                      {isLoading && (
                        <div className="self-start p-3 rounded-lg border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] bg-[#7ba068] text-white animate-pulse">
                          ...
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </div>

                    {/* Pending Attachment Indicator */}
                    {(pendingFile || pendingImageUrl) && (
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
                       <div className="text-[8px] text-[#2d482e] mb-2 font-bold">IMAGE RENDERER</div>
                       <button 
                          onClick={() => setUseCrtFilter(!useCrtFilter)}
                          className={`w-full p-2 text-[8px] sm:text-[10px] rounded border-2 border-[#2d482e] transition-colors ${
                            useCrtFilter ? 'bg-[#7ba068] text-white' : 'bg-gray-300 text-black'
                          }`}
                        >
                          BMO VISION: {useCrtFilter ? 'ON' : 'OFF'}
                        </button>
                    </div>

                    {/* Profile Toggle (Multi-Tenant) */}
                    <div className="p-3 border-b-4 border-[#2d482e] bg-[#7ba068]">
                      <div className="text-[8px] text-white mb-2 flex items-center gap-2 font-bold">
                        <User size={12} /> ACCOUNTS
                      </div>
                      <div className="flex flex-col gap-2 text-xs">
                        {Object.keys(USERS).map(user => (
                          <button
                            key={user}
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
                          onClick={() => handleNewChat()}
                          className="w-full p-3 bg-[#ff3b30] text-white border-2 border-[#2d482e] rounded shadow-[2px_2px_0_#2d482e] flex items-center justify-center gap-2 hover:translate-y-[2px] hover:shadow-none transition-all mb-2"
                        >
                          <Plus size={16} strokeWidth={3} /> NEW CHAT
                        </button>

                        <div className="text-[8px] text-[#2d482e] mb-1 mt-2">HISTORY</div>
                        {activeHistory.map(chat => (
                          <button
                            key={chat.id}
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
          <div className="h-28 mt-4 flex justify-between items-center px-2 sm:px-6">
            
            {/* Functional D-Pad */}
            <div className="grid grid-cols-3 grid-rows-3 w-[72px] h-[72px] sm:w-[84px] sm:h-[84px] gap-0">
              <div></div>
              {/* UP - File Upload */}
              <button 
                onClick={() => fileInputRef.current?.click()}
                title="Add File"
                className="bg-[#ffcc00] rounded-t-md shadow-[0_4px_0_rgba(0,0,0,0.2)] active:translate-y-1 hover:brightness-110 flex items-center justify-center border-x-2 border-t-2 border-yellow-700 pb-1"
              >
                <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-b-[8px] border-l-transparent border-r-transparent border-b-yellow-800"></div>
              </button>
              <div></div>
              
              {/* LEFT */}
              <button className="bg-[#ffcc00] rounded-l-md shadow-[2px_4px_0_rgba(0,0,0,0.2)] active:translate-y-1 hover:brightness-110 border-y-2 border-l-2 border-yellow-700"></button>
              {/* CENTER */}
              <div className="bg-[#e6b800] border-2 border-yellow-700 flex items-center justify-center">
                <div className="w-3 h-3 bg-yellow-800 rounded-full opacity-50"></div>
              </div>
              {/* RIGHT - Adventure Idea Generator ✨ */}
              <button 
                onClick={generateAdventure}
                title="✨ Adventure Idea"
                className="bg-[#ffcc00] rounded-r-md shadow-[2px_4px_0_rgba(0,0,0,0.2)] active:translate-y-1 hover:brightness-110 border-y-2 border-r-2 border-yellow-700 flex items-center justify-center text-[10px] sm:text-xs pb-1"
              >✨</button>
              
              <div></div>
              {/* DOWN */}
              <button className="bg-[#ffcc00] rounded-b-md shadow-[0_4px_0_rgba(0,0,0,0.2)] active:translate-y-1 hover:brightness-110 border-x-2 border-b-2 border-yellow-700"></button>
              <div></div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex gap-4 sm:gap-6 transform -rotate-12 translate-y-2">
              {/* Green Button: Camera / Image Upload */}
              <button 
                onClick={() => cameraInputRef.current?.click()}
                title="Camera / Add Photo"
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[#34c759] shadow-[0_6px_0_#1e7b36] border-2 border-[#1e7b36] active:translate-y-[6px] active:shadow-none hover:brightness-110 transition-all flex items-center justify-center mt-6"
              >
                 <span className="font-bold text-[#1e7b36] text-xs">A</span>
              </button>
              
              {/* Red Button: Send Message */}
              <button 
                onClick={handleSend}
                disabled={isLoading}
                title="Send Message"
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[#ff3b30] shadow-[0_6px_0_#99231d] border-2 border-[#99231d] active:translate-y-[6px] active:shadow-none hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center"
              >
                 <span className="font-bold text-[#99231d] text-xs">B</span>
              </button>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
