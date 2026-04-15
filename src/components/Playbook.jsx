import React from 'react';
import { Book, Bug, Sparkles, Code, Terminal } from 'lucide-react';

const Playbook = ({ onRunMacro }) => {
  const macros = [
    { 
      id: 'android_debug', 
      label: 'ANDROID DEBUG & FIX', 
      icon: <Bug size={16} />, 
      prompt: "Execute `adb logcat -d`, filter for FATAL, and draft patch.",
      color: 'bg-[#ff3b30]'
    },
    { 
      id: 'ui_polish', 
      label: 'UI POLISH PASS', 
      icon: <Sparkles size={16} />, 
      prompt: "Review current CSS and suggest 3 high-impact aesthetic improvements.",
      color: 'bg-[#007aff]'
    },
    { 
      id: 'code_review', 
      label: 'CODE REVIEW', 
      icon: <Code size={16} />, 
      prompt: "Perform a security and performance audit on the last 3 files modified.",
      color: 'bg-[#7ba068]'
    },
    { 
      id: 'kernel_check', 
      label: 'KERNEL STATUS', 
      icon: <Terminal size={16} />, 
      prompt: "Check system resources and active docker containers.",
      color: 'bg-[#2d482e]'
    }
  ];

  return (
    <div className="flex flex-col gap-4 p-4 bg-[#b5d6a7] border-4 border-[#2d482e] rounded-[12px] bmo-font text-[#2d482e] mt-4">
      <div className="text-[10px] font-bold border-b-2 border-[#2d482e] pb-1 flex items-center gap-2 uppercase">
        <Book size={14} /> Agent Playbook
      </div>

      <div className="grid grid-cols-2 gap-2">
        {macros.map((m) => (
          <button
            key={m.id}
            onClick={() => onRunMacro(m.prompt)}
            className={`${m.color} text-white p-2 rounded-lg border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] active:translate-y-[2px] active:shadow-none transition-all flex flex-col items-center gap-1 text-center`}
          >
            {m.icon}
            <span className="text-[6px] font-bold leading-tight">{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default Playbook;
