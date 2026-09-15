import { useEffect, type RefObject } from "react";

export function usePlayerShortcuts(
  video: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  toggleFullscreen: () => Promise<void>,
  onError: (error: unknown) => void,
) {
  useEffect(() => {
    if (!enabled) return;
    const keydown = (event: KeyboardEvent) => {
      const element = video.current;
      const target = event.target;
      if (
        !element ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing ||
        document.querySelector("dialog[open]") ||
        (target instanceof Element &&
          target.closest(
            'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"]',
          ))
      )
        return;
      const key = event.key.toLowerCase();
      if (
        ![
          " ",
          "k",
          "arrowleft",
          "arrowright",
          "arrowup",
          "arrowdown",
          "m",
          "f",
        ].includes(key)
      )
        return;
      event.preventDefault();
      if ([" ", "k", "m", "f"].includes(key) && event.repeat) return;
      if (key === " " || key === "k") {
        if (element.paused) void element.play().catch(onError);
        else element.pause();
      } else if (key === "arrowleft" || key === "arrowright") {
        if (!Number.isFinite(element.duration) || element.duration <= 0) return;
        const target = Math.max(
          0,
          Math.min(
            element.duration,
            element.currentTime + (key === "arrowright" ? 10 : -10),
          ),
        );
        // Do not seek into a gap or outside the available window of a live stream.
        for (let index = 0; index < element.seekable.length; index++) {
          if (
            target >= element.seekable.start(index) &&
            target <= element.seekable.end(index)
          ) {
            element.currentTime = target;
            break;
          }
        }
      } else if (key === "arrowup" || key === "arrowdown") {
        element.volume = Math.max(
          0,
          Math.min(1, element.volume + (key === "arrowup" ? 0.05 : -0.05)),
        );
        element.muted = false;
      } else if (key === "m") element.muted = !element.muted;
      else void toggleFullscreen();
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [video, enabled, toggleFullscreen, onError]);
}
