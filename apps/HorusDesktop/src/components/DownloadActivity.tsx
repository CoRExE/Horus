import { LoaderCircle } from "lucide-react";
import { bytesLabel } from "../utils/format";
import type { DownloadProgress } from "../types/media";

interface Props {
  download: DownloadProgress;
  cancelDownload: () => Promise<void>;
}

export function DownloadActivity({ download, cancelDownload }: Props) {
  return (
    <div className="download-progress" role="status">
      <LoaderCircle className="spin" size={20} />
      <div>
        <strong>{download.title}</strong>
        <small>
          {bytesLabel(download.bytes)} téléchargés ·{" "}
          {download.phase === "cancelling"
            ? "Annulation…"
            : download.phase === "finalizing"
              ? "Finalisation du MP4…"
              : download.phase === "preparing"
                ? "Préparation…"
                : "Téléchargement"}
          {download.bytesPerSecond != null &&
            ` · ${download.bytesPerSecond < 1024 ** 2 ? `${Math.round(download.bytesPerSecond / 1024)} Ko` : bytesLabel(download.bytesPerSecond)}/s (écriture)`}
          {download.percent != null && ` · ${Math.floor(download.percent)} %`}
          {download.etaSeconds != null &&
            ` · environ ${Math.max(1, Math.ceil(download.etaSeconds / 60))} min restantes`}
        </small>
      </div>
      <button
        className="secondary"
        disabled={download.phase === "cancelling"}
        onClick={() => void cancelDownload()}
      >
        Annuler
      </button>
    </div>
  );
}
