import { useState } from "react";
import type { Stream } from "@horus/core";
import { discoverDevices } from "../services/devices";
import { errorMessage, type Device } from "../services/native";
import type {
  MediaDetails as Details,
  CastTarget,
  StartPlayback,
  DownloadMedia,
} from "../types/media";

export function useCasting() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [deviceError, setDeviceError] = useState("");
  const [castTarget, setCastTarget] = useState<CastTarget>();
  const [delivery, setDelivery] = useState<"direct" | "download">("direct");
  const scan = async () => {
    setScanning(true);
    setDeviceError("");
    setDevices([]);
    try {
      const result = await discoverDevices();
      setDevices(result.devices);
      setDeviceError(result.warnings.join(" · "));
    } catch (error) {
      setDeviceError(errorMessage(error));
    } finally {
      setScanning(false);
    }
  };
  const openCast = (current: Details, stream: Stream, offlineId?: string) => {
    setCastTarget({ details: current, stream, offlineId });
    setDelivery("direct");
    void scan();
  };
  const castTo = async (
    device: Device,
    startPlayback: StartPlayback,
    downloadMedia: DownloadMedia,
  ) => {
    if (!castTarget) return;
    if (delivery === "download" && !castTarget.offlineId) {
      const cached = await downloadMedia(castTarget.details, castTarget.stream);
      if (cached)
        await startPlayback(
          castTarget.details,
          castTarget.stream,
          device,
          cached.id,
        );
    } else
      await startPlayback(
        castTarget.details,
        castTarget.stream,
        device,
        castTarget.offlineId,
      );
  };

  const closeCast = () => setCastTarget(undefined);
  return {
    devices,
    scanning,
    deviceError,
    setDeviceError,
    castTarget,
    delivery,
    setDelivery,
    scan,
    openCast,
    closeCast,
    castTo,
  };
}
