import type { Episode } from "@horus/core";
import { groupEpisodes } from "../services/episodes";

export function EpisodePicker({
  episodes,
  selected,
  disabled,
  onChoose,
  showSeasons = true,
}: {
  episodes: Episode[];
  showSeasons?: boolean;
  selected?: Episode;
  disabled: boolean;
  onChoose: (episode: Episode) => void;
}) {
  const groups = groupEpisodes(episodes);
  const season =
    groups.find((group) =>
      group.episodes.some((episode) => episode.id === selected?.id),
    ) || groups[0];
  if (!season) return null;
  return (
    <div className="episode-picker">
      {showSeasons && (
        <label className="field">
          Saison
          <select
            value={season.name}
            disabled={disabled}
            onChange={(event) => {
              const first = groups.find(
                (group) => group.name === event.target.value,
              )?.episodes[0];
              if (first) onChoose(first);
            }}
          >
            {groups.map((group) => (
              <option key={group.name} value={group.name}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        Épisode
        <select
          disabled={disabled}
          value={
            season.episodes.some((episode) => episode.id === selected?.id)
              ? selected?.id
              : ""
          }
          onChange={(event) => {
            const episode = season.episodes.find(
              (item) => item.id === event.target.value,
            );
            if (episode) onChoose(episode);
          }}
        >
          <option value="" disabled>
            Choisir un épisode
          </option>
          {season.episodes.map((episode) => (
            <option key={episode.id} value={episode.id}>
              {episode.title?.replace(
                /^(.*?)\s*[-–—]\s*(?=[ée]pisode\b)/i,
                "",
              ) ?? `Épisode ${episode.number}`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
