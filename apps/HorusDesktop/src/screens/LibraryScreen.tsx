import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Episode, SearchResult } from "@horus/core";
import type { LibraryState } from "../types/media";
import { MediaCollection } from "../components/MediaCollection";
import { mediaKey } from "../store/library";

interface Props {
  section: "wishlist" | "history";
  library: LibraryState;
  openMedia: (media: SearchResult, episode?: Episode) => Promise<void>;
}

export function LibraryScreen({ section, library, openMedia }: Props) {
  if (section === "history")
    return <HistoryCollection library={library} openMedia={openMedia} />;
  const categories = [
    { type: "movie", title: "Films" },
    { type: "series", title: "Séries" },
    { type: "anime", title: "Animés" },
  ] as const;
  if (library.wishlist.length)
    return (
      <>
        {categories.map(({ type, title }) => {
          const items = library.wishlist.filter((media) => media.type === type);
          if (!items.length) return null;
          return (
            <section
              key={type}
              className="wishlist-category"
              aria-label={title}
            >
              <MediaCollection
                section="wishlist"
                heading={title}
                library={library}
                openMedia={openMedia}
                visibleMedia={items}
                searched={false}
                searching={false}
                error=""
              />
            </section>
          );
        })}
      </>
    );
  return (
    <MediaCollection
      section={section}
      library={library}
      openMedia={openMedia}
      visibleMedia={library.wishlist}
      searched={false}
      searching={false}
      error=""
    />
  );
}

function HistoryCollection({ library, openMedia }: Omit<Props, "section">) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(new Set<string>());
  const keys = library.history.map((item) => mediaKey(item.media));
  const selectedKeys = keys.filter((key) => selected.has(key));
  const cancel = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  return (
    <>
      {keys.length > 0 && (
        <div
          className="history-actions"
          role="group"
          aria-label="Suppression de l’historique"
        >
          {selecting ? (
            <>
              <button
                className="secondary"
                onClick={() => setSelected(new Set(keys))}
                disabled={selectedKeys.length === keys.length}
              >
                Tout sélectionner
              </button>
              <button
                className="secondary"
                onClick={() => setSelected(new Set())}
                disabled={!selectedKeys.length}
              >
                Tout désélectionner
              </button>
              <button
                className="secondary"
                disabled={!selectedKeys.length}
                onClick={() => {
                  library.removeFromHistory(selectedKeys);
                  cancel();
                }}
              >
                <Trash2 size={16} /> Confirmer la suppression (
                {selectedKeys.length})
              </button>
              <button className="secondary" onClick={cancel}>
                Annuler
              </button>
              <span className="muted" role="status">
                {selectedKeys.length} sur {keys.length} sélectionnés
              </span>
            </>
          ) : (
            <button
              className="secondary"
              onClick={() => {
                setSelected(new Set());
                setSelecting(true);
              }}
            >
              <Trash2 size={16} /> Supprimer
            </button>
          )}
        </div>
      )}
      <MediaCollection
        section="history"
        library={library}
        openMedia={openMedia}
        visibleMedia={library.history.map((item) => item.media)}
        searched={false}
        searching={false}
        error=""
        selection={
          selecting
            ? {
                selected,
                toggle: (key) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  }),
              }
            : undefined
        }
      />
    </>
  );
}
