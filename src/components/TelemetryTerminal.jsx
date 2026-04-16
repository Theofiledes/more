import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, ChevronDown, Trash2 } from 'lucide-react';

const TelemetryTerminal = () => {
  const [lines, setLines] = useState([]);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const scrollRef = useRef(null);
  const wsRef = useRef(null);

  // Minimal ANSI parser for colors
  const parseAnsi = (text) => {
    const parts = text.split(/(\u001b\[[0-9;]*m)/);
    let currentColor = 'text-gray-300';
    
    return parts.map((part, index) => {
      if (part.startsWith('\u001b[')) {
        if (part === '\u001b[0m') currentColor = 'text-gray-300';
        else if (part.includes('31m')) currentColor = 'text-red-400';
        else if (part.includes('32m')) currentColor = 'text-green-400';
        else if (part.includes('33m')) currentColor = 'text-yellow-400';
        else if (part.includes('34m')) currentColor = 'text-blue-400';
        else if (part.includes('35m')) currentColor = 'text-purple-400';
        else if (part.includes('36m')) currentColor = 'text-cyan-400';
        return null;
      }
      return <span key={index} className={currentColor}>{part}</span>;
    }).filter(p => p !== null);
  };

  useEffect(() => {
    let pollInterval;
    
    const fetchTelemetry = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_OPENCLAW_API_URL}/v1/telemetry`, {
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_OPENCLAW_API_KEY}`
          }
        });
        const data = await response.json();
        if (data.lines) {
          setLines(data.lines);
          setIsConnected(true);
        }
      } catch (err) {
        setIsConnected(false);
      }
    };

    fetchTelemetry();
    pollInterval = setInterval(fetchTelemetry, 3000); // 3s polling
    
    return () => clearInterval(pollInterval);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current && !isAutoScrollPaused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isAutoScrollPaused]);

  useEffect(() => {
    scrollToBottom();
  }, [lines, scrollToBottom]);

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsAutoScrollPaused(!isAtBottom);
  };

  return (
    <div className="flex flex-col h-full bg-[#1a2e1d] border-4 border-[#2d482e] rounded-[12px] overflow-hidden shadow-[inset_0_4px_10px_rgba(0,0,0,0.6)]">
      {/* Terminal Header */}
      <div className="bg-[#2d482e] p-2 flex justify-between items-center text-[10px] bmo-font text-[#b5d6a7]">
        <div className="flex items-center gap-2">
          <Terminal size={14} />
          <span>BMO_OS TELEMETRY</span>
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setLines([])} title="Clear Terminal">
            <Trash2 size={12} className="hover:text-red-400" />
          </button>
        </div>
      </div>

      {/* Terminal Content */}
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 font-mono text-[10px] leading-relaxed break-all scroll-smooth"
      >
        {lines.map((line, i) => (
          <div key={i} className="mb-1">
            <span className="text-gray-600 mr-2">[{new Date().toLocaleTimeString([], {hour12: false})}]</span>
            {parseAnsi(line)}
          </div>
        ))}
        {lines.length === 0 && (
          <div className="text-green-900 opacity-30 text-center mt-20 bmo-font">
            WAITING FOR KERNEL DATA...
          </div>
        )}
      </div>

      {/* Snap to Bottom Button */}
      {isAutoScrollPaused && (
        <button 
          onClick={() => setIsAutoScrollPaused(false)}
          className="absolute bottom-16 right-8 bg-[#7ba068] text-white p-2 rounded-full shadow-lg flex items-center gap-2 text-[10px] bmo-font animate-bounce border-2 border-[#2d482e]"
        >
          <ChevronDown size={14} />
          SNAP TO BOTTOM
        </button>
      )}

      {/* Footer / Status */}
      <div className="bg-[#2d482e]/30 p-1 text-[8px] text-[#b5d6a7] px-3 flex justify-between">
        <span>MEM_FREE: 1.8GB</span>
        <span>BUFFER: {lines.length}/1000</span>
      </div>
    </div>
  );
};

export default TelemetryTerminal;
