import React, { useState } from 'react';
import { X, ChevronRight, ChevronLeft, Check, Sparkles, Sliders, Cpu, HardDrive, Volume2, ShieldCheck, Mic, Camera, Send, RefreshCw, Undo2, FolderUp } from 'lucide-react';
import { playClick, playCheer, playBeep } from '../utils/soundEffects';

const STEPS = [
  {
    id: 1,
    title: 'WELCOME TO BMO!',
    subtitle: 'Your Living Video Game Console & Cyber-Engineer Companion',
    icon: Sparkles,
    color: '#007aff',
    content: (
      <div className="flex flex-col gap-3 text-left">
        <p className="text-[10px] sm:text-xs leading-relaxed text-[#2d482e]">
          Greetings! BMO is an autonomous, local-first AI companion powered by edge intelligence, Web Audio synthesis, and multi-modal vision models.
        </p>
        <div className="bg-[#9fc28e] border-2 border-[#2d482e] p-2.5 rounded-lg flex flex-col gap-2 shadow-inner">
          <div className="flex items-start gap-2">
            <span className="bg-[#007aff] text-white px-1.5 py-0.5 rounded text-[8px] font-bold">1</span>
            <div className="text-[9px] text-[#2d482e]">
              <strong className="block">COMPANION MODE</strong>
              Natural voice speech synthesis, conversational memory, and reactive BMO facial expressions.
            </div>
          </div>
          <div className="flex items-start gap-2 border-t border-[#2d482e]/20 pt-2">
            <span className="bg-[#ffcc00] text-[#2d482e] px-1.5 py-0.5 rounded text-[8px] font-bold">2</span>
            <div className="text-[9px] text-[#2d482e]">
              <strong className="block">CYBER-ENGINEER MODE</strong>
              Real-time telemetry, automated macro playbooks, live workspace editing, and backend system control.
            </div>
          </div>
        </div>
      </div>
    )
  },
  {
    id: 2,
    title: 'HARDWARE CONTROLS & D-PAD',
    subtitle: 'Tactile Physics & Physical Button Mapping',
    icon: Cpu,
    color: '#ffcc00',
    content: (
      <div className="flex flex-col gap-2 text-left">
        <p className="text-[9px] sm:text-[10px] leading-relaxed text-[#2d482e] mb-1">
          BMO's physical controller provides 1-to-1 tactile actions with native sound feedback:
        </p>
        <div className="grid grid-cols-2 gap-2 text-[8px] text-[#2d482e]">
          <div className="bg-[#9fc28e] p-2 border-2 border-[#2d482e] rounded flex items-center gap-1.5">
            <span className="w-4 h-4 bg-[#ffcc00] border border-[#2d482e] rounded flex items-center justify-center font-bold text-[7px]">▲</span>
            <div><strong className="block text-[8px]">SCROLL (UP)</strong>Scroll chat up</div>
          </div>
          <div className="bg-[#9fc28e] p-2 border-2 border-[#2d482e] rounded flex items-center gap-1.5">
            <span className="w-4 h-4 bg-[#ffcc00] border border-[#2d482e] rounded flex items-center justify-center font-bold text-[7px]">◄</span>
            <div><strong className="block text-[8px]">UPLOAD (LEFT)</strong>Insert data cartridge</div>
          </div>
          <div className="bg-[#9fc28e] p-2 border-2 border-[#2d482e] rounded flex items-center gap-1.5">
            <span className="w-4 h-4 bg-[#e6b800] border border-[#2d482e] rounded flex items-center justify-center text-[#2d482e]"><Mic size={10} /></span>
            <div><strong className="block text-[8px]">TALK (CENTER)</strong>Tap to record, tap to send</div>
          </div>
          <div className="bg-[#9fc28e] p-2 border-2 border-[#2d482e] rounded flex items-center gap-1.5">
            <span className="w-4 h-4 bg-[#ffcc00] border border-[#2d482e] rounded flex items-center justify-center font-bold text-[7px]">►</span>
            <div><strong className="block text-[8px]">RESET (RIGHT)</strong>Clear chat session</div>
          </div>
          <div className="bg-[#9fc28e] p-2 border-2 border-[#2d482e] rounded flex items-center gap-1.5">
            <span className="w-4 h-4 bg-[#34c759] text-white border border-[#1e7b36] rounded-full flex items-center justify-center font-bold text-[7px]">A</span>
            <div><strong className="block text-[8px]">CAM (A)</strong>Optical vision capture</div>
          </div>
          <div className="bg-[#9fc28e] p-2 border-2 border-[#2d482e] rounded flex items-center gap-1.5">
            <span className="w-4 h-4 bg-[#ff3b30] text-white border border-[#99231d] rounded-full flex items-center justify-center font-bold text-[7px]">B</span>
            <div><strong className="block text-[8px]">SEND (B)</strong>Action B execute</div>
          </div>
        </div>
      </div>
    )
  },
  {
    id: 3,
    title: 'TALKING WITH BMO',
    subtitle: 'Voice In, Voice Out & Retro Sound Synth',
    icon: Volume2,
    color: '#34c759',
    content: (
      <div className="flex flex-col gap-2.5 text-left">
        <div className="bg-[#9fc28e] border-2 border-[#2d482e] p-2.5 rounded-lg flex flex-col gap-2 text-[9px] text-[#2d482e]">
          <div className="flex items-center gap-2">
            <Mic size={16} className="text-[#ff3b30] shrink-0" />
            <span><strong>TALK TO BMO:</strong> Tap the center mic to record, tap again to stop. Your words land in the text box so you can edit before sending.</span>
          </div>
          <div className="border-t border-[#2d482e]/20 pt-2 text-[8px] italic opacity-80">
            Voice input is an optional server add-on. If it isn't installed, BMO will say so instead of listening.
          </div>
        </div>
        <p className="text-[9px] sm:text-[10px] leading-relaxed text-[#2d482e]">
          BMO talks back too — tune the voice in <strong>Settings</strong>:
        </p>
        <div className="bg-[#9fc28e] border-2 border-[#2d482e] p-2.5 rounded-lg flex flex-col gap-2">
          <div className="flex justify-between items-center text-[9px] font-bold text-[#2d482e]">
            <span>VOICE SPEED / PITCH:</span>
            <span className="bg-[#2d482e] text-[#b5d6a7] px-2 py-0.5 rounded font-mono">0.5 - 2.0</span>
          </div>
          <div className="border-t border-[#2d482e]/20 pt-2 flex justify-between items-center text-[9px] text-[#2d482e]">
            <span><strong>8-BIT SOUND SYNTH:</strong> Tactile blips, chimes, cheers & cartridge clicks</span>
          </div>
        </div>
      </div>
    )
  },
  {
    id: 4,
    title: 'CARTRIDGE & FILE LOADING',
    subtitle: 'Multimodal Vision & Document Analysis',
    icon: HardDrive,
    color: '#ff3b30',
    content: (
      <div className="flex flex-col gap-2.5 text-left">
        <p className="text-[9px] sm:text-[10px] leading-relaxed text-[#2d482e]">
          Insert media cartridges directly into BMO's memory drive for instant optical analysis:
        </p>
        <div className="bg-[#9fc28e] border-2 border-[#2d482e] p-2.5 rounded-lg flex flex-col gap-2 text-[9px] text-[#2d482e]">
          <div className="flex items-center gap-2">
            <FolderUp size={16} className="text-[#007aff] shrink-0" />
            <span><strong>FILE CARTRIDGES:</strong> Load text, markdown, log files, or code snippets.</span>
          </div>
          <div className="flex items-center gap-2 border-t border-[#2d482e]/20 pt-2">
            <Camera size={16} className="text-[#ff3b30] shrink-0" />
            <span><strong>OPTICAL VISION:</strong> Capture camera photos or upload images to feed Moondream model.</span>
          </div>
        </div>
      </div>
    )
  },
  {
    id: 5,
    title: 'BRAIN SWAPS & TAILSCALE LINK',
    subtitle: 'Hybrid AI Brains & Remote Endpoint Server',
    icon: ShieldCheck,
    color: '#007aff',
    content: (
      <div className="flex flex-col gap-2.5 text-left">
        <p className="text-[9px] sm:text-[10px] leading-relaxed text-[#2d482e]">
          BMO operates seamlessly across local and cloud intelligence engines:
        </p>
        <div className="bg-[#9fc28e] border-2 border-[#2d482e] p-2.5 rounded-lg flex flex-col gap-2 text-[9px] text-[#2d482e]">
          <div className="flex justify-between items-center">
            <span className="font-bold">🤖 LOCAL BRAIN:</span>
            <span className="bg-[#ff3b30] text-white px-2 py-0.5 rounded text-[8px] font-bold">OLLAMA (DEFAULT)</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-bold">☁️ GEMINI BRAIN:</span>
            <span className="bg-[#007aff] text-white px-2 py-0.5 rounded text-[8px] font-bold">NEEDS API KEY</span>
          </div>
          <div className="text-[8px] italic opacity-80">
            BMO runs fully on your own hardware by default. Cloud mode only works if you add your own Gemini key.
          </div>
          <div className="border-t border-[#2d482e]/20 pt-2 text-[8px]">
            <strong>REMOTE LINK:</strong> Set your server address in Settings to reach BMO from your phone — a private mesh network like Tailscale is the safe way to do it.
          </div>
        </div>
      </div>
    )
  },
  {
    id: 6,
    title: 'TOOLS, SAFETY & TELEMETRY',
    subtitle: 'What BMO Can Do To Your Machine — And How To Watch It',
    icon: ShieldCheck,
    color: '#ffcc00',
    content: (
      <div className="flex flex-col gap-2.5 text-left">
        <p className="text-[9px] sm:text-[10px] leading-relaxed text-[#2d482e]">
          BMO is not just a chatbot — it can run real commands on the machine hosting it.
        </p>
        <div className="bg-[#9fc28e] border-2 border-[#2d482e] p-2.5 rounded-lg flex flex-col gap-2 text-[9px] text-[#2d482e]">
          <div className="flex items-start gap-2">
            <ShieldCheck size={16} className="text-[#ffcc00] shrink-0 mt-0.5" />
            <span><strong>GUARDIAN PROTOCOL:</strong> Leave this ON in Settings and BMO must ask before running a shell command — you approve or reject each one.</span>
          </div>
          <div className="flex items-start gap-2 border-t border-[#2d482e]/20 pt-2">
            <Sparkles size={16} className="text-[#007aff] shrink-0 mt-0.5" />
            <span><strong>SEE IT THINK:</strong> BMO shows its reasoning while it works. Tap SHOW REASONING on any reply to reread how it got there.</span>
          </div>
          <div className="flex items-start gap-2 border-t border-[#2d482e]/20 pt-2">
            <Cpu size={16} className="text-[#34c759] shrink-0 mt-0.5" />
            <span><strong>DASHBOARD:</strong> Live CPU, memory, disk and a context-window gauge, so you can see how much memory BMO has left in a conversation.</span>
          </div>
        </div>
      </div>
    )
  }
];

