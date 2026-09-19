import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useUpdates } from '../src/hooks/useUpdates';
import { UpdateNotice } from '../src/components/UpdateNotice';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { nativeText, invoke } from '../src/services/native';

vi.mock('../src/services/native', () => ({ nativeText: vi.fn(), invoke: vi.fn(), isTauri: () => true, errorMessage: (error: unknown) => String(error) }));
const url = 'https://github.com/CoRExE/Horus/releases/download/desktop-v0.2.0/';
const manifest = { schemaVersion: 1, application: 'desktop', platform: 'macos', version: '0.2.0', tag: 'desktop-v0.2.0',
  publishedAt: '2026-09-14T00:00:00Z', notes: 'Améliorations du lecteur', releaseUrl: 'https://github.com/CoRExE/Horus/releases/tag/desktop-v0.2.0',
  assets: ['arm64', 'x64'].map((architecture) => ({ architecture, name: `HorusDesktop-0.2.0-macos-${architecture}.dmg`,
    url: `${url}HorusDesktop-0.2.0-macos-${architecture}.dmg`, size: 100, sha256: 'a'.repeat(64) })) };

function Harness() {
  const runtime = { platform: 'macos', architecture: 'aarch64', ffmpeg: true };
  const updates = useUpdates(runtime, '0.1.1', true);
  return <><UpdateNotice updates={updates} /><SettingsScreen downloadsBusy={false} apiInput="" setApiInput={() => {}} saveApiUrl={() => {}} version="0.1.1" runtime={runtime} updates={updates} /></>;
}
beforeEach(() => { localStorage.clear(); vi.resetAllMocks(); vi.mocked(invoke).mockImplementation(async command => command === "get_download_directory" ? "/downloads" as never : undefined as never); });

test('la notification se ferme puis la vérification manuelle propose le DMG arm64 dans le navigateur', async () => {
  vi.mocked(nativeText).mockImplementation(async (_url, options) => ({ status: 200, statusText: 'OK', headers: {}, body: options?.method === 'HEAD' ? '' : JSON.stringify(manifest) }));
  render(<Harness />);
  await screen.findByText('Horus 0.2.0 est disponible');
  fireEvent.click(screen.getByText('Plus tard'));
  expect(screen.queryByText('Télécharger')).toBeNull();
  fireEvent.click(screen.getByText('Vérifier les mises à jour'));
  fireEvent.click(await screen.findByText('Télécharger'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('open_release_url', { url: `${url}HorusDesktop-0.2.0-macos-arm64.dmg` }));
});

test('un téléchargement disparu reste dans l’application et affiche une erreur récupérable', async () => {
  vi.mocked(nativeText).mockImplementation(async (_url, options) => ({ status: options?.method === 'HEAD' ? 404 : 200, statusText: '', headers: {}, body: JSON.stringify(manifest) }));
  render(<Harness />);
  fireEvent.click(await screen.findByText('Télécharger'));
  await screen.findByText('Téléchargement indisponible. Réessayez plus tard.');
  expect(invoke).not.toHaveBeenCalledWith("open_release_url", expect.anything());
});

test('une panne au démarrage reste discrète et une vérification manuelle peut réussir ensuite', async () => {
  vi.mocked(nativeText).mockRejectedValueOnce(new Error('offline'));
  render(<Harness />);
  await screen.findByText('Vérification impossible pour le moment. Réessayez plus tard.');
  expect(screen.queryByRole('alert')).toBeNull();
  vi.mocked(nativeText).mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, body: JSON.stringify(manifest) });
  fireEvent.click(screen.getByText('Vérifier les mises à jour'));
  await screen.findByText('Horus 0.2.0 est disponible');
});
