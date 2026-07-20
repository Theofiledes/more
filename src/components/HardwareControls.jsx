import React, { useState, useRef } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Mic } from 'lucide-react';

const HardwareControls = ({ onSend, onUploadFile, onOpenCamera, onDeleteLast, onStopTTS }) => {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const triggerHaptic = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (e) { }
  };

  const startRecording = async () => {
    onStopTTS();
    triggerHaptic();
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
    }
  };

  const handleBtn = (action) => {
    triggerHaptic();
    action();
  };

  return (
    <div className="h-28 mt-4 flex justify-between items-center px-2 sm:px-6 relative select-none">
      
      {/* Functional D-Pad with Labels */}
      <div className="grid grid-cols-3 grid-rows-3 w-[72px] h-[72px] sm:w-[84px] sm:h-[84px] gap-0 relative">
        <div className="absolute -top-6 left-0 label-font transform -rotate-12 whitespace-nowrap text-black font-black">UPLOAD</div>
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 label-font text-black font-black">PTT</div>
        <div className="absolute -top-6 right-0 label-font transform rotate-12 whitespace-nowrap text-black font-black">SEND</div>
        
        <div></div>
        {/* UP: Unused */}
        <button type="button" onClick={() => triggerHaptic()} className="bg-[#ffcc00] rounded-t-md shadow-[0_4px_0_rgba(0,0,0,0.2)] active:translate-y-1 hover:brightness-110 flex items-center justify-center border-x-2 border-t-2 border-yellow-700 pb-1">
          <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-b-[8px] border-l-transparent border-r-transparent border-b-yellow-800"></div>
        </button>
        <div></div>
        
        {/* LEFT: Upload File */}
        <button type="button" onClick={() => handleBtn(onUploadFile)} className="bg-[#ffcc00] rounded-l-md shadow-[2px_4px_0_rgba(0,0,0,0.2)] active:translate-y-1 hover:brightness-110 border-y-2 border-l-2 border-yellow-700 flex items-center justify-center">
          <div className="w-0 h-0 border-t-[6px] border-b-[6px] border-r-[8px] border-t-transparent border-b-transparent border-r-yellow-800"></div>
        </button>
        
        {/* CENTER: PTT (Push-to-Talk) */}
        <button type="button" onMouseDown={startRecording} onMouseUp={stopRecording} onTouchStart={startRecording} onTouchEnd={stopRecording} className={`border-2 border-yellow-700 flex items-center justify-center transition-colors ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-[#e6b800]'}`}>
          {isRecording ? <Mic size={14} className="text-white" /> : <div className="w-3 h-3 bg-yellow-800 rounded-full opacity-50" />}
        </button>
        
        {/* RIGHT: Send Message */}
        <button type="button" onClick={() => handleBtn(onSend)} className="bg-[#ffcc00] rounded-r-md shadow-[2px_4px_0_rgba(0,0,0,0.2)] active:translate-y-1 hover:brightness-110 border-y-2 border-r-2 border-yellow-700 flex items-center justify-center pb-1">
          <div className="w-0 h-0 border-t-[6px] border-b-[6px] border-l-[8px] border-t-transparent border-b-transparent border-l-yellow-800"></div>
        </button>
        
        <div></div>
        {/* DOWN: Delete Last */}
        <button type="button" onClick={() => handleBtn(onDeleteLast)} className="bg-[#ffcc00] rounded-b-md shadow-[0_4px_0_rgba(0,0,0,0.2)] active:translate-y-1 hover:brightness-110 border-x-2 border-b-2 border-yellow-700 flex items-center justify-center">
          <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-yellow-800"></div>
        </button>
        <div></div>
      </div>
      
      {/* Action Buttons with Label */}
      <div className="flex gap-4 sm:gap-6 transform -rotate-12 translate-y-2 relative">
        <div className="absolute -bottom-6 right-2 label-font transform rotate-12 whitespace-nowrap text-black font-black">ACTION</div>
        
        {/* Green Button: Camera / Image Upload */}
        <button type="button" onClick={() => handleBtn(onOpenCamera)} className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[#34c759] shadow-[0_6px_0_#1e7b36] border-2 border-[#1e7b36] active:translate-y-[6px] active:shadow-none hover:brightness-110 transition-all flex items-center justify-center mt-6">
           <span className="font-bold text-[#1e7b36] text-xs">A</span>
        </button>
        
        {/* Red Button: Send Message */}
        <button type="button" onClick={() => handleBtn(onSend)} className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[#ff3b30] shadow-[0_6px_0_#99231d] border-2 border-[#99231d] active:translate-y-[6px] active:shadow-none hover:brightness-110 transition-all flex items-center justify-center">
           <span className="font-bold text-[#99231d] text-xs">B</span>
        </button>
      </div>
    </div>
  );
};

export default HardwareControls;
