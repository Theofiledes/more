import React, { useState, useRef } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Mic } from 'lucide-react';
import { playClick, playBeep, playCartridge, playGlitch } from '../utils/soundEffects';

const HardwareControls = ({ onSend, onUploadFile, onOpenCamera, onDeleteLast, onClearActiveChat, onStopTTS }) => {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const triggerHaptic = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (e) { }
  };

  const startRecording = async () => {
    onStopTTS?.();
    triggerHaptic();
    playBeep();
    setIsRecording(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunksRef.current.push(event.data); };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
      };
      mediaRecorder.start();
    } catch (err) {
      console.warn("Mic block:", err);
    }
  };

  const stopRecording = () => {
    if (isRecording) {
      if (mediaRecorderRef.current) {
        try { mediaRecorderRef.current.stop(); } catch (e) {}
      }
      setIsRecording(false);
      triggerHaptic();
      playClick();
    }
  };

  const handleBtn = (action, soundType = 'click') => {
    triggerHaptic();
    if (soundType === 'cartridge') {
      playCartridge();
    } else if (soundType === 'beep') {
      playBeep();
    } else if (soundType === 'glitch') {
      playGlitch();
    } else {
      playClick();
    }
    action?.();
  };

  return (
    <div className="w-full flex justify-between items-center px-1 sm:px-4 select-none relative pt-2">
      {/* Functional D-Pad with 1-to-1 crisp labels */}
      <div className="flex flex-col items-center">
        {/* UP LABEL */}
        <div className="mb-1 text-[9px] font-black label-font text-black tracking-wider uppercase text-center leading-none">
          RESET
        </div>

        <div className="flex items-center gap-1.5 relative">
          {/* LEFT LABEL */}
          <div className="text-[9px] font-black label-font text-black tracking-wider uppercase text-right leading-none w-10">
            UPLOAD
          </div>

          {/* D-PAD GRID */}
          <div className="grid grid-cols-3 grid-rows-3 w-[78px] h-[78px] sm:w-[90px] sm:h-[90px] gap-0 relative bg-transparent">
            <div></div>
            {/* UP: CLEAR / RESET */}
            <button
              type="button"
              title="Reset / Clear Chat"
              onClick={() => handleBtn(onClearActiveChat || onDeleteLast, 'glitch')}
              className="bg-[#ffcc00] rounded-t-md shadow-[0_3px_0_#b38f00] active:translate-y-0.5 active:shadow-none hover:brightness-110 flex flex-col items-center justify-center border-x-2 border-t-2 border-[#b38f00] z-10 group"
            >
              <div className="w-0 h-0 border-l-[4px] border-r-[4px] border-b-[6px] border-l-transparent border-r-transparent border-b-[#2d482e] group-hover:scale-125 transition-transform"></div>
            </button>
            <div></div>

            {/* LEFT: UPLOAD */}
            <button
              type="button"
              title="Upload File"
              onClick={() => handleBtn(onUploadFile, 'cartridge')}
              className="bg-[#ffcc00] rounded-l-md shadow-[-2px_2px_0_#b38f00] active:translate-x-0.5 active:shadow-none hover:brightness-110 border-y-2 border-l-2 border-[#b38f00] flex items-center justify-center z-10 group"
            >
              <div className="w-0 h-0 border-t-[4px] border-b-[4px] border-r-[6px] border-t-transparent border-b-transparent border-r-[#2d482e] group-hover:scale-125 transition-transform"></div>
            </button>

            {/* CENTER: PTT */}
            <button
              type="button"
              title="Push To Talk (Hold to Speak)"
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onTouchStart={startRecording}
              onTouchEnd={stopRecording}
              className={`border-2 border-[#b38f00] flex flex-col items-center justify-center transition-all z-20 ${
                isRecording ? 'bg-red-500 animate-pulse text-white scale-105 shadow-[0_0_8px_rgba(239,68,68,0.8)]' : 'bg-[#e6b800] text-[#2d482e] hover:bg-[#ffd633]'
              }`}
            >
              <Mic size={13} className={isRecording ? 'animate-bounce text-white' : 'text-[#2d482e]'} />
              <span className="text-[5px] font-black bmo-font leading-none mt-0.5">PTT</span>
            </button>

            {/* RIGHT: SEND */}
            <button
              type="button"
              title="Send Message"
              onClick={() => handleBtn(onSend, 'beep')}
              className="bg-[#ffcc00] rounded-r-md shadow-[2px_2px_0_#b38f00] active:-translate-x-0.5 active:shadow-none hover:brightness-110 border-y-2 border-r-2 border-[#b38f00] flex items-center justify-center z-10 group"
            >
              <div className="w-0 h-0 border-t-[4px] border-b-[4px] border-l-[6px] border-t-transparent border-b-transparent border-l-[#2d482e] group-hover:scale-125 transition-transform"></div>
            </button>

            <div></div>
            {/* DOWN: UNDO */}
            <button
              type="button"
              title="Undo / Delete Last Message"
              onClick={() => handleBtn(onDeleteLast, 'click')}
              className="bg-[#ffcc00] rounded-b-md shadow-[0_3px_0_#b38f00] active:-translate-y-0.5 active:shadow-none hover:brightness-110 border-x-2 border-b-2 border-[#b38f00] flex flex-col items-center justify-center z-10 group"
            >
              <div className="w-0 h-0 border-l-[4px] border-r-[4px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#2d482e] group-hover:scale-125 transition-transform"></div>
            </button>
            <div></div>
          </div>

          {/* RIGHT LABEL */}
          <div className="text-[9px] font-black label-font text-black tracking-wider uppercase text-left leading-none w-8">
            SEND
          </div>
        </div>

        {/* DOWN LABEL */}
        <div className="mt-1 text-[9px] font-black label-font text-black tracking-wider uppercase text-center leading-none">
          UNDO
        </div>
      </div>

      {/* Action Buttons A & B with crisp labels underneath */}
      <div className="flex gap-3 sm:gap-5 items-start">
        {/* Green Button A */}
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            title="Camera / Vision Upload"
            onClick={() => handleBtn(onOpenCamera, 'cartridge')}
            className="w-11 h-11 sm:w-13 sm:h-13 rounded-full bg-[#34c759] shadow-[0_4px_0_#1e7b36] border-2 border-[#1e7b36] active:translate-y-[4px] active:shadow-none hover:brightness-110 transition-all flex items-center justify-center"
          >
            <span className="font-bold text-white text-xs sm:text-sm bmo-font drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">A</span>
          </button>
          <span className="text-[9px] font-black label-font text-green-900 tracking-wider uppercase">CAM</span>
        </div>

        {/* Red Button B */}
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            title="Send Message"
            onClick={() => handleBtn(onSend, 'beep')}
            className="w-11 h-11 sm:w-13 sm:h-13 rounded-full bg-[#ff3b30] shadow-[0_4px_0_#99231d] border-2 border-[#99231d] active:translate-y-[4px] active:shadow-none hover:brightness-110 transition-all flex items-center justify-center"
          >
            <span className="font-bold text-white text-xs sm:text-sm bmo-font drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">B</span>
          </button>
          <span className="text-[9px] font-black label-font text-red-900 tracking-wider uppercase">SEND</span>
        </div>
      </div>
    </div>
  );
};

export default HardwareControls;

