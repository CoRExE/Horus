import {
  AnimeSamaProvider,
  VidzyProvider,
  type SearchResult,
  type HorusProvider,
} from "@horus/core";
import { useLibrary } from "../store/library";
import { invoke } from "@tauri-apps/api/core";

export function providerFor(media: Pick<SearchResult, "providerId">): HorusProvider {
  return media.providerId === "anime-sama"
    ? new AnimeSamaProvider()
    : new VidzyProvider({ catalogApiUrl: useLibrary.getState().apiUrl,
        resolveSession: (embed, referer) => invoke<{ key: string; userAgent: string }>(
          "resolve_vidzy_session", { embed, referer }),
      });
}

export async function searchMedia(
  section: "anime" | "catalogue",
  query: string,
) {
  return providerFor({
    providerId: section === "anime" ? "anime-sama" : "vidzy",
  }).search(query);
}
