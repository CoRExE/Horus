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
          {bytesLabel(download.bytes)} téléchargés · préparation du fichier MP4
        </small>
      </div>
      <button className="secondary" onClick={() => void cancelDownload()}>
        Annuler
      </button>
    </div>
  );
}
