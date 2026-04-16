import React from 'react';
import { Shield, Cpu, Zap, Activity } from 'lucide-react';

const Settings = ({ threshold, setThreshold, safetyStride, setSafetyStride, isDreaming, setIsDreaming }) => {
  const tiers = [
    { label: 'Tier 1', desc: 'Flash (Fast)', icon: <Zap size={14} /> },
    { label: 'Tier 2', desc: 'Standard', icon: <Cpu size={14} /> },
    { label: 'Tier 3', desc: 'Pro (Smart)', icon: <Activity size={14} /> }
  ];

  return (
    <div className="flex flex-col gap-4 p-4 bg-[#b5d6a7] border-4 border-[#2d482e] rounded-[12px] bmo-font text-[#2d482e]">
      <div className="text-[10px] font-bold border-b-2 border-[#2d482e] pb-1 flex items-center gap-2">
        <Shield size={14} /> SYSTEM CONFIG
      </div>

      {/* Model Routing Slider */}
      <div className="flex flex-col gap-2">
        <div className="text-[8px] opacity-70 uppercase tracking-widest">Model Routing Threshold</div>
        <div className="relative mt-2 mb-6">
          <input 
            type="range" 
            min="1" 
            max="3" 
            step="1" 
            value={threshold}
            onChange={(e) => setThreshold(parseInt(e.target.value))}
            className="w-full h-2 bg-[#2d482e] rounded-lg appearance-none cursor-pointer accent-[#ffcc00]"
          />
          <div className="flex justify-between mt-2">
            {tiers.map((t, i) => (
              <div key={i} className={`flex flex-col items-center gap-1 ${threshold === i+1 ? 'text-[#ff3b30]' : 'opacity-50'}`}>
                {t.icon}
                <span className="text-[6px]">{t.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="text-[8px] bg-[#9fc28e] p-2 border-2 border-[#2d482e] rounded italic text-center">
          ACTIVE: {tiers[threshold-1].desc}
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

      {/* Dream State Toggle (Loop 5) */}
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
