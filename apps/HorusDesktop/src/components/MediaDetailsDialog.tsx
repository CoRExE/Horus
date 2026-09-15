import { Heart, LoaderCircle, Play, Cast, Download } from "lucide-react";
import {
  groupStreamsByLanguage,
  inferStreamFormat,
  sortStreamLanguages,
  type Episode,
  type Stream,
} from "@horus/core";
import { Modal } from "./Modal";
import { EpisodePicker } from "./EpisodePicker";
import { mediaKey } from "../store/library";
import type {
  MediaDetails,
  LibraryState,
  StartPlayback,
  DownloadMedia,
} from "../types/media";

interface Props {
  details: MediaDetails;
  library: LibraryState;
  closeDetails: () => void;
  detailError: string;
  detailsBusy: boolean;
  starting: boolean;
  language: string;
  setLanguage: (language: string) => void;
  selectedStream: number;
  setSelectedStream: (index: number) => void;
  chooseEpisode: (details: MediaDetails, episode: Episode) => Promise<void>;
  startPlayback: StartPlayback;
  openCast: (details: MediaDetails, stream: Stream) => void;
  downloadMedia: DownloadMedia;
  downloading: boolean;
  ffmpeg: boolean;
}

export function MediaDetailsDialog({
  details,
  library,
  closeDetails,
  detailError,
  detailsBusy,
  starting,
  language,
  setLanguage,
  selectedStream,
  setSelectedStream,
  chooseEpisode,
  startPlayback,
  openCast,
  downloadMedia,
  downloading,
  ffmpeg,
}: Props) {
  const groups = groupStreamsByLanguage(details.streams);
  const streams = groups[language] ?? [];
  const stream = streams[selectedStream];
  return (
    <Modal title={details.media.title} onClose={closeDetails} wide>
      <div className="detail-content">
        <div className="detail-heading">
          <span className="eyebrow">
            {details.media.type === "anime" ? "ANIMESAMA" : "VIDZY"}
          </span>
          <button
            className="secondary"
            onClick={() => library.toggleWishlist(details.media)}
          >
            <Heart size={16} />
            {library.wishlist.some(
              (item) => mediaKey(item) === mediaKey(details.media),
            )
              ? "Retirer de ma liste"
              : "Ajouter à ma liste"}
          </button>
        </div>
        {detailError && (
          <p className="notice error" role="alert">
            {detailError}
          </p>
        )}
        {detailsBusy && (
          <p className="loading-line">
            <LoaderCircle className="spin" size={20} />{" "}
            {details.episode
              ? "Résolution des serveurs…"
              : "Chargement des épisodes…"}
          </p>
        )}
        {details.episodes.length > 0 && (
          <EpisodePicker
            key={mediaKey(details.media)}
            episodes={details.episodes}
            selected={details.episode}
            showSeasons={details.media.type !== "movie"}
            disabled={detailsBusy || starting}
            onChoose={(episode) => void chooseEpisode(details, episode)}
          />
        )}
        {details.streams.length > 0 && (
          <>
            <div className="language-picker" aria-label="Langue">
              {sortStreamLanguages(Object.keys(groups)).map((item) => (
                <button
                  key={item}
                  className={item === language ? "chip selected" : "chip"}
                  aria-pressed={item === language}
                  onClick={() => {
                    setLanguage(item);
                    setSelectedStream(0);
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
            {!streams.length && (
              <p className="notice">
                La VF n’est pas disponible. Choisissez explicitement une autre
                langue ci-dessus.
              </p>
            )}
            {streams.length > 0 && (
              <label className="field">
                Serveur
                <select
                  value={selectedStream}
                  disabled={starting}
                  onChange={(event) =>
                    setSelectedStream(Number(event.target.value))
                  }
                >
                  {streams.map((item, index) => (
                    <option key={`${item.server}-${index}`} value={index}>
                      {item.server} · {item.quality ?? "auto"} ·{" "}
                      {inferStreamFormat(item).toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="detail-actions">
              <button
                className="primary"
                disabled={!stream || starting}
                onClick={() => stream && void startPlayback(details, stream)}
              >
                {starting ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Play size={18} />
                )}{" "}
                Lire ici
              </button>
              <button
                className="secondary"
                disabled={!stream || starting}
                onClick={() => stream && openCast(details, stream)}
              >
                <Cast size={18} /> Diffuser
              </button>
              <button
                className="secondary"
                disabled={!stream || downloading || starting || !ffmpeg}
                onClick={() => stream && void downloadMedia(details, stream)}
              >
                <Download size={18} /> Télécharger
              </button>
            </div>
            {!ffmpeg && (
              <small className="muted">
                Installez FFmpeg pour télécharger les vidéos.
              </small>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
