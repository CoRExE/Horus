import { useRef, useState } from "react";
import type { Episode, SearchResult } from "@horus/core";
import { providerFor } from "../services/providers";
import { errorMessage } from "../services/native";
import type { MediaDetails as Details } from "../types/media";

export function useMediaDetails() {
  const [details, setDetails] = useState<Details>();
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [language, setLanguage] = useState("VF");
  const [selectedStream, setSelectedStream] = useState(0);
  const detailsGeneration = useRef(0);
  const closeDetails = () => {
    detailsGeneration.current++;
    setDetails(undefined);
    setDetailsBusy(false);
    setDetailError("");
  };
  const chooseEpisode = async (current: Details, episode: Episode) => {
    const generation = ++detailsGeneration.current;
    setDetails({ ...current, episode, streams: [] });
    setDetailsBusy(true);
    setDetailError("");
    setLanguage("VF");
    setSelectedStream(0);
    try {
      const streams = await providerFor(current.media).getStreams(episode.id);
      if (generation !== detailsGeneration.current) return;
      setDetails({ ...current, episode, streams });
      if (!streams.length)
        setDetailError("Aucun serveur disponible pour cet épisode.");
    } catch (error) {
      if (generation === detailsGeneration.current)
        setDetailError(errorMessage(error));
    } finally {
      if (generation === detailsGeneration.current) setDetailsBusy(false);
    }
  };

  const openMedia = async (media: SearchResult, resume?: Episode) => {
    const generation = ++detailsGeneration.current;
    setDetails({ media, episodes: [], streams: [] });
    setDetailsBusy(true);
    setDetailError("");
    try {
      const episodes = await providerFor(media).getEpisodes(media.id);
      if (generation !== detailsGeneration.current) return;
      const current = { media, episodes, streams: [] };
      setDetails(current);
      if (!episodes.length)
        setDetailError("Aucun épisode disponible pour ce média.");
      const initial = resume
        ? episodes.find((item) => item.id === resume.id)
        : episodes.length === 1
          ? episodes[0]
          : undefined;
      if (initial) {
        await chooseEpisode(current, initial);
        return;
      }
    } catch (error) {
      if (generation === detailsGeneration.current)
        setDetailError(errorMessage(error));
    } finally {
      if (generation === detailsGeneration.current) setDetailsBusy(false);
    }
  };

  const showEpisode = (details: Details, language: string) => {
    setDetails(details);
    setLanguage(language);
    setSelectedStream(0);
    setDetailError(
      `La piste ${language} est indisponible. Choisissez une autre langue pour continuer.`,
    );
  };
  return {
    details,
    detailsBusy,
    detailError,
    language,
    selectedStream,
    setLanguage,
    setSelectedStream,
    setDetailError,
    closeDetails,
    chooseEpisode,
    openMedia,
    showEpisode,
  };
}
