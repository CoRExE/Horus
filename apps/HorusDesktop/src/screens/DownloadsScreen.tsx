import { Download, Play, Cast, Trash2 } from "lucide-react";
import type { OfflineMedia } from "../services/native";
import { bytesLabel } from "../utils/format";

interface Props {
  offline: OfflineMedia[];
  starting: boolean;
  playingOfflineId?: string;
  playOffline: (item: OfflineMedia) => Promise<void>;
  castOffline: (item: OfflineMedia) => void;
  removeDownload: (id: string) => Promise<void>;
}

export function DownloadsScreen({
  offline,
  starting,
  playingOfflineId,
  playOffline,
  castOffline,
  removeDownload,
}: Props) {
  return (
    <>
      <p className="section-description">
        Vos fichiers restent disponibles sans connexion et peuvent être diffusés
        sur votre réseau local.
      </p>
      {!offline.length && (
        <div className="empty-state">
          <Download size={36} />
          <h2>À emporter avec vous</h2>
          <p>Ouvrez un titre, choisissez un épisode puis « Télécharger ».</p>
        </div>
      )}
      <div className="offline-list">
        {offline.map((item) => (
          <article key={item.id}>
            <div className="offline-icon">
              <Download />
            </div>
            <div className="offline-title">
              <h3>{item.metadata.title}</h3>
              <small>
                {item.metadata.language} · {bytesLabel(item.sizeBytes)} ·{" "}
                {new Date(item.downloadedAt).toLocaleDateString("fr-FR")}
              </small>
            </div>
            <button
              className="secondary"
              disabled={starting}
              onClick={() => void playOffline(item)}
            >
              <Play size={16} /> Lire
            </button>
            <button
              className="icon-button"
              aria-label={`Diffuser ${item.metadata.title}`}
              disabled={starting}
              onClick={() => castOffline(item)}
            >
              <Cast size={19} />
            </button>
            <button
              className="icon-button danger"
              aria-label={`Supprimer ${item.metadata.title}`}
              disabled={playingOfflineId === item.id}
              onClick={() => void removeDownload(item.id)}
            >
              <Trash2 size={18} />
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
