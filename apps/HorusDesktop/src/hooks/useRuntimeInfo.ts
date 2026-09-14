import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { errorMessage, invoke, isTauri } from "../services/native";
import type { RuntimeInfo } from "../types/media";
import packageInfo from '../../package.json';

export function useRuntimeInfo(setError: (error: string) => void) {
  const [runtime, setRuntime] = useState<RuntimeInfo>();
  const [version, setVersion] = useState(packageInfo.version);
  const [versionReady, setVersionReady] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    void invoke<RuntimeInfo>("runtime_info")
      .then(setRuntime)
      .catch((error) => setError(errorMessage(error)));
    void getVersion()
      .then((value) => { setVersion(value); setVersionReady(true); })
      .catch(() => {});
  }, []);
  return { runtime, version, versionReady };
}
