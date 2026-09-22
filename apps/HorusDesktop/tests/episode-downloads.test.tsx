import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { EpisodeDownloads } from '../src/components/EpisodeDownloads';

const episodes = [
  { id: 'Saison 1::1', number: 1, title: 'Saison 1 - Épisode 1' },
  { id: 'Saison 1::2', number: 2, title: 'Saison 1 - Épisode 2' },
  { id: 'Saison 2::1', number: 1, title: 'Saison 2 - Épisode 1' },
];
test('sélection entre saisons : confirmation dans l’ordre du catalogue et dans la langue choisie', () => {
  const download = vi.fn();
  render(<EpisodeDownloads episodes={episodes} language="VF" disabled={false} onDownload={download} />);
  fireEvent.click(screen.getByText('Télécharger plusieurs épisodes'));
  fireEvent.click(screen.getByLabelText('Saison 2 - Épisode 1'));
  fireEvent.click(screen.getByLabelText('Saison 1 - Épisode 1'));
  fireEvent.change(screen.getByLabelText('Langue des téléchargements'), { target: { value: 'VOSTFR' } });
  fireEvent.click(screen.getByText('Ajouter 2 épisode(s) à la file'));
  expect(download).toHaveBeenCalledWith([episodes[0], episodes[2]], 'VOSTFR');
  fireEvent.click(screen.getByText('Télécharger plusieurs épisodes'));
  expect(screen.getByText('Ajouter 0 épisode(s) à la file').hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByText('Tout sélectionner'));
  expect(screen.getAllByRole('checkbox').every(checkbox => (checkbox as HTMLInputElement).checked)).toBe(true);
  fireEvent.click(screen.getByText('Tout désélectionner'));
  expect(screen.getAllByRole('checkbox').some(checkbox => (checkbox as HTMLInputElement).checked)).toBe(false);
  fireEvent.click(screen.getByText('Tout sélectionner'));
  fireEvent.click(screen.getByText('Annuler la sélection'));
  expect(download).toHaveBeenCalledTimes(1);
});
