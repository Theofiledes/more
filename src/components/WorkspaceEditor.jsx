import React, { useState, useEffect } from 'react';
import { Save, FileCode, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

const WorkspaceEditor = () => {
  const [activeFile, setActiveFile] = useState('SOUL.md');
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'success', 'error', null
  const [isLoading, setIsLoading] = useState(false);

  const files = ['SOUL.md', 'AGENTS.md', 'MEMORY.md'];

  const getApiUrl = () => {
    const envUrl = import.meta.env.VITE_OPENCLAW_API_URL;
    const isCapacitor = typeof window !== 'undefined' && !!window.Capacitor;
    const isDesktopLocal = typeof window !== 'undefined' && !window.Capacitor && 
                           (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    if (isDesktopLocal) {
      return "http://localhost:18789";
    }

    return envUrl ? envUrl.replace(/\/$/, "") : "http://100.84.254.37:18789";
  };

  const fetchFile = async (filename) => {
    setIsLoading(true);
    setSaveStatus(null);
    try {
      const apiUrl = getApiUrl();
      const apiToken = import.meta.env.VITE_OPENCLAW_API_KEY || "bmo-secret-key-2026";
      
      const response = await fetch(`${apiUrl}/v1/workspace/${filename}`, {
        headers: { "Authorization": `Bearer ${apiToken}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setContent(data.content || '');
      } else {
        setContent('Error loading file.');
      }
    } catch (err) {
      console.error("Failed to fetch workspace file:", err);
      setContent('Connection failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const saveFile = async () => {
    setIsSaving(true);
    setSaveStatus(null);
    try {
      const apiUrl = getApiUrl();
      const apiToken = import.meta.env.VITE_OPENCLAW_API_KEY || "bmo-secret-key-2026";
      
      const response = await fetch(`${apiUrl}/v1/workspace/${activeFile}`, {
        method: 'PUT',
        headers: { 
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content })
      });
      
      if (response.ok) {
        setSaveStatus('success');
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        setSaveStatus('error');
      }
    } catch (err) {
      console.error("Failed to save workspace file:", err);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    fetchFile(activeFile);
  }, [activeFile]);

  return (
    <div className="flex flex-col h-full bg-[#b5d6a7] border-4 border-[#2d482e] rounded-[12px] bmo-font text-[#2d482e] overflow-hidden">
      {/* Tab Header */}
      <div className="flex bg-[#2d482e] p-1 gap-1">
        {files.map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setActiveFile(f)}
            className={`flex-1 py-1 text-[8px] rounded border-2 border-transparent transition-all ${
              activeFile === f 
                ? 'bg-[#b5d6a7] text-[#2d482e] border-[#b5d6a7]' 
                : 'text-[#b5d6a7] hover:bg-[#1a2e1d]'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="p-2 border-b-2 border-[#2d482e] flex justify-between items-center bg-[#9fc28e]">
        <div className="flex items-center gap-2 text-[10px] font-bold">
          <FileCode size={14} /> WORKSPACE_EDITOR
        </div>
        <div className="flex items-center gap-2">
          {saveStatus === 'success' && <span className="text-[8px] text-green-700 animate-pulse flex items-center gap-1"><CheckCircle size={10}/> SAVED</span>}
          {saveStatus === 'error' && <span className="text-[8px] text-red-700 flex items-center gap-1"><AlertCircle size={10}/> FAIL</span>}
          
          <button
            type="button"
            onClick={() => fetchFile(activeFile)}
            disabled={isLoading}
            className="p-1 hover:bg-[#2d482e]/10 rounded transition-colors disabled:opacity-50"
            title="Reload File"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          
          <button
            type="button"
            onClick={saveFile}
            disabled={isSaving || isLoading}
            className={`px-3 py-1 rounded border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] text-[8px] font-bold flex items-center gap-2 transition-all active:translate-y-[1px] active:shadow-none ${
              isSaving ? 'bg-gray-400' : 'bg-[#ffcc00] hover:brightness-110'
            }`}
          >
            <Save size={12} /> {isSaving ? 'SAVING...' : 'SAVE'}
          </button>
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 relative p-2 bg-[#1a2e1d]">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={isLoading}
          spellCheck={false}
          className="w-full h-full bg-[#b5d6a7] border-2 border-[#2d482e] p-3 rounded font-mono text-[10px] leading-relaxed text-[#2d482e] resize-none focus:outline-none focus:ring-2 focus:ring-[#007aff] shadow-inner custom-scrollbar"
          placeholder="Loading brain data..."
        />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1a2e1d]/50 backdrop-blur-[1px]">
            <RefreshCw size={24} className="text-[#b5d6a7] animate-spin" />
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-1 bg-[#2d482e]/10 text-[6px] px-3 flex justify-between italic">
        <span>PATH: /workspace/{activeFile}</span>
        <span>UTF-8 ENCODED</span>
      </div>
    </div>
  );
};

export default WorkspaceEditor;
