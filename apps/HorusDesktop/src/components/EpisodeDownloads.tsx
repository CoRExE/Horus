import { useState } from "react";
import type { Episode } from "@horus/core";
import { groupEpisodes } from "../services/episodes";

export function EpisodeDownloads({ episodes, language, disabled, onDownload }: {
  episodes: Episode[];
  language: string;
  disabled: boolean;
  onDownload: (episodes: Episode[], language: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [targetLanguage, setTargetLanguage] = useState(language);
  if (!open) return <button className="secondary" disabled={disabled} onClick={() => {
    setTargetLanguage(language); setOpen(true);
  }}>Télécharger plusieurs épisodes</button>;
  return <fieldset className="episode-downloads">
    <legend>Épisodes à télécharger</legend>
    <label className="field">Langue des téléchargements
      <select value={targetLanguage} onChange={event => setTargetLanguage(event.target.value)}>
        {[...new Set(["VF", "VOSTFR", "VO", language])].map(value => <option key={value}>{value}</option>)}
      </select>
    </label>
    <p className="muted">Les épisodes sont téléchargés dans l’ordre. Une langue indisponible est signalée sans être remplacée ; les épisodes déjà présents dans cette langue sont ignorés.</p>
    <div className="detail-actions">
      <button className="secondary" onClick={() => setSelected(episodes.map(episode => episode.id))}>Tout sélectionner</button>
      <button className="secondary" onClick={() => setSelected([])}>Tout désélectionner</button>
    </div>
    <div className="episode-download-list">
      {groupEpisodes(episodes).map(group => <fieldset key={group.name}>
        <legend>{group.name}</legend>
        {group.episodes.map(episode => <label key={episode.id}>
          <input type="checkbox" checked={selected.includes(episode.id)} onChange={event => setSelected(current => event.target.checked
            ? [...current, episode.id] : current.filter(id => id !== episode.id))} />
          {episode.title || `Épisode ${episode.number}`}
        </label>)}
      </fieldset>)}
    </div>
    <div className="detail-actions">
      <button className="primary" disabled={disabled || !selected.length} onClick={() => {
        onDownload(episodes.filter(episode => selected.includes(episode.id)), targetLanguage);
        setSelected([]); setOpen(false);
      }}>Ajouter {selected.length} épisode(s) à la file</button>
      <button className="secondary" onClick={() => { setSelected([]); setOpen(false); }}>Annuler la sélection</button>
    </div>
  </fieldset>;
}
