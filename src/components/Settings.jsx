import React, { useState, useEffect } from 'react';
import { Shield, ChevronDown, RefreshCw, Link, Volume2, VolumeX, Sliders, Volume1, Activity, Copy, Check, Radio, Play, Keyboard, Sparkles } from 'lucide-react';
import { playClick, playChime, playGlitch } from '../utils/soundEffects';
import AutonomyPanel from './AutonomyPanel';

export const APP_VERSION = "v7.2.0";

const Settings = ({
  activeModel,
  setActiveModel,
  safetyStride,
  setSafetyStride,
  isDreaming,
  setIsDreaming,
  autoSpeak,
  setAutoSpeak,
  autoHideKeyboard = true,
  setAutoHideKeyboard,
  voiceRate = 1.0,
  setVoiceRate,
  voicePitch = 1.2,
  setVoicePitch,
  sfxEnabled = true,
  setSfxEnabled,
  tts,
  currentUser = 'Player',
  systemHealth = { backend: 'OFFLINE' },
  getApiUrl,
  getApiToken,
  onReplayTutorial
}) => {
  const [dynamicModels, setDynamicModels] = useState([]);
  const [customUrl, setCustomUrl] = useState(() => localStorage.getItem('bmo_custom_api_url') || '');
  const [copiedDiag, setCopiedDiag] = useState(false);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const apiUrl = getApiUrl();
        const apiToken = getApiToken();
        const res = await fetch(`${apiUrl}/v1/models`, { headers: { "Authorization": `Bearer ${apiToken}` } });
        if (res.ok) {
          const data = await res.json();
          if (data.models && data.models.length > 0) {
            setDynamicModels(data.models);
            if (!activeModel || !data.models.includes(activeModel)) {
              setActiveModel(data.models[0]);
            }
          }
        }
      } catch {
        setDynamicModels([]);
      }
    };
    fetchModels();
  }, [getApiUrl, getApiToken, activeModel, setActiveModel]);

  const handleSaveUrl = (e) => {
    const val = e.target.value;
    setCustomUrl(val);
    if (val.trim()) {
      localStorage.setItem('bmo_custom_api_url', val.trim());
    } else {
      localStorage.removeItem('bmo_custom_api_url');
    }
  };

  const handleRepair = async () => {
    playGlitch();
    try {
      const apiUrl = getApiUrl();
      const apiToken = getApiToken();
      const res = await fetch(`${apiUrl}/v1/system/repair`, {
        method: 'POST',
        headers: { "Authorization": `Bearer ${apiToken}` }
      });
      if (res.ok) {
        playChime();
        alert("REPAIR SIGNAL SENT: Connection refreshed.");
      } else {
        alert("REPAIR SIGNAL SENT.");
      }
    } catch {
      alert("REPAIR FAILED: Link is down.");
    }
  };

  const handleTestVoice = () => {
    playClick();
    if (tts?.speak) {
      tts.speak(
        "Greetings! I am BMO, your friendly living video game console system!",
        undefined,
        voiceRate,
        voicePitch
      );
    }
  };

  const handleToggleSfx = () => {
    const nextVal = !sfxEnabled;
    setSfxEnabled(nextVal);
    localStorage.setItem('bmo_sfx_enabled', nextVal ? 'true' : 'false');
    if (nextVal) {
      playChime();
    }
  };

  const handleCopyDiagnostics = () => {
    playChime();
    const diagReport = `[BMO DIAGNOSTIC REPORT]
App Version: ${APP_VERSION}
Active User: ${currentUser}
Server URL: ${getApiUrl()}
Backend Health: ${systemHealth?.backend || 'UNKNOWN'}
Active Model: ${activeModel || 'AUTO-DETECT'}
Voice Speed: ${voiceRate}x
Voice Pitch: ${voicePitch}
SFX Enabled: ${sfxEnabled ? 'YES' : 'NO'}
Guardian Protocol: ${safetyStride ? 'ACTIVE' : 'OFF'}
Dream State: ${isDreaming ? 'ACTIVE' : 'OFF'}
Timestamp: ${new Date().toISOString()}`;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(diagReport);
      setCopiedDiag(true);
      setTimeout(() => setCopiedDiag(false), 2500);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 bg-[#b5d6a7] border-4 border-[#2d482e] rounded-[12px] bmo-font text-[#2d482e] shadow-lg">
      {/* VERSION BADGE HEADER */}
      <div className="flex justify-between items-center border-b-2 border-[#2d482e] pb-2">
        <div className="text-[10px] font-bold flex items-center gap-2 uppercase">
          <Shield size={14} /> SYSTEM CONFIG
        </div>
        <div className="bg-[#2d482e] text-[#b5d6a7] px-2 py-0.5 rounded text-[8px] font-mono font-bold shadow-[1px_1px_0_white]">
          {APP_VERSION}
        </div>
      </div>

      {/* SERVER URL CONFIG */}
      <div className="flex flex-col gap-1">
        <div className="text-[8px] opacity-70 uppercase tracking-widest flex items-center gap-1">
          <Link size={10} /> SERVER ADDRESS (TAILSCALE / LOCAL)
        </div>
        <input
          type="text"
          value={customUrl}
          onChange={handleSaveUrl}
          placeholder="http://localhost:18789"
          className="w-full bg-[#9fc28e] border-2 border-[#2d482e] text-[9px] p-2 rounded focus:outline-none focus:ring-2 focus:ring-[#007aff]"
        />
        <div className="text-[6px] opacity-60">
          Active Link: <span className="font-mono font-bold">{getApiUrl()}</span>
        </div>
      </div>

      {/* DYNAMIC MODEL SELECTION */}
      <div className="flex flex-col gap-2">
        <div className="text-[8px] opacity-70 uppercase tracking-widest">Active Neural Engine (Dynamic)</div>
        <div className="relative">
          <select
            value={activeModel || (dynamicModels[0] || '')}
            onChange={(e) => {
              playClick();
              setActiveModel(e.target.value);
            }}
            className="w-full bg-[#9fc28e] border-2 border-[#2d482e] text-[10px] p-2 rounded appearance-none focus:outline-none focus:ring-2 focus:ring-[#007aff] cursor-pointer font-bold"
          >
            {dynamicModels.length > 0 ? (
              dynamicModels.map(m => (
                <option key={m} value={m}>{m.toUpperCase()}</option>
              ))
            ) : (
              <option value="">AUTO-DETECT</option>
            )}
          </select>
          <div className="absolute right-2 top-2.5 pointer-events-none">
            <ChevronDown size={14} />
          </div>
        </div>
        <div className="text-[6px] bg-[#2d482e]/10 p-1 rounded italic text-center text-[#2d482e]">
          Active Model: <span className="font-bold">{activeModel || 'AUTO-DETECT'}</span>
        </div>
      </div>

      {/* AUDIO & VOICE CONTROLS */}
      <div className="border-t-2 border-[#2d482e] pt-3 flex flex-col gap-3">
        <div className="text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5 border-b border-[#2d482e]/30 pb-1">
          <Sliders size={12} /> VOICE & AUDIO CONTROLS
        </div>

        {/* VOICE SPEED SLIDER */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between items-center text-[8px] font-bold">
            <span>VOICE SPEED (RATE)</span>
            <span className="bg-[#2d482e] text-[#b5d6a7] px-2 py-0.5 rounded text-[8px] font-mono">
              {Number(voiceRate).toFixed(1)}x
            </span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={voiceRate}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setVoiceRate(val);
              localStorage.setItem('bmo_voice_rate', val.toString());
            }}
            className="w-full cursor-pointer"
          />
        </div>

        {/* VOICE PITCH SLIDER */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between items-center text-[8px] font-bold">
            <span>VOICE PITCH</span>
            <span className="bg-[#2d482e] text-[#b5d6a7] px-2 py-0.5 rounded text-[8px] font-mono">
              {Number(voicePitch).toFixed(1)}
            </span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={voicePitch}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setVoicePitch(val);
              localStorage.setItem('bmo_voice_pitch', val.toString());
            }}
            className="w-full cursor-pointer"
          />
        </div>

        {/* TEST VOICE BUTTON */}
        <button
          type="button"
          onClick={handleTestVoice}
          className="w-full py-2 bg-[#007aff] text-white rounded-lg border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] text-[8px] font-bold flex items-center justify-center gap-2 active:translate-y-[1px] active:shadow-none uppercase transition-all"
        >
          <Play size={10} /> TEST VOICE SAMPLE
        </button>

        {/* SOUND FX TOGGLE */}
        <div className="flex items-center justify-between gap-4 mt-1">
          <div className="flex flex-col">
            <span className="text-[8px] font-bold flex items-center gap-1">
              {sfxEnabled ? <Volume1 size={12} /> : <VolumeX size={12} />} RETRO SOUND FX (SFX)
            </span>
            <span className="text-[6px] opacity-60">8-BIT SYNTH SOUNDS</span>
          </div>
          <button
            type="button"
            onClick={handleToggleSfx}
            className={`w-10 h-5 rounded-full border-2 border-[#2d482e] transition-all relative ${sfxEnabled ? 'bg-[#007aff]' : 'bg-gray-400'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full border border-[#2d482e] transition-all ${sfxEnabled ? 'left-5' : 'left-0.5'}`}></div>
          </button>
        </div>

        {/* AUTO SPEAK TTS TOGGLE */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-[8px] font-bold flex items-center gap-1">
              {autoSpeak ? <Volume2 size={12} /> : <VolumeX size={12} />} AUTO-SPEAK VOICE
            </span>
            <span className="text-[6px] opacity-60">READ RESPONSES OUT LOUD</span>
          </div>
          <button
            type="button"
            onClick={() => {
              playClick();
              setAutoSpeak(!autoSpeak);
            }}
            className={`w-10 h-5 rounded-full border-2 border-[#2d482e] transition-all relative ${autoSpeak ? 'bg-[#007aff]' : 'bg-gray-400'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full border border-[#2d482e] transition-all ${autoSpeak ? 'left-5' : 'left-0.5'}`}></div>
          </button>
        </div>

        {/* AUTO-HIDE KEYBOARD TOGGLE */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-[8px] font-bold flex items-center gap-1">
              <Keyboard size={12} /> AUTO-HIDE KEYBOARD ON SEND
            </span>
            <span className="text-[6px] opacity-60">DISMISS KEYBOARD WHEN SENDING</span>
          </div>
          <button
            type="button"
            onClick={() => {
              playClick();
              if (setAutoHideKeyboard) {
                setAutoHideKeyboard(!autoHideKeyboard);
              }
            }}
            className={`w-10 h-5 rounded-full border-2 border-[#2d482e] transition-all relative ${autoHideKeyboard ? 'bg-[#007aff]' : 'bg-gray-400'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full border border-[#2d482e] transition-all ${autoHideKeyboard ? 'left-5' : 'left-0.5'}`}></div>
          </button>
        </div>
      </div>

      {/* SYSTEM PROTOCOLS */}
      <div className="border-t-2 border-[#2d482e] pt-3 flex flex-col gap-2">
        <div className="text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5 border-b border-[#2d482e]/30 pb-1">
          <Shield size={12} /> PROTOCOLS & AUTONOMY
        </div>

        {/* GUARDIAN PROTOCOL */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-[8px] font-bold">GUARDIAN PROTOCOL</span>
            <span className="text-[6px] opacity-60">MANUAL ACTION GATE</span>
          </div>
          <button
            type="button"
            onClick={() => {
              playClick();
              setSafetyStride(!safetyStride);
            }}
            className={`w-10 h-5 rounded-full border-2 border-[#2d482e] transition-all relative ${safetyStride ? 'bg-[#ffcc00]' : 'bg-gray-400'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full border border-[#2d482e] transition-all ${safetyStride ? 'left-5' : 'left-0.5'}`}></div>
          </button>
        </div>

        {/* DREAM STATE */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-[8px] font-bold">DREAM STATE</span>
            <span className="text-[6px] opacity-60">AUTONOMOUS MEMORY</span>
          </div>
          <button
            type="button"
            onClick={() => {
              playClick();
              setIsDreaming(!isDreaming);
            }}
            className={`w-10 h-5 rounded-full border-2 border-[#2d482e] transition-all relative ${isDreaming ? 'bg-[#ff3b30] animate-pulse' : 'bg-gray-400'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full border border-[#2d482e] transition-all ${isDreaming ? 'left-5' : 'left-0.5'}`}></div>
          </button>
        </div>
      </div>

      <AutonomyPanel />

      {/* SYSTEM DIAGNOSTICS */}
      <div className="border-t-2 border-[#2d482e] pt-3 flex flex-col gap-2">
        <div className="text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5 border-b border-[#2d482e]/30 pb-1">
          <Activity size={12} /> SYSTEM DIAGNOSTICS
        </div>

        <div className="bg-[#9fc28e] border-2 border-[#2d482e] rounded p-2 flex flex-col gap-1 text-[7px]">
          <div className="flex justify-between items-center">
            <span className="opacity-70">BACKEND STATE:</span>
            <span className={`font-mono font-bold ${systemHealth?.backend === 'OK' ? 'text-green-800' : 'text-red-700'}`}>
              {systemHealth?.backend || 'OFFLINE'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="opacity-70">ACTIVE USER:</span>
            <span className="font-mono font-bold uppercase">{currentUser}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="opacity-70">AUDIO SYNTH:</span>
            <span className="font-mono font-bold text-blue-900">WEB AUDIO API</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleCopyDiagnostics}
          className="w-full py-2 bg-[#ffcc00] text-[#2d482e] rounded-lg border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] text-[8px] font-bold flex items-center justify-center gap-2 active:translate-y-[1px] active:shadow-none uppercase transition-all"
        >
          {copiedDiag ? <Check size={12} className="text-green-800" /> : <Copy size={12} />}
          {copiedDiag ? 'DIAGNOSTICS COPIED!' : 'QUICK SHARE DIAGNOSTICS'}
        </button>

        <button
          type="button"
          onClick={() => {
            playChime();
            onReplayTutorial?.();
          }}
          className="w-full py-2 bg-[#34c759] text-white rounded-lg border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] text-[8px] font-bold flex items-center justify-center gap-2 active:translate-y-[1px] active:shadow-none uppercase transition-all bmo-btn-tactile"
        >
          <Sparkles size={12} /> REPLAY INTERACTIVE TUTORIAL
        </button>
      </div>

      {/* SYSTEM UTILITIES */}
      <div className="border-t-2 border-[#2d482e] pt-3 mt-1 flex flex-col gap-2">
        <button 
          type="button" 
          onClick={handleRepair}
          className="w-full py-3 bg-[#ff3b30] text-white rounded-lg border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] text-[8px] font-bold flex items-center justify-center gap-2 active:translate-y-[1px] active:shadow-none uppercase"
        >
          <RefreshCw size={12} /> RECONNECT BRAIN LINK
        </button>
      </div>
    </div>
  );
};

export default Settings;
