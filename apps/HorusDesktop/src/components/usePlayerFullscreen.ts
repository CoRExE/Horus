import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Also serialize cleanup with a newly mounted player in the same window.
let fullscreenOperations = Promise.resolve();

export function usePlayerFullscreen(onError: (error: unknown) => void) {
  const container = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const active = useRef(false);
  const mounted = useRef(false);
  const restoreWindow = useRef(false);
  const browserElement = useRef<HTMLElement | null>(null);
  const changing = useRef(false);
  const errorHandler = useRef(onError);
  errorHandler.current = onError;

  // Closing during a native transition must restore the window after it finishes.
  const enqueue = (operation: () => Promise<void>) => {
    fullscreenOperations = fullscreenOperations.then(async () => {
      changing.current = true;
      try {
        await operation();
      } catch (error) {
        if (mounted.current) errorHandler.current(error);
      } finally {
        changing.current = false;
      }
    });
    return fullscreenOperations;
  };
  const restore = async () => {
    if (isTauri()) {
      if (restoreWindow.current) {
        await getCurrentWindow().setFullscreen(false);
        restoreWindow.current = false;
      }
    } else if (
      browserElement.current &&
      document.fullscreenElement === browserElement.current
    ) {
      await document.exitFullscreen();
    }
    browserElement.current = null;
    active.current = false;
    if (mounted.current) setFullscreen(false);
  };
  const exit = () => enqueue(restore);
  const toggle = () =>
    enqueue(async () => {
      if (!mounted.current || !container.current) return;
      if (active.current) return restore();
      if (isTauri()) {
        const window = getCurrentWindow();
        const wasFullscreen = await window.isFullscreen();
        if (!mounted.current) return;
        if (!wasFullscreen) {
          await window.setFullscreen(true);
          restoreWindow.current = true;
        }
      } else {
        browserElement.current = container.current;
        await container.current.requestFullscreen();
      }
      active.current = true;
      if (mounted.current) setFullscreen(true);
      else await restore();
    });

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const syncBrowser = () => {
      if (isTauri()) return;
      active.current =
        !!document.fullscreenElement &&
        document.fullscreenElement === container.current;
      setFullscreen(active.current);
    };
    const keydown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        active.current &&
        !event.defaultPrevented &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        void exit();
      }
    };
    document.addEventListener("fullscreenchange", syncBrowser);
    document.addEventListener("keydown", keydown);
    if (isTauri()) {
      const window = getCurrentWindow();
      void window
        .onResized(async () => {
          if (!active.current || changing.current) return;
          try {
            const nativeFullscreen = await window.isFullscreen();
            if (!disposed && !changing.current && !nativeFullscreen) {
              active.current = false;
              restoreWindow.current = false;
              setFullscreen(false);
            }
          } catch (error) {
            if (!disposed) errorHandler.current(error);
          }
        })
        .then((cleanup) => {
          if (disposed) cleanup();
          else unlisten = cleanup;
        })
        .catch((error) => {
          if (!disposed) errorHandler.current(error);
        });
    }
    return () => {
      disposed = true;
      mounted.current = false;
      unlisten?.();
      document.removeEventListener("fullscreenchange", syncBrowser);
      document.removeEventListener("keydown", keydown);
      void exit();
    };
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [fullscreen]);

  return { container, fullscreen, toggle, exit };
}
