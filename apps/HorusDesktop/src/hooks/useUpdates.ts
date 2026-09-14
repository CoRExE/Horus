import { useEffect, useMemo, useRef, useState } from 'react';
import { createUpdateChecker, desktopUpdateTarget, type UpdateResult } from '@horus/core/src/updates';
import { invoke, nativeText } from '../services/native';
import type { RuntimeInfo } from '../types/media';

export function useUpdates(runtime: RuntimeInfo | undefined, version: string, ready: boolean) {
  const [result, setResult] = useState<UpdateResult>({ kind: 'idle' });
  const [dismissed, setDismissed] = useState(false);
  const [message, setMessage] = useState('');
  const [opening, setOpening] = useState(false);
  const mounted = useRef(false);
  const checker = useMemo(() => {
    const target = ready && runtime ? desktopUpdateTarget(runtime.platform, runtime.architecture, version) : undefined;
    return target ? createUpdateChecker({ target,
      getItem: async (key) => localStorage.getItem(key),
      setItem: async (key, value) => { localStorage.setItem(key, value); },
      request: (url) => nativeText(url, { timeoutMs: 8000 }),
    }) : undefined;
  }, [runtime?.platform, runtime?.architecture, version, ready]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    if (checker) void checker.check().then((next) => { if (active && next.kind !== 'skipped') setResult(next); });
    return () => { active = false; };
  }, [checker]);
  async function check() {
    if (!checker) return;
    setMessage(''); setDismissed(false); setResult({ kind: 'checking' });
    const next = await checker.check(true);
    if (mounted.current) setResult(next);
  }
  async function download() {
    if (result.kind !== 'available' || opening) return;
    setOpening(true); setMessage('');
    try {
      const response = await nativeText(result.asset.url, { method: 'HEAD', timeoutMs: 8000 });
      if (response.status !== 200) throw new Error('Unavailable');
      await invoke('open_release_url', { url: result.asset.url });
    } catch { if (mounted.current) setMessage('Téléchargement indisponible. Réessayez plus tard.'); }
    finally { if (mounted.current) setOpening(false); }
  }
  return { result, check, download, opening, message, enabled: !!checker,
    showOffer: result.kind === 'available' && !dismissed, dismiss: () => setDismissed(true) };
}
