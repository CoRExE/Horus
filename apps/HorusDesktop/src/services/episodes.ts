import type { Episode } from "@horus/core";

// Keep provider order and identifiers: playback/resume still use the original list.
export function groupEpisodes(episodes: Episode[]) {
  const groups = new Map<string, Episode[]>();
  for (const episode of episodes) {
    const vidzy = /^vidzy::tv::[^:]+::(\d+)::/.exec(episode.id);
    const anime = /^([^:]+)::/.exec(episode.id);
    const title = /^(.*?)\s*[-–—]\s*[ée]pisode\b/i.exec(episode.title ?? "");
    const season = vidzy
      ? `Saison ${vidzy[1]}`
      : title?.[1]?.trim() ||
        (anime && !episode.id.startsWith("vidzy::")
          ? anime[1]
          : "Tous les épisodes");
    const group = groups.get(season) ?? [];
    group.push(episode);
    groups.set(season, group);
  }
  return [...groups].map(([name, episodes]) => ({ name, episodes }));
}
