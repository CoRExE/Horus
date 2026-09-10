import {
  AnimeSamaProvider,
  VidzyProvider,
  type SearchResult,
} from "@horus/core";
import { useLibrary } from "../store/library";

export function providerFor(media: Pick<SearchResult, "providerId">) {
  return media.providerId === "anime-sama"
    ? new AnimeSamaProvider()
    : new VidzyProvider({ catalogApiUrl: useLibrary.getState().apiUrl });
}

export async function searchMedia(
  section: "anime" | "catalogue",
  query: string,
) {
  return providerFor({
    providerId: section === "anime" ? "anime-sama" : "vidzy",
  }).search(query);
}
