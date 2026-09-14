import type { useUpdates } from '../hooks/useUpdates';

export function UpdateNotice({ updates }: { updates: ReturnType<typeof useUpdates> }) {
  if (!updates.showOffer || updates.result.kind !== 'available') return null;
  const { manifest } = updates.result;
  return <section className="settings-card update-notice" aria-label="Mise à jour disponible">
    <h2>Horus {manifest.version} est disponible</h2>
    <details><summary>Nouveautés</summary><p style={{ whiteSpace: 'pre-wrap' }}>{manifest.notes || 'Consultez la release pour les détails.'}</p></details>
    <p>L’installation se fait manuellement après téléchargement.</p>
    <button className="primary" disabled={updates.opening} onClick={() => void updates.download()}>
      {updates.opening ? 'Ouverture…' : 'Télécharger'}
    </button>{' '}
    <button onClick={updates.dismiss}>Plus tard</button>
    {updates.message && <p role="status">{updates.message}</p>}
  </section>;
}
