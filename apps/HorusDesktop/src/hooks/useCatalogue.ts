import { useRef, useState, type FormEvent } from "react";
import type { SearchResult } from "@horus/core";
import { searchMedia } from "../services/providers";
import { errorMessage } from "../services/native";
import type { Section } from "../types/media";

export function useCatalogue(
  section: Section,
  setError: (error: string) => void,
) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchGeneration = useRef(0);
  const resetSearch = () => {
    searchGeneration.current++;
    setResults([]);
    setSearched(false);
    setSearching(false);
    setQuery("");
  };
  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (section !== "catalogue" && section !== "anime") return;
    const generation = ++searchGeneration.current;
    setSearching(true);
    setError("");
    setSearched(true);
    setResults([]);
    try {
      const media = await searchMedia(section, query.trim());
      if (generation === searchGeneration.current) setResults(media);
    } catch (error) {
      if (generation === searchGeneration.current)
        setError(errorMessage(error));
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  };

  return { query, setQuery, results, searched, searching, search, resetSearch };
}
