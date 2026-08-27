import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Brain, Cloud, MessageSquare, Zap, Check, Layers, Undo2 } from 'lucide-react';
import { getApiUrl, getApiToken } from '../utils/api';
import { playClick, playChime } from '../utils/soundEffects';
import { notify, appIsBackgrounded } from '../utils/notifications';

/**
 * Controls how much BMO thinks and speaks on its own.
 *
 * Kept in its own component because these settings have real consequences —
 * escalation sends your conversation to Google and costs money — so they get room
 * to explain themselves rather than being three more unlabeled toggles.
 */
const AutonomyPanel = () => {
  const [data, setData] = useState(null);
  const [dream, setDream] = useState(null);
  const [busy, setBusy] = useState(false);
  const [memo, setMemo] = useState(null);
  const [showFacts, setShowFacts] = useState(false);
  const notifiedEscalationRef = useRef(null);

  const authFetch = useCallback((path, opts = {}) =>
    fetch(`${getApiUrl()}${path}`, {
      ...opts,
      headers: {
        "Authorization": `Bearer ${getApiToken()}`,
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    }), []);

  const refresh = useCallback(async () => {
    try {
      const [a, d, m] = await Promise.all([
        authFetch('/v1/autonomy').then(r => r.ok ? r.json() : null),
        authFetch('/v1/dream/status').then(r => r.ok ? r.json() : null),
        authFetch('/v1/memory').then(r => r.ok ? r.json() : null),
      ]);
      // A pending escalation is BMO blocked waiting on you, so it's worth a notification
      // — but only once per request, not on every 10s poll.
      if (a?.escalation_pending && appIsBackgrounded()
          && notifiedEscalationRef.current !== a.escalation_pending.at) {
        notifiedEscalationRef.current = a.escalation_pending.at;
        notify({
          id: Date.now(),
          title: 'BMO wants cloud help',
          body: `"${a.escalation_pending.reason}" — tap to approve in Settings.`,
        });
      }
      if (a) setData(a);
      if (d) setDream(d);
      if (m) setMemo(m);
    } catch { /* offline — panel just shows stale values */ }
  }, [authFetch]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [refresh]);

  const patch = async (body) => {
    playClick();
    setBusy(true);
    try {
      const res = await authFetch('/v1/autonomy', { method: 'POST', body: JSON.stringify(body) });
      if (res.ok) setData(await res.json());
    } finally { setBusy(false); }
  };

  const dreamNow = async () => {
    playChime();
    setBusy(true);
    setDream(d => ({ ...(d || {}), status: 'dreaming', running: true }));
    try {
      await authFetch('/v1/dream/now', { method: 'POST' });
    } finally { setBusy(false); refresh(); }
  };

  const consolidate = async () => {
    playChime();
    setBusy(true);
    try {
      const res = await authFetch('/v1/memory/consolidate?force=true', { method: 'POST' });
      const out = await res.json();
      if (out.status === 'rejected') {
        // The server refuses implausible merges rather than wrecking memory — say so
        // instead of silently appearing to do nothing.
        window.alert(`Consolidation rejected: ${out.reason}. Memory left untouched.`);
      }
    } finally { setBusy(false); refresh(); }
  };

  const restoreMemory = async () => {
    if (!window.confirm('Undo the last consolidation and restore the previous facts?')) return;
    playClick();
    setBusy(true);
    try { await authFetch('/v1/memory/restore', { method: 'POST' }); }
    finally { setBusy(false); refresh(); }
  };

  const approveEscalation = async () => {
    playChime();
    setBusy(true);
    try {
      await authFetch('/v1/autonomy/approve-escalation', { method: 'POST' });
    } finally { setBusy(false); refresh(); }
  };

  // Don't just vanish when the server is unreachable — a settings section that silently
  // disappears reads as a broken build rather than an offline link.
  if (!data) {
    return (
      <div className="border-t-2 border-[#2d482e] pt-3 flex flex-col gap-1">
        <div className="text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5 border-b border-[#2d482e]/30 pb-1">
          <Brain size={12} /> AUTONOMY
        </div>
        <div className="text-[7px] opacity-60 py-2 text-center">
          Needs a live link to BMO — check the server address above.
        </div>
      </div>
    );
  }

  const Seg = ({ value, current, onPick, label, hint }) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => onPick(value)}
      title={hint}
      className={`flex-1 py-1.5 text-[7px] font-bold uppercase border-2 border-[#2d482e] transition-all disabled:opacity-50 ${
        current === value ? 'bg-[#007aff] text-white' : 'bg-[#9fc28e] text-[#2d482e]'
      }`}
    >
      {label}
    </button>
  );

  const pct = data.escalation_budget
    ? Math.min(100, (data.escalation_used_today / data.escalation_budget) * 100) : 0;

  return (
    <div className="border-t-2 border-[#2d482e] pt-3 flex flex-col gap-3">
      <div className="text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5 border-b border-[#2d482e]/30 pb-1">
        <Brain size={12} /> AUTONOMY
      </div>

      {/* Pending cloud request — the advisor-style checkpoint. */}
      {data.escalation_pending && (
        <div className="bg-[#ffcc00] border-2 border-[#2d482e] rounded p-2 flex flex-col gap-1.5">
          <div className="text-[8px] font-bold text-[#2d482e]">
            BMO WANTS CLOUD HELP
          </div>
          <div className="text-[7px] text-[#2d482e] opacity-80">
            &ldquo;{data.escalation_pending.reason}&rdquo; · would send {data.escalation_pending.chars} chars
          </div>
          <button
            type="button" disabled={busy} onClick={approveEscalation}
            className="w-full py-1.5 bg-[#007aff] text-white border-2 border-[#2d482e] rounded text-[8px] font-bold uppercase disabled:opacity-50"
          >
            <Check size={10} className="inline mr-1" /> ALLOW THIS ONCE
          </button>
        </div>
      )}

      {/* Cloud escalation mode */}
      <div className="flex flex-col gap-1">
        <div className="text-[8px] font-bold flex items-center gap-1">
          <Cloud size={10} /> CLOUD ESCALATION
        </div>
        <div className="text-[6px] opacity-60 mb-0.5">
          {data.cloud_available
            ? 'BMO may ask a bigger brain when a thought needs one'
            : 'No Gemini key set — local only'}
        </div>
        <div className="flex gap-0 rounded overflow-hidden">
          <Seg value="off"  current={data.escalation_mode} onPick={v => patch({ escalation_mode: v })} label="OFF"  hint="Never leaves the device" />
          <Seg value="ask"  current={data.escalation_mode} onPick={v => patch({ escalation_mode: v })} label="ASK"  hint="BMO asks first, one approval at a time" />
          <Seg value="auto" current={data.escalation_mode} onPick={v => patch({ escalation_mode: v })} label="AUTO" hint="Escalates freely within the daily budget" />
        </div>
        {data.escalation_mode !== 'off' && (
          <>
            <div className="flex justify-between items-center text-[6px] mt-1">
              <span className="opacity-70">TODAY: {data.escalation_used_today} / {data.escalation_budget}</span>
              <span className="opacity-70">DAILY BUDGET</span>
            </div>
            <div className="w-full bg-[#2d482e]/20 h-1 rounded overflow-hidden">
              <div className={`h-full transition-all ${pct > 80 ? 'bg-red-500' : 'bg-[#007aff]'}`} style={{ width: `${pct}%` }} />
            </div>
            <input
              type="range" min="0" max="100" step="5"
              value={data.escalation_budget}
              onChange={(e) => patch({ escalation_budget: parseInt(e.target.value, 10) })}
              className="w-full mt-1"
            />
          </>
        )}
      </div>

      {/* Proactive */}
      <div className="flex flex-col gap-1">
        <div className="text-[8px] font-bold flex items-center gap-1">
          <MessageSquare size={10} /> SPEAKS UP
        </div>
        <div className="text-[6px] opacity-60 mb-0.5">How much BMO says without being asked</div>
        <div className="flex gap-0 rounded overflow-hidden">
          <Seg value="off"  current={data.proactive_mode} onPick={v => patch({ proactive_mode: v })} label="SILENT" hint="Learns quietly, never volunteers anything" />
          <Seg value="note" current={data.proactive_mode} onPick={v => patch({ proactive_mode: v })} label="NOTES"  hint="Leaves a short note about what it learned" />
          <Seg value="full" current={data.proactive_mode} onPick={v => patch({ proactive_mode: v })} label="FULL"   hint="May also follow up with questions or suggestions" />
        </div>
      </div>

      {/* Memory depth */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between items-center text-[8px] font-bold">
          <span>MEMORY DEPTH</span>
          <span className="bg-[#2d482e] text-[#b5d6a7] px-2 py-0.5 rounded font-mono text-[7px]">
            {data.memory_facts} / {data.memory_facts_available}
          </span>
        </div>
        <div className="text-[6px] opacity-60">
          Learned facts given to BMO each message. ~30 tokens each — SOUL.md alone costs ~960.
        </div>
        <input
          type="range" min="0" max="60" step="5"
          value={data.memory_facts}
          onChange={(e) => patch({ memory_facts: parseInt(e.target.value, 10) })}
          className="w-full"
        />
      </div>

      {/* Memory: what BMO knows, and tidying it */}
      {memo && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between items-center text-[8px] font-bold">
            <span className="flex items-center gap-1"><Layers size={10} /> STORED MEMORY</span>
            <span className="bg-[#2d482e] text-[#b5d6a7] px-2 py-0.5 rounded font-mono text-[7px]">
              {memo.count} FACTS
            </span>
          </div>
          <div className="text-[6px] opacity-60">
            Merges into fewer, denser facts automatically past {memo.consolidate_at}.
          </div>
          <div className="flex gap-1">
            <button
              type="button" disabled={busy || memo.count < 2} onClick={consolidate}
              className="flex-1 py-1.5 bg-[#7ba068] text-white border-2 border-[#2d482e] rounded text-[7px] font-bold uppercase disabled:opacity-50"
            >
              CONSOLIDATE NOW
            </button>
            <button
              type="button" disabled={busy} onClick={restoreMemory} title="Undo the last consolidation"
              className="px-2 py-1.5 bg-[#ffcc00] text-[#2d482e] border-2 border-[#2d482e] rounded text-[7px] font-bold uppercase disabled:opacity-50"
            >
              <Undo2 size={10} />
            </button>
          </div>
          <button
            type="button" onClick={() => { playClick(); setShowFacts(v => !v); }}
            className="text-[6px] opacity-70 uppercase tracking-widest text-left mt-0.5"
          >
            {showFacts ? '▾ hide' : '▸ show'} what BMO remembers
          </button>
          {showFacts && (
            <div className="max-h-40 overflow-y-auto bg-[#9fc28e] border-2 border-[#2d482e] rounded p-1.5 flex flex-col gap-1">
              {memo.facts.length === 0 && (
                <div className="text-[7px] opacity-60 italic">Nothing learned yet.</div>
              )}
              {memo.facts.map(f => (
                <div key={f.id} className="text-[7px] text-[#2d482e] leading-snug border-b border-[#2d482e]/10 pb-1 last:border-0">
                  {f.content}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dream state + manual trigger */}
      {dream && (
        <div className="bg-[#9fc28e] border-2 border-[#2d482e] rounded p-2 flex flex-col gap-1 text-[7px] text-[#2d482e]">
          <div className="flex justify-between">
            <span className="opacity-70">DREAM STATE:</span>
            <span className="font-mono font-bold uppercase">
              {dream.running ? 'DREAMING…' : dream.status}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="opacity-70">IDLE FOR:</span>
            <span className="font-mono">{Math.round(dream.idle_seconds)}s</span>
          </div>
          <div className="flex justify-between">
            <span className="opacity-70">NEXT DREAM IN:</span>
            <span className="font-mono">{Math.round(dream.eligible_in_seconds)}s</span>
          </div>
          {dream.aborted_count > 0 && (
            <div className="flex justify-between">
              <span className="opacity-70">ABORTED (you returned):</span>
              <span className="font-mono">{dream.aborted_count}</span>
            </div>
          )}
          {dream.last_summary && (
            <div className="border-t border-[#2d482e]/20 pt-1 mt-0.5 italic opacity-80">
              LAST LEARNED: {dream.last_summary}
            </div>
          )}
          <button
            type="button" disabled={busy || dream.running} onClick={dreamNow}
            className="w-full mt-1 py-1.5 bg-[#007aff] text-white border-2 border-[#2d482e] rounded text-[8px] font-bold uppercase disabled:opacity-50"
          >
            <Zap size={10} className="inline mr-1" /> {dream.running ? 'DREAMING…' : 'DREAM NOW'}
          </button>
        </div>
      )}

      {/* What BMO actually sent to the cloud — auditable, not just trusted. */}
      {data.escalation_log?.length > 0 && (
        <details className="text-[7px]">
          <summary className="cursor-pointer opacity-70 uppercase tracking-widest">
            Cloud activity ({data.escalation_log.length})
          </summary>
          <div className="mt-1 flex flex-col gap-0.5 font-mono opacity-80">
            {data.escalation_log.map((e, i) => (
              <div key={i} className="flex justify-between gap-2">
                <span>{e.at} {e.reason}</span>
                <span className="shrink-0">{e.chars_sent}c</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

export default AutonomyPanel;
