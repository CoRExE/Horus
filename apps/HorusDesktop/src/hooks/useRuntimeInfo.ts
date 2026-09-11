import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { errorMessage, invoke, isTauri } from "../services/native";
import type { RuntimeInfo } from "../types/media";

export function useRuntimeInfo(setError: (error: string) => void) {
  const [runtime, setRuntime] = useState<RuntimeInfo>();
  const [version, setVersion] = useState("0.1.0");
  useEffect(() => {
    if (!isTauri()) return;
    void invoke<RuntimeInfo>("runtime_info")
      .then(setRuntime)
      .catch((error) => setError(errorMessage(error)));
    void getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);
  return { runtime, version };
}
