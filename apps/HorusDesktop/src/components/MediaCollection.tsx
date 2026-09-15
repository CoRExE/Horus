import { Film, Heart, Play } from "lucide-react";
import type { Episode, SearchResult } from "@horus/core";
import { mediaKey } from "../store/library";
import type { LibraryState } from "../types/media";

interface Props {
  heading?: string;
  selection?: { selected: Set<string>; toggle: (key: string) => void };
  section: "catalogue" | "anime" | "wishlist" | "history";
  visibleMedia: SearchResult[];
  library: LibraryState;
  searched: boolean;
  searching: boolean;
  error: string;
  openMedia: (media: SearchResult, episode?: Episode) => Promise<void>;
}

export function MediaCollection({
  section,
  heading,
  selection,
  visibleMedia,
  library,
  searched,
  searching,
  error,
  openMedia,
}: Props) {
  const searchingSection = section === "catalogue" || section === "anime";
  return (
    <>
      {visibleMedia.length > 0 && (
        <>
          <div className="list-heading">
            <h2>
              {heading ??
                (searchingSection
                  ? "Résultats"
                  : section === "wishlist"
                    ? "À regarder plus tard"
                    : "Reprendre une histoire")}
            </h2>
            <span>{visibleMedia.length} titres</span>
          </div>
          <div className="media-grid">
            {visibleMedia.map((media) => {
              const saved = library.wishlist.some(
                (item) => mediaKey(item) === mediaKey(media),
              );
              const history = library.history.find(
                (item) => mediaKey(item.media) === mediaKey(media),
              );
              const cardContent = (
                <>
                  <div className="poster">
                    {media.coverUrl ? (
                      <img
                        src={media.coverUrl}
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}
                    <Film className="poster-placeholder" size={35} />
                    {!selection && (
                      <span className="play-overlay">
                        <Play fill="currentColor" />
                      </span>
                    )}
                    <span className="media-type">
                      {media.type === "movie"
                        ? "FILM"
                        : media.type === "anime"
                          ? "ANIMÉ"
                          : "SÉRIE"}
                    </span>
                  </div>
                  <h3>{media.title}</h3>
                  <small>
                    {section === "history" && history
                      ? (history.episode.title ??
                        `Épisode ${history.episode.number}`)
                      : media.providerId === "anime-sama"
                        ? "AnimeSama"
                        : "Catalogue TMDB"}
                  </small>
                </>
              );
              return (
                <article
                  className={`media-card${selection?.selected.has(mediaKey(media)) ? " is-selected" : ""}`}
                  key={mediaKey(media)}
                >
                  {selection ? (
                    <label className="media-open history-select">
                      <input
                        type="checkbox"
                        aria-label={`Sélectionner ${media.title}`}
                        checked={selection.selected.has(mediaKey(media))}
                        onChange={() => selection.toggle(mediaKey(media))}
                      />
                      {cardContent}
                    </label>
                  ) : (
                    <button
                      className="media-open"
                      onClick={() =>
                        void openMedia(
                          media,
                          section === "history" ? history?.episode : undefined,
                        )
                      }
                    >
                      {cardContent}
                    </button>
                  )}
                  {!selection && (
                    <button
                      className={saved ? "favorite saved" : "favorite"}
                      aria-label={
                        saved
                          ? `Retirer ${media.title} de ma liste`
                          : `Ajouter ${media.title} à ma liste`
                      }
                      aria-pressed={saved}
                      onClick={() => library.toggleWishlist(media)}
                    >
                      <Heart size={17} fill={saved ? "currentColor" : "none"} />
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
      {((searchingSection && searched && !searching && !error) ||
        section === "wishlist" ||
        section === "history") &&
        !visibleMedia.length && (
          <div className="empty-state">
            <Film size={35} />
            <h2>
              {searched ? "Aucun résultat" : "Votre bibliothèque commence ici"}
            </h2>
            <p>
              {searched
                ? "Essayez un autre titre ou vérifiez son orthographe."
                : section === "wishlist"
                  ? "Ajoutez des titres avec le cœur pour les retrouver ici."
                  : "Vos dernières lectures apparaîtront ici."}
            </p>
          </div>
        )}
    </>
  );
}
