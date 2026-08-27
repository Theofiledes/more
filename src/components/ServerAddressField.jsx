import React, { useState } from 'react';
import { Link as LinkIcon } from 'lucide-react';
import { getApiUrl } from '../utils/api';

/**
 * Editable server address.
 *
 * Shared between the offline screen and the pairing screen because both are states you
 * can only get *out of* by pointing BMO somewhere reachable. It used to live only in
 * Settings, which is behind the menu — so a fresh install whose baked-in address didn't
 * resolve showed "OFFLINE" with no way to fix it. That's a dead end for every new user.
 */
const ServerAddressField = ({ onChange }) => {
  const [value, setValue] = useState(() => {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem('bmo_custom_api_url') || '';
  });

  const save = (v) => {
    setValue(v);
    if (typeof localStorage === 'undefined') return;
    const trimmed = v.trim().replace(/\/$/, '');
    if (trimmed) localStorage.setItem('bmo_custom_api_url', trimmed);
    else localStorage.removeItem('bmo_custom_api_url');
    onChange?.(trimmed);
  };

  return (
    <div className="w-full max-w-[250px] flex flex-col gap-1 mt-3 pt-3 border-t-2 border-[#2d482e]/30">
      <div className="text-[7px] opacity-70 uppercase tracking-widest flex items-center gap-1 justify-center">
        <LinkIcon size={9} /> BMO&apos;S ADDRESS
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => save(e.target.value)}
        placeholder="http://192.168.1.50:18789"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="w-full bg-[#9fc28e] border-2 border-[#2d482e] text-[8px] p-2 rounded text-center"
      />
      <div className="text-[6px] opacity-60 text-center">TRYING: {getApiUrl()}</div>
    </div>
  );
};

export default ServerAddressField;
