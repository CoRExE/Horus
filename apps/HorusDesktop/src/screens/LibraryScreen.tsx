import type { Episode, SearchResult } from "@horus/core";
import type { LibraryState } from "../types/media";
import { MediaCollection } from "../components/MediaCollection";

export function LibraryScreen({
  section,
  library,
  openMedia,
}: {
  section: "wishlist" | "history";
  library: LibraryState;
  openMedia: (media: SearchResult, episode?: Episode) => Promise<void>;
}) {
  return (
    <MediaCollection
      section={section}
      library={library}
      openMedia={openMedia}
      visibleMedia={
        section === "wishlist"
          ? library.wishlist
          : library.history.map((item) => item.media)
      }
      searched={false}
      searching={false}
      error=""
    />
  );
}
