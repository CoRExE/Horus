import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function usePlayerFullscreen(onError: (error: unknown) => void) {
  const container = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const active = useRef(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  // Restore the original window mode when the player closes.
  const restoreWindow = useRef(false);
  const errorHandler = useRef(onError);
  errorHandler.current = onError;

  const exit = async () => {
    if (pending.current || !active.current) return;
    pending.current = true;
    try {
      if (isTauri()) {
        if (restoreWindow.current) {
          await getCurrentWindow().setFullscreen(false);
          restoreWindow.current = false;
        }
      } else if (document.fullscreenElement === container.current) {
        await document.exitFullscreen();
      }
      active.current = false;
      if (mounted.current) setFullscreen(false);
    } catch (error) {
      errorHandler.current(error);
    } finally {
      pending.current = false;
    }
  };

  const toggle = async () => {
    if (active.current) return exit();
    if (pending.current || !container.current) return;
    pending.current = true;
    try {
      if (isTauri()) {
        const window = getCurrentWindow();
        restoreWindow.current = !(await window.isFullscreen());
        if (restoreWindow.current) await window.setFullscreen(true);
        if (!mounted.current) {
          if (restoreWindow.current) await window.setFullscreen(false);
          restoreWindow.current = false;
          return;
        }
      } else {
        await container.current.requestFullscreen();
      }
      active.current = true;
      if (mounted.current) setFullscreen(true);
    } catch (error) {
      restoreWindow.current = false;
      errorHandler.current(error);
    } finally {
      pending.current = false;
    }
  };

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const syncBrowser = () => {
      active.current =
        !!document.fullscreenElement &&
        document.fullscreenElement === container.current;
      setFullscreen(active.current);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && active.current) {
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
          if (!active.current || pending.current) return;
          try {
            const nativeFullscreen = await window.isFullscreen();
            if (!disposed && !pending.current && !nativeFullscreen) {
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
      if (restoreWindow.current && !pending.current) {
        void getCurrentWindow()
          .setFullscreen(false)
          .catch(errorHandler.current);
        restoreWindow.current = false;
      }
      if (!isTauri() && active.current && document.fullscreenElement) {
        void document.exitFullscreen().catch(errorHandler.current);
      }
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
