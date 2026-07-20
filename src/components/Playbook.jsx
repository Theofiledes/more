import React from 'react';
import { Book, Bug, Sparkles, Code, Terminal, GitBranch, UploadCloud, Moon } from 'lucide-react';

const Playbook = ({ onRunMacro }) => {
  const macros = [
    { 
      id: 'git_status', 
      label: 'GIT STATUS & DIFF', 
      icon: <GitBranch size={16} />, 
      prompt: "Execute `git status` and summarize uncommitted changes.",
      color: 'bg-[#007aff]'
    },
    { 
      id: 'code_review', 
      label: 'CODE AUDIT & REVIEW', 
      icon: <Code size={16} />, 
      prompt: "Perform a security and performance audit on modified source files.",
      color: 'bg-[#7ba068]'
    },
    { 
      id: 'git_push', 
      label: 'CHECKPOINT & PUSH', 
      icon: <UploadCloud size={16} />, 
      prompt: "Execute `git add . && git commit -m 'checkpoint: remote update via BMO' && git push origin main`.",
      color: 'bg-[#ffcc00] text-[#2d482e]'
    },
    { 
      id: 'android_debug', 
      label: 'ANDROID LOGCAT DEBUG', 
      icon: <Bug size={16} />, 
      prompt: "Execute `adb logcat -d`, filter for FATAL, and draft patch.",
      color: 'bg-[#ff3b30]'
    }
  ];

  return (
    <div className="flex flex-col gap-4 p-4 bg-[#b5d6a7] border-4 border-[#2d482e] rounded-[12px] bmo-font text-[#2d482e] mt-4">
      <div className="text-[10px] font-bold border-b-2 border-[#2d482e] pb-1 flex items-center gap-2 uppercase">
        <Book size={14} /> Remote Code Buddy Playbook
      </div>

      <div className="grid grid-cols-2 gap-2">
        {macros.map((m) => (
          <button
            key={m.id}
            type="button"
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
