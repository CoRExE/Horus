import { useEffect, useState, type RefObject } from "react";
import { invoke, isTauri } from "../services/native";

// Serialize across player replacements too: an old release must not undo a new request.
let pending: Promise<unknown> = Promise.resolve();
function nativeAwake(active: boolean) {
  const result = pending
    .catch(() => {})
    .then(() => invoke("set_playback_awake", { active }));
  pending = result;
  return result;
}

export function usePlaybackAwake(
  video: RefObject<HTMLVideoElement | null>,
  source: object,
  mode: "local" | "remote" | "inactive",
) {
  const [warning, setWarning] = useState("");
  useEffect(() => {
    setWarning("");
    const element = mode === "local" ? video.current : null;
    if (mode === "inactive" || (mode === "local" && !element)) return;
    let disposed = false;
    let playing = false;
    let browserLock: WakeLockSentinel | undefined;
    let requesting = false;
    let generation = 0;
    const failed = () => {
      if (!disposed && playing)
        setWarning(
          "Le maintien éveillé est indisponible. La lecture reste possible.",
        );
    };
    const acquire = async () => {
      if (!playing || disposed) return;
      const attempt = generation;
      if (isTauri()) {
        try {
          await nativeAwake(true);
          if (!disposed && attempt === generation) setWarning("");
        } catch {
          if (attempt === generation) failed();
        }
        return;
      }
      if (requesting || browserLock) return;
      requesting = true;
      try {
        if (navigator.wakeLock && document.visibilityState === "visible") {
          const lock = await navigator.wakeLock.request("screen");
          if (disposed || !playing || attempt !== generation)
            await lock.release();
          else {
            browserLock = lock;
            lock.addEventListener("release", () => {
              if (browserLock === lock) browserLock = undefined;
            });
          }
        }
        if (!disposed) setWarning("");
      } catch {
        failed();
      } finally {
        requesting = false;
        if (attempt !== generation && playing && !disposed) void acquire();
      }
    };
    const release = () => {
      playing = false;
      generation++;
      if (isTauri()) void nativeAwake(false).catch(() => {});
      const lock = browserLock;
      browserLock = undefined;
      if (lock) void lock.release().catch(() => {});
    };
    const start = () => {
      playing = true;
      generation++;
      void acquire();
    };
    const visibility = () => {
      if (!isTauri() && document.visibilityState === "visible") void acquire();
    };
    if (mode === "remote") start();
    element?.addEventListener("playing", start);
    for (const event of ["pause", "ended", "error", "emptied"])
      element?.addEventListener(event, release);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      element?.removeEventListener("playing", start);
      for (const event of ["pause", "ended", "error", "emptied"])
        element?.removeEventListener(event, release);
      document.removeEventListener("visibilitychange", visibility);
      release();
    };
  }, [source, mode]);
  return warning;
}
