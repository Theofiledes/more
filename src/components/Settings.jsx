import React from 'react';
import { Shield, Cpu, Zap, Activity, ChevronDown, Sparkles } from 'lucide-react';

const Settings = ({ activeModel, setActiveModel, safetyStride, setSafetyStride, isDreaming, setIsDreaming }) => {
  const models = [
    { id: 'llama3.2:3b', label: 'STANDARD', desc: 'Llama 3.2 3B', icon: <Cpu size={14} /> },
    { id: 'phi4', label: 'TURBO', desc: 'Phi-4 Mini (High-Speed)', icon: <Zap size={14} /> },
    { id: 'moondream', label: 'MOONSHOT', desc: 'Tiny Vision Model', icon: <Sparkles size={14} /> },
    { id: 'llama3.1:8b', label: 'POWER', desc: 'Llama 3.1 8B', icon: <Activity size={14} /> }
  ];


  return (
    <div className="flex flex-col gap-4 p-4 bg-[#b5d6a7] border-4 border-[#2d482e] rounded-[12px] bmo-font text-[#2d482e]">
      <div className="text-[10px] font-bold border-b-2 border-[#2d482e] pb-1 flex items-center gap-2">
        <Shield size={14} /> SYSTEM CONFIG
      </div>

      {/* Model Selector Dropdown */}
      <div className="flex flex-col gap-2">
        <div className="text-[8px] opacity-70 uppercase tracking-widest">Active Neural Engine</div>
        <div className="relative">
          <select 
            value={activeModel}
            onChange={(e) => setActiveModel(e.target.value)}
            className="w-full bg-[#9fc28e] border-2 border-[#2d482e] text-[10px] p-2 rounded appearance-none focus:outline-none focus:ring-2 focus:ring-[#007aff] cursor-pointer"
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.label} ({m.id})</option>
            ))}
          </select>
          <div className="absolute right-2 top-2.5 pointer-events-none">
            <ChevronDown size={14} />
          </div>
        </div>
        <div className="text-[6px] bg-[#2d482e]/10 p-1 rounded italic text-center">
          {models.find(m => m.id === activeModel)?.desc || 'Custom Model'}
        </div>
      </div>

      {/* Guardian Protocol Toggle */}
      <div className="flex items-center justify-between gap-4 mt-2">
        <div className="flex flex-col">
          <span className="text-[8px] font-bold">GUARDIAN PROTOCOL</span>
          <span className="text-[6px] opacity-60">MANUAL ACTION GATE</span>
        </div>
        <button 
          type="button"
          onClick={() => setSafetyStride(!safetyStride)}
          className={`w-12 h-6 rounded-full border-2 border-[#2d482e] transition-all relative ${safetyStride ? 'bg-[#ffcc00]' : 'bg-gray-400'}`}
        >
          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full border border-[#2d482e] transition-all ${safetyStride ? 'left-6' : 'left-0.5'}`}></div>
        </button>
      </div>

      {/* Dream State Toggle */}
      <div className="flex items-center justify-between gap-4 mt-2">
        <div className="flex flex-col">
          <span className="text-[8px] font-bold">DREAM STATE</span>
          <span className="text-[6px] opacity-60">AUTONOMOUS ACTING</span>
        </div>
        <button 
          type="button"
          onClick={() => setIsDreaming(!isDreaming)}
          className={`w-12 h-6 rounded-full border-2 border-[#2d482e] transition-all relative ${isDreaming ? 'bg-[#ff3b30] animate-pulse' : 'bg-gray-400'}`}
        >
          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full border border-[#2d482e] transition-all ${isDreaming ? 'left-6' : 'left-0.5'}`}></div>
        </button>
      </div>
    </div>
  );
};

export default Settings;
