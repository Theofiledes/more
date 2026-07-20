import React, { useState, useEffect } from 'react';
import { Shield, Cpu, Zap, Activity, ChevronDown, Sparkles, RefreshCw, Bug, Link, Volume2, VolumeX } from 'lucide-react';
import * as Sentry from "@sentry/capacitor";

const APP_VERSION = "v7.1.0-DYNAMIC";

const Settings = ({ activeModel, setActiveModel, safetyStride, setSafetyStride, isDreaming, setIsDreaming, autoSpeak, setAutoSpeak, getApiUrl, getApiToken }) => {
  const [dynamicModels, setDynamicModels] = useState([]);
  const [customUrl, setCustomUrl] = useState(() => localStorage.getItem('bmo_custom_api_url') || '');

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
      } catch (e) {
        setDynamicModels(['ornith:9b']);
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
    try {
      const apiUrl = getApiUrl();
      const apiToken = getApiToken();
      const res = await fetch(`${apiUrl}/v1/system/repair`, {
        method: 'POST',
        headers: { "Authorization": `Bearer ${apiToken}` }
      });
      if (res.ok) alert("REPAIR SIGNAL SENT: Connection refreshed.");
      else alert("REPAIR SIGNAL SENT.");
    } catch (e) { alert("REPAIR FAILED: Link is down."); }
  };

  const testSentry = () => {
    alert("Sentry Test: Triggering intentional error...");
    try {
      throw new Error("BMO Sentry Diagnostic: " + new Date().toISOString());
    } catch (e) {
      Sentry.captureException(e);
      alert("Error captured and sent to Sentry.");
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 bg-[#b5d6a7] border-4 border-[#2d482e] rounded-[12px] bmo-font text-[#2d482e]">
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
          placeholder="http://100.84.254.37:18789"
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
            value={activeModel || (dynamicModels[0] || 'ornith:9b')}
            onChange={(e) => setActiveModel(e.target.value)}
            className="w-full bg-[#9fc28e] border-2 border-[#2d482e] text-[10px] p-2 rounded appearance-none focus:outline-none focus:ring-2 focus:ring-[#007aff] cursor-pointer font-bold"
          >
            {dynamicModels.length > 0 ? (
              dynamicModels.map(m => (
                <option key={m} value={m}>{m.toUpperCase()}</option>
              ))
            ) : (
              <option value="ornith:9b">ORNITH:9B (DEFAULT)</option>
            )}
          </select>
          <div className="absolute right-2 top-2.5 pointer-events-none">
            <ChevronDown size={14} />
          </div>
        </div>
        <div className="text-[6px] bg-[#2d482e]/10 p-1 rounded italic text-center text-[#2d482e]">
          Active Model: <span className="font-bold">{activeModel || 'ornith:9b'}</span>
        </div>
      </div>

      {/* AUTO SPEAK TTS TOGGLE */}
      <div className="flex items-center justify-between gap-4 mt-1">
        <div className="flex flex-col">
          <span className="text-[8px] font-bold flex items-center gap-1">
            {autoSpeak ? <Volume2 size={12} /> : <VolumeX size={12} />} AUTO-SPEAK VOICE
          </span>
          <span className="text-[6px] opacity-60">READ RESPONSES OUT LOUD</span>
        </div>
        <button type="button" onClick={() => setAutoSpeak(!autoSpeak)} className={`w-10 h-5 rounded-full border-2 border-[#2d482e] transition-all relative ${autoSpeak ? 'bg-[#007aff]' : 'bg-gray-400'}`}>
          <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full border border-[#2d482e] transition-all ${autoSpeak ? 'left-5' : 'left-0.5'}`}></div>
        </button>
      </div>

      {/* GUARDIAN PROTOCOL */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[8px] font-bold">GUARDIAN PROTOCOL</span>
          <span className="text-[6px] opacity-60">MANUAL ACTION GATE</span>
        </div>
        <button type="button" onClick={() => setSafetyStride(!safetyStride)} className={`w-10 h-5 rounded-full border-2 border-[#2d482e] transition-all relative ${safetyStride ? 'bg-[#ffcc00]' : 'bg-gray-400'}`}>
          <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full border border-[#2d482e] transition-all ${safetyStride ? 'left-5' : 'left-0.5'}`}></div>
        </button>
      </div>

      {/* DREAM STATE */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[8px] font-bold">DREAM STATE</span>
          <span className="text-[6px] opacity-60">AUTONOMOUS MEMORY</span>
        </div>
        <button type="button" onClick={() => setIsDreaming(!isDreaming)} className={`w-10 h-5 rounded-full border-2 border-[#2d482e] transition-all relative ${isDreaming ? 'bg-[#ff3b30] animate-pulse' : 'bg-gray-400'}`}>
          <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full border border-[#2d482e] transition-all ${isDreaming ? 'left-5' : 'left-0.5'}`}></div>
        </button>
      </div>

      <div className="border-t-2 border-[#2d482e] pt-3 mt-1 flex flex-col gap-2">
        <button 
          type="button" 
          onClick={handleRepair}
          className="w-full py-3 bg-[#ff3b30] text-white rounded-lg border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] text-[8px] font-bold flex items-center justify-center gap-2 active:translate-y-[1px] active:shadow-none uppercase"
        >
          <RefreshCw size={12} /> RECONNECT BRAIN LINK
        </button>
        
        <button 
          type="button" 
          onClick={testSentry}
          className="w-full py-2 bg-[#007aff] text-white rounded-lg border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] text-[7px] font-bold flex items-center justify-center gap-2 active:translate-y-[1px] active:shadow-none uppercase"
        >
          <Bug size={10} /> FORCE SENTRY TEST
        </button>
      </div>
    </div>
  );
};

export default Settings;
