import type { FormEvent } from "react";
import { Search, LoaderCircle, ArrowRight } from "lucide-react";
import type { Episode, SearchResult } from "@horus/core";
import type { LibraryState } from "../types/media";
import { MediaCollection } from "../components/MediaCollection";

interface Props {
  section: "catalogue" | "anime";
  library: LibraryState;
  query: string;
  setQuery: (query: string) => void;
  searched: boolean;
  searching: boolean;
  error: string;
  results: SearchResult[];
  search: (event: FormEvent) => void;
  openSettings: () => void;
  openMedia: (media: SearchResult, episode?: Episode) => Promise<void>;
  isDesktop: boolean;
}

export function CatalogueScreen({
  section,
  library,
  query,
  setQuery,
  searched,
  searching,
  error,
  results,
  search,
  openSettings,
  openMedia,
  isDesktop,
}: Props) {
  return (
    <>
      <form className="search-form" onSubmit={search}>
        <Search size={21} />
        <input
          aria-label="Rechercher un titre"
          placeholder={
            section === "anime"
              ? "Rechercher un animé sur AnimeSama…"
              : "Un film, une série, un univers à découvrir…"
          }
          value={query}
          minLength={2}
          maxLength={120}
          required
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className="primary"
          disabled={searching || query.trim().length < 2 || !isDesktop}
        >
          {searching ? (
            <LoaderCircle size={18} className="spin" />
          ) : (
            <ArrowRight size={18} />
          )}{" "}
          Rechercher
        </button>
      </form>
      {section === "catalogue" && !library.apiUrl && (
        <p className="notice">
          Configurez l’adresse de HorusApi dans les{" "}
          <button className="text-button" onClick={openSettings}>
            paramètres
          </button>{" "}
          pour rechercher un titre. La recherche par identifiant TMDB reste
          disponible.
        </p>
      )}
      {!searched && (
        <section className="welcome">
          <div className="eyebrow">
            {section === "anime" ? "ANIMESAMA" : "FILMS & SÉRIES"}
          </div>
          <h2>
            Vos histoires.
            <br />
            <em>Sur grand écran.</em>
          </h2>
          <p>
            Retrouvez un titre, choisissez votre épisode et installez-vous. Sur
            votre ordinateur ou votre téléviseur.
          </p>
          <div className="welcome-line">
            <span />
            <span>UNE AUTRE FAÇON DE REGARDER</span>
          </div>
          <div className="orbit" aria-hidden="true">
            <div />
            <span>H</span>
          </div>
        </section>
      )}
      {searching && (
        <div className="empty-state">
          <LoaderCircle className="spin" />
          <p>Recherche en cours…</p>
        </div>
      )}
      <MediaCollection
        {...{ section, library, searched, searching, error, openMedia }}
        visibleMedia={results}
      />
    </>
  );
}
