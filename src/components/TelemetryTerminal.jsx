import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, ChevronDown, Trash2, Cpu, Activity, Database } from 'lucide-react';
import { getApiUrl, getApiToken } from '../utils/api';
import { connectBmoSocket, subscribeBmoSocket, subscribeBmoSocketStatus, isBmoSocketOpen } from '../utils/bmoSocket';

const TelemetryTerminal = () => {
  const [lines, setLines] = useState([]);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [metrics, setMetrics] = useState({ cpu: 0, ram: 0, task: 'IDLE', disk: 0 });
  const scrollRef = useRef(null);

  // Minimal ANSI parser for colors
  const parseAnsi = (text) => {
    if (typeof text !== 'string') return text;
    // eslint-disable-next-line no-control-regex -- matches real ANSI escape sequences from the backend log stream
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

  // Live telemetry/metrics arrive over the shared /v1/ws socket (see utils/bmoSocket.js).
  // If the socket hasn't connected within a few seconds — e.g. a proxy blocks WS — this
  // falls back to the old HTTP polling so the terminal still works somewhere.
  useEffect(() => {
    let fallbackLines = null;
    let fallbackMetrics = null;
    const apiUrl = getApiUrl();
    const apiToken = getApiToken();

    const fetchTelemetry = async () => {
      try {
        const response = await fetch(`${apiUrl}/v1/telemetry`, {
          headers: { 'Authorization': `Bearer ${apiToken}` }
        });
        const data = await response.json();
        if (data.lines) setLines(data.lines);
      } catch {
        // Next poll retries.
      }
    };

    const fetchMetrics = async () => {
      try {
        const response = await fetch(`${apiUrl}/v1/system/metrics`, {
          headers: { 'Authorization': `Bearer ${apiToken}` }
        });
        setMetrics(await response.json());
      } catch {
        // Next poll retries.
      }
    };

    const startFallbackPolling = () => {
      if (fallbackLines) return;
      fetchTelemetry();
      fetchMetrics();
      fallbackLines = setInterval(fetchTelemetry, 1500);
      fallbackMetrics = setInterval(fetchMetrics, 2500);
    };
    const stopFallbackPolling = () => {
      clearInterval(fallbackLines);
      clearInterval(fallbackMetrics);
      fallbackLines = null;
      fallbackMetrics = null;
    };

    connectBmoSocket();

    const unsubMessages = subscribeBmoSocket((msg) => {
      if (msg.type === 'snapshot') {
        setLines(msg.lines || []);
        setMetrics(msg.metrics || {});
      } else if (msg.type === 'metrics') {
        const { type: _type, ...rest } = msg;
        setMetrics(rest);
      } else if (msg.type === 'log') {
        setLines(prev => {
          const next = [...prev, msg.line];
          return next.length > 500 ? next.slice(-500) : next;
        });
      }
      // {tool:'sentinel', ...} approval events are handled by App.jsx's own subscription.
    });

    const unsubStatus = subscribeBmoSocketStatus((status) => {
      setIsConnected(status === 'connected');
      if (status === 'connected') stopFallbackPolling();
    });

    const fallbackTimer = setTimeout(() => {
      if (!isBmoSocketOpen()) startFallbackPolling();
    }, 8000);

    return () => {
      unsubMessages();
      unsubStatus();
      stopFallbackPolling();
      clearTimeout(fallbackTimer);
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current && !isAutoScrollPaused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isAutoScrollPaused]);

  useEffect(() => { scrollToBottom(); }, [lines, scrollToBottom]);

  return (
    <div className="flex flex-col h-full bg-[#1a2e1d] border-4 border-[#2d482e] rounded-[12px] overflow-hidden shadow-[inset_0_4px_10px_rgba(0,0,0,0.6)]">
      {/* BMO STATUS BAR (Phase 6) */}
      <div className="bg-[#2d482e] p-2 grid grid-cols-4 gap-2 border-b-2 border-[#b5d6a7]/20 text-[6px] bmo-font text-[#b5d6a7]">
        <div className="flex items-center gap-1"><Cpu size={10} /> {metrics.cpu}%</div>
        <div className="flex items-center gap-1"><Activity size={10} /> {metrics.ram}%</div>
        <div className="flex items-center gap-1"><Database size={10} /> {metrics.disk}%</div>
        <div className="truncate text-yellow-400">[{metrics.task}]</div>
      </div>

      {/* CONTEXT WINDOW METER */}
      <div className="bg-[#142316] px-2 py-1.5 border-b-2 border-[#2d482e] text-[6px] bmo-font flex flex-col gap-1 text-[#b5d6a7]">
        <div className="flex justify-between items-center">
          <span>CONTEXT WINDOW: {metrics.context_tokens || 0} / {metrics.context_limit || 8192} TOKENS</span>
          <span className={(metrics.context_percent || 0) > 80 ? "text-red-400" : "text-green-400"}>{metrics.context_percent || 0}%</span>
        </div>
        <div className="w-full bg-[#2d482e] h-1.5 rounded-full overflow-hidden border border-[#b5d6a7]/20">
          <div 
            className={`h-full transition-all duration-300 ${(metrics.context_percent || 0) > 80 ? 'bg-red-500' : (metrics.context_percent || 0) > 50 ? 'bg-amber-400' : 'bg-green-400'}`}
            style={{ width: `${Math.min(100, metrics.context_percent || 0)}%` }}
          />
        </div>
      </div>

      {/* Terminal Header */}
      <div className="bg-[#2d482e] p-2 flex justify-between items-center text-[8px] bmo-font text-[#b5d6a7]">
        <div className="flex items-center gap-2">
          <Terminal size={12} />
          <span>BMO_OS_v2.0</span>
          <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
        </div>
        <button type="button" onClick={() => setLines([])}><Trash2 size={12} /></button>
      </div>

      {/* Terminal Content */}
      <div 
        ref={scrollRef}
        onScroll={(e) => {
          const { scrollTop, scrollHeight, clientHeight } = e.target;
          setIsAutoScrollPaused(scrollHeight - scrollTop - clientHeight > 50);
        }}
        className="flex-1 overflow-y-auto p-3 font-mono text-[9px] leading-tight break-all scroll-smooth custom-scrollbar"
      >
        {lines.map((line, i) => (
          <div key={i} className="mb-1">
            <span className="text-gray-600 mr-2 opacity-50">[{new Date().toLocaleTimeString([], {hour12: false, minute:'2-digit', second:'2-digit'})}]</span>
            {parseAnsi(line)}
          </div>
        ))}
        {lines.length === 0 && <div className="text-green-900 opacity-20 text-center mt-10 bmo-font">LINKING...</div>}
      </div>

      {/* Snap Button */}
      {isAutoScrollPaused && (
        <button onClick={() => setIsAutoScrollPaused(false)} className="absolute bottom-12 right-6 bg-[#7ba068] text-white p-1.5 rounded-full shadow-lg border-2 border-[#2d482e] animate-bounce">
          <ChevronDown size={14} />
        </button>
      )}
    </div>
  );
};

export default TelemetryTerminal;