export default function OnboardingModal({ isOpen, onClose }) {
  const [currentStep, setCurrentStep] = useState(0);

  if (!isOpen) return null;

  const step = STEPS[currentStep];
  const StepIcon = step.icon;
  const isFirst = currentStep === 0;
  const isLast = currentStep === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      handleComplete();
    } else {
      playClick();
      setCurrentStep(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirst) {
      playClick();
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleComplete = () => {
    playCheer();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('bmo_onboarding_completed', 'true');
    }
    onClose?.();
  };

  const handleSkip = () => {
    playBeep();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('bmo_onboarding_completed', 'true');
    }
    onClose?.();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[150] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#b5d6a7] border-4 border-[#2d482e] rounded-[24px] shadow-[0_10px_30px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col bmo-font text-[#2d482e] crt-scanlines">
        {/* HEADER */}
        <div className="bg-[#9fc28e] border-b-4 border-[#2d482e] p-3 sm:p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div 
              className="p-1.5 rounded-lg border-2 border-[#2d482e] text-white shadow-[1px_1px_0_#2d482e]"
              style={{ backgroundColor: step.color }}
            >
              <StepIcon size={16} />
            </div>
            <div>
              <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[#2d482e]">
                BMO TUTORIAL ({currentStep + 1}/{STEPS.length})
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSkip}
            className="text-[#ff3b30] hover:scale-110 transition-transform p-1"
            title="Close / Skip"
          >
            <X size={20} strokeWidth={3} />
          </button>
        </div>

        {/* BODY */}
        <div className="p-4 sm:p-5 flex-1 flex flex-col gap-3 min-h-[220px] bg-[#b5d6a7]">
          <div>
            <h3 className="text-xs sm:text-sm font-bold uppercase text-[#2d482e] mb-0.5">
              {step.title}
            </h3>
            <p className="text-[8px] sm:text-[9px] opacity-80 uppercase tracking-wide font-mono mb-3">
              {step.subtitle}
            </p>
          </div>

          <div className="flex-1">
            {step.content}
          </div>
        </div>

        {/* STEP PROGRESS DOTS */}
        <div className="bg-[#9fc28e] border-t-2 border-[#2d482e] py-2 px-4 flex justify-center items-center gap-2">
          {STEPS.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                playClick();
                setCurrentStep(idx);
              }}
              className={`h-2.5 rounded-full transition-all border border-[#2d482e] ${
                idx === currentStep ? 'w-6 bg-[#007aff]' : 'w-2.5 bg-[#b5d6a7]'
              }`}
              title={`Step ${idx + 1}`}
            />
          ))}
        </div>

        {/* FOOTER NAV CONTROLS */}
        <div className="bg-[#9fc28e] border-t-2 border-[#2d482e] p-3 flex justify-between items-center gap-2">
          <button
            type="button"
            onClick={handleSkip}
            className="text-[8px] text-[#2d482e] opacity-75 hover:opacity-100 uppercase underline"
          >
            SKIP TUTORIAL
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handlePrev}
              disabled={isFirst}
              className={`px-3 py-1.5 rounded-lg border-2 border-[#2d482e] text-[9px] font-bold flex items-center gap-1 uppercase transition-all bmo-btn-tactile ${
                isFirst
                  ? 'opacity-40 cursor-not-allowed bg-gray-300'
                  : 'bg-[#b5d6a7] shadow-[1px_1px_0_#2d482e] active:translate-y-[1px]'
              }`}
            >
              <ChevronLeft size={12} /> PREV
            </button>

            <button
              type="button"
              onClick={handleNext}
              className={`px-4 py-1.5 rounded-lg border-2 border-[#2d482e] text-[9px] font-bold flex items-center gap-1 uppercase transition-all text-white shadow-[2px_2px_0_#2d482e] active:translate-y-[1px] bmo-btn-tactile ${
                isLast ? 'bg-[#34c759]' : 'bg-[#007aff]'
              }`}
            >
              {isLast ? (
                <>GOT IT! <Check size={12} /></>
              ) : (
                <>NEXT <ChevronRight size={12} /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
