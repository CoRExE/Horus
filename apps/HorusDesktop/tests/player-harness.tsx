import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Player, type Playback } from "../src/components/Player";
import { PlaybackRange } from "../src/components/PlaybackRange";
import "../src/styles.css";

// Development-only entry point; Vite's production entry remains index.html.
function Harness() {
  const [playback, setPlayback] = useState<Playback>();
  const [progress, setProgress] = useState("Aucune lecture");
  const [receiverPosition, setReceiverPosition] = useState(10);
  const [committed, setCommitted] = useState<number>();
  const [sequence, setSequence] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setReceiverPosition((value) => (value === 50 ? 10 : value + 1)),
      500,
    );
    return () => clearInterval(timer);
  }, []);
  const play = (format: "hls" | "file", resumeAt = 0) => {
    setSequence((value) => value + 1);
    setPlayback({
      prepared: {
        id: String(sequence),
        url: `/tests/.media-fixtures/sample.${format === "hls" ? "m3u8" : "mp4"}`,
        contentType:
          format === "hls" ? "application/vnd.apple.mpegurl" : "video/mp4",
      },
      title: `Mire synthétique · ${format.toUpperCase()}`,
      format,
      language: "Audio silencieux",
      resumeAt,
    });
  };
  return (
    <main>
      <h1>Validation locale du lecteur Horus</h1>
      <p>Mire vidéo générée avec FFmpeg, sans source externe.</p>
      <div className="detail-actions">
        <button onClick={() => play("file")}>Lire MP4</button>
        <button onClick={() => play("hls")}>Lire HLS</button>
        <button onClick={() => play("hls", 1)}>
          Reprendre HLS à 1 seconde
        </button>
      </div>
      <p role="status" style={{ marginTop: 20 }}>
        {progress}
      </p>
      {playback && (
        <Player
          playback={playback}
          onStop={() => setPlayback(undefined)}
          onProgress={(position, duration, flush) =>
            setProgress(
              `Progression : ${position.toFixed(2)} / ${duration.toFixed(2)} secondes${flush ? " · sauvegarde immédiate" : ""}`,
            )
          }
        />
      )}
      <section className="settings-card">
        <h2>Curseur pendant la synchronisation du récepteur</h2>
        <p>
          Position reçue : {receiverPosition}. Le curseur doit garder le focus
          et votre sélection pendant les mises à jour.
        </p>
        <PlaybackRange
          label="Position du test"
          value={receiverPosition}
          max={60}
          onCommit={setCommitted}
        />
        <p role="status">
          {committed === undefined
            ? "Aucune commande"
            : `Position confirmée : ${committed}`}
        </p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);
