import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createUpdateChecker, type UpdateResult } from '@horus/core/src/updates';
import config from '../app.json';

async function request(url: string, method = 'GET') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { method, signal: controller.signal });
    return { status: response.status, body: method === 'HEAD' ? '' : await response.text() };
  } finally { clearTimeout(timer); }
}

export function useReleaseUpdates() {
  const [result, setResult] = useState<UpdateResult>({ kind: 'idle' });
  const [dismissed, setDismissed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const checker = useMemo(() => createUpdateChecker({
    target: { platform: 'android', architecture: 'universal', version: config.expo.version, versionCode: config.expo.android.versionCode },
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    request,
  }), []);
  useEffect(() => {
    mounted.current = true;
    if (Platform.OS === 'android') void checker.check().then((next) => {
      if (mounted.current && next.kind !== 'skipped') setResult(next);
    });
    return () => { mounted.current = false; };
  }, [checker]);
  async function check() {
    setResult({ kind: 'checking' }); setDismissed(false); setMessage('');
    const next = await checker.check(true);
    if (mounted.current) setResult(next);
  }
  async function download() {
    if (result.kind !== 'available' || opening) return;
    setOpening(true); setMessage('');
    try {
      if ((await request(result.asset.url, 'HEAD')).status !== 200) throw new Error('Unavailable');
      await Linking.openURL(result.asset.url);
    } catch { if (mounted.current) setMessage('Téléchargement indisponible. Réessayez plus tard.'); }
    finally { if (mounted.current) setOpening(false); }
  }
  return { result, check, download, message, opening,
    version: config.expo.version, enabled: Platform.OS === 'android',
    showOffer: result.kind === 'available' && !dismissed, dismiss: () => setDismissed(true) };
}
