import React, { useState } from 'react';
import { KeyRound, Loader2, Link as LinkIcon } from 'lucide-react';
import { getApiUrl, setDeviceToken } from '../utils/api';
import { playChime, playGlitch } from '../utils/soundEffects';

/**
 * Shown when this device has no pairing token and the server won't accept the
 * build-time shared key. The code comes from the server console on first run, or
 * from an already-paired device (Settings > Paired Devices > invite).
 *
 * Deliberately a plain fetch + bearer token, no redirect/cookie flow: the Android
 * build runs from https://localhost inside a WebView where those don't work.
 */
const PairingScreen = ({ onPaired }) => {
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [status, setStatus] = useState(null); // {type:'error'|'info', text}
  const [busy, setBusy] = useState(false);
  const [serverUrl, setServerUrl] = useState(() => {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem('bmo_custom_api_url') || '';
  });

  const saveServerUrl = (val) => {
    setServerUrl(val);
    if (typeof localStorage === 'undefined') return;
    if (val.trim()) localStorage.setItem('bmo_custom_api_url', val.trim().replace(/\/$/, ''));
    else localStorage.removeItem('bmo_custom_api_url');
  };

  const submit = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setStatus({ type: 'info', text: 'PAIRING...' });
    try {
      const res = await fetch(`${getApiUrl()}/v1/pair/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          device_name: deviceName.trim() || 'BMO Device',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDeviceToken(data.token);
        playChime();
        setStatus({ type: 'info', text: 'PAIRED! LINKING...' });
        onPaired?.(data);
        return;
      }
      let detail = 'Pairing failed.';
      try {
        detail = (await res.json()).detail || detail;
      } catch { /* non-JSON error body */ }
      playGlitch();
      setStatus({ type: 'error', text: detail.toUpperCase() });
    } catch {
      playGlitch();
      setStatus({ type: 'error', text: "CAN'T REACH BMO — CHECK THE SERVER ADDRESS." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-5 text-center text-[#2d482e] overflow-y-auto">
      <KeyRound size={40} className="mb-3 opacity-80" strokeWidth={2} />
      <h2 className="mb-1 text-[11px] font-bold">PAIR THIS DEVICE</h2>
      <p className="text-[8px] opacity-70 mb-4 max-w-[240px] leading-relaxed">
        BMO prints a pairing code in its server window on first run. Already have a paired
        device? Generate an invite from its Settings.
      </p>

      <div className="w-full max-w-[240px] flex flex-col gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="XXXX-XXXX"
          autoCapitalize="characters"
          className="w-full bg-[#9fc28e] border-2 border-[#2d482e] text-[#2d482e] p-3 rounded text-center tracking-[0.2em] font-mono uppercase"
        />
        <input
          type="text"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="NAME THIS DEVICE"
          className="w-full bg-[#9fc28e] border-2 border-[#2d482e] text-[#2d482e] p-2 rounded text-center text-[9px]"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !code.trim()}
          className="w-full py-3 bg-[#007aff] text-white rounded border-2 border-[#2d482e] shadow-[2px_2px_0_#2d482e] text-[9px] font-bold uppercase flex items-center justify-center gap-2 active:translate-y-[1px] active:shadow-none disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
          {busy ? 'PAIRING...' : 'PAIR DEVICE'}
        </button>

        {status && (
          <div className={`text-[8px] font-bold px-2 py-1.5 rounded border-2 ${
            status.type === 'error'
              ? 'bg-[#ff3b30] text-white border-[#2d482e]'
              : 'bg-[#9fc28e] text-[#2d482e] border-[#2d482e]'
          }`}>
            {status.text}
          </div>
        )}

        {/* Pairing is useless if the app is pointed at the wrong host, and this screen
            renders before Settings is reachable — so the address is editable here too. */}
        <div className="mt-3 pt-3 border-t-2 border-[#2d482e]/30 flex flex-col gap-1">
          <div className="text-[7px] opacity-70 uppercase tracking-widest flex items-center gap-1 justify-center">
            <LinkIcon size={9} /> SERVER ADDRESS
          </div>
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => saveServerUrl(e.target.value)}
            placeholder="http://localhost:18789"
            className="w-full bg-[#9fc28e] border-2 border-[#2d482e] text-[8px] p-2 rounded text-center"
          />
          <div className="text-[6px] opacity-60">USING: {getApiUrl()}</div>
        </div>
      </div>
    </div>
  );
};

export default PairingScreen;
