import React, { useState } from 'react';
import { Settings, CheckCircle, XCircle, Loader2, Play, Square, FileText, Image as ImageIcon, StopCircle } from 'lucide-react';

const ChatFeed = ({ messages, currentUser, activeChatId, useCrtFilter, tts, speakingMsgId, setSpeakingMsgId, getApiUrl, getApiToken }) => {
  const [expandedToolId, setExpandedToolId] = useState(null);

  const handleApproval = async (approved) => {
    try {
      const apiUrl = getApiUrl();
      const apiToken = getApiToken();
      const endpoint = approved ? 'approve' : 'reject';
      
      const response = await fetch(`${apiUrl}/v1/${endpoint}`, {
        method: 'POST',
        headers: { "Authorization": `Bearer ${apiToken}` }
      });
      
      if (!response.ok) throw new Error("Approval failed");
    } catch (err) {
      console.error("Sentinel action failed:", err);
    }
  };

  const parseToolCall = (text) => {
    if (!text || typeof text !== 'string' || !text.trim().startsWith('{')) return null;
    try {
      const parsed = JSON.parse(text);
      // Logic for tool_call format from loop directives
      if (parsed && (parsed.tool || parsed.tool_call)) {
        return {
          id: parsed.id || Math.random().toString(),
          tool: parsed.tool || parsed.tool_call,
          action: parsed.action || 'executing',
          status: parsed.status || 'success', // amber, blue, green, red
          stdout: parsed.stdout || '',
          pending_approval: parsed.pending_approval || false,
          diff: parsed.diff || null
        };
      }
    } catch {
      // not JSON
    }
    return null;
  };

  const DiffViewer = ({ diff, onApprove, onReject }) => (
    <div className="mt-2 flex flex-col gap-2 w-full">
      <div className="p-2 bg-[#1a2e1d] border-2 border-[#2d482e] rounded-lg font-mono text-[6px] text-green-400 overflow-x-auto max-h-40">
        <div className="border-b border-green-900 pb-1 mb-1 opacity-50 flex justify-between">
          <span>PROPOSED_CHANGES.diff</span>
          <span>PATCH_V1</span>
        </div>
        <pre className="whitespace-pre-wrap">{diff}</pre>
      </div>
      <div className="flex gap-2">
        <button 
          type="button"
          onClick={onApprove}
          className="flex-1 py-2 bg-green-600 text-white rounded border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] font-bold text-[8px] active:translate-y-[1px] active:shadow-none transition-all uppercase"
        >
          [APPROVE & MERGE]
        </button>
        <button 
          type="button"
          onClick={onReject}
          className="flex-1 py-2 bg-red-600 text-white rounded border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] font-bold text-[8px] active:translate-y-[1px] active:shadow-none transition-all uppercase"
        >
          [REJECT]
        </button>
      </div>
    </div>
  );

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'bg-amber-500';
      case 'executing': return 'bg-blue-500 animate-pulse';
      case 'success': return 'bg-green-500';
      case 'error':
      case 'failed': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'executing': return <Loader2 size={12} className="animate-spin" />;
      case 'success': return <CheckCircle size={12} />;
      case 'error':
      case 'failed': return <XCircle size={12} />;
      default: return <Settings size={12} />;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
      {messages.length === 0 ? (
        <div className="text-center text-[#2d482e] opacity-50 mt-10">
          NO MESSAGES YET.
        </div>
      ) : (
        messages.map((msg) => {
          const toolData = msg.sender === 'bmo' ? parseToolCall(msg.text) : null;
          
          return (
            <div 
              key={msg.id} 
              className={`flex flex-col max-w-[85%] ${msg.sender === 'user' ? 'self-end items-end' : 'self-start items-start'}`}
            >
              {toolData ? (
                /* --- Loop 2: Interactive Tool Trace Badge --- */
                <div className="flex flex-col gap-1 w-full">
                  <button 
                    type="button"
                    onClick={() => setExpandedToolId(expandedToolId === msg.id ? null : msg.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-[#2d482e] text-white text-[8px] font-mono shadow-[2px_2px_0_#2d482e] transition-all active:translate-y-[1px] active:shadow-none ${getStatusColor(toolData.status)}`}
                  >
                    {getStatusIcon(toolData.status)}
                    <span className="font-bold uppercase">TOOL: {toolData.tool}</span>
                    <span className="opacity-70 ml-auto">{toolData.status.toUpperCase()}</span>
                  </button>
                  
                  {expandedToolId === msg.id && toolData.stdout && (
                    <div className="mt-1 p-2 bg-black border-2 border-[#2d482e] rounded-lg text-[8px] font-mono text-green-400 overflow-x-auto max-h-32 shadow-inner">
                      <div className="opacity-50 mb-1 border-b border-green-900 pb-1 flex justify-between">
                        <span>STDOUT_STREAM</span>
                        <span>{toolData.tool}.log</span>
                      </div>
                      <pre className="whitespace-pre-wrap">{toolData.stdout}</pre>
                    </div>
                  )}

                  {toolData.pending_approval && toolData.diff && (
                    <DiffViewer 
                      diff={toolData.diff} 
                      onApprove={() => handleApproval(true)}
                      onReject={() => handleApproval(false)}
                    />
                  )}
                </div>
              ) : (
                <div 
                  className={`p-2 sm:p-3 rounded-lg border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] ${
                    msg.sender === 'user' 
                      ? 'bg-[#cbe3c0] text-[#2d482e]' 
                      : 'bg-[#7ba068] text-white'
                  }`}
                >
                  {/* File Rendering as "Cartridge" (Loop 2) */}
                  {msg.type === 'file' && (
                    <div className="flex flex-col items-center gap-2 mb-2 p-3 bg-[#2d482e] border-4 border-yellow-600 rounded-lg text-white shadow-lg transform rotate-2">
                       <div className="w-10 h-1 bg-yellow-600 rounded-full mb-1"></div>
                       <FileText size={24} className="text-yellow-400" />
                       <span className="text-[8px] font-bold bmo-font truncate max-w-[120px] uppercase">{msg.fileName}</span>
                       <div className="text-[6px] opacity-60">SYSTEM CARTRIDGE</div>
                    </div>
                  )}
                  
                  {/* Image Rendering */}
                  {msg.type === 'image' && (
                    <div className="relative overflow-hidden rounded-lg mb-2">
                      <img 
                        src={msg.imageUrl} 
                        alt="User attachment" 
                        className={`max-w-full h-auto ${useCrtFilter ? 'bmo-vision' : 'real-vision'}`}
                      />
                      {useCrtFilter && (
                        <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%),linear-gradient(90deg,rgba(255,0,0,0.03),rgba(0,255,0,0.01),rgba(0,0,255,0.03))] bg-[length:100%_2px,3px_100%]"></div>
                      )}
                    </div>
                  )}
                  
                  {msg.text && <p className="leading-relaxed" style={{ wordBreak: 'break-word' }}>{msg.text}</p>}
                </div>
              )}

              <span className="text-[8px] text-[#2d482e] mt-1 opacity-70">
                {msg.sender === 'user' ? currentUser.toUpperCase() : 'BMO'}
              </span>

              {/* TTS Controls */}
              {msg.sender === 'bmo' && !toolData && speakingMsgId === msg.id && (
                <div className="flex gap-2 mt-1">
                  {tts.isPaused ? (
                    <button
                      type="button"
                      onClick={tts.resume}
                      className="flex items-center gap-1 px-2 py-1 text-[8px] bg-[#007aff] text-white border border-[#2d482e] rounded shadow-[1px_1px_0_#2d482e]"
                    >
                      <Play size={8} fill="currentColor" /> PLAY
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={tts.pause}
                      className="flex items-center gap-1 px-2 py-1 text-[8px] bg-[#ffcc00] text-[#2d482e] border border-[#2d482e] rounded shadow-[1px_1px_0_#2d482e]"
                    >
                      <Square size={8} fill="currentColor" /> PAUSE
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { tts.stop(); setSpeakingMsgId(null); }}
                    className="flex items-center gap-1 px-2 py-1 text-[8px] bg-[#ff3b30] text-white border border-[#2d482e] rounded shadow-[1px_1px_0_#2d482e]"
                  >
                    <StopCircle size={8} /> STOP
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default ChatFeed;
