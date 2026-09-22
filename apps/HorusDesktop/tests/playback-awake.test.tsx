import { beforeEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { usePlaybackAwake } from "../src/components/usePlaybackAwake";
import { Player, type Playback } from "../src/components/Player";

const native = vi.hoisted(() => ({ enabled: true, invoke: vi.fn() }));
const receiver = vi.hoisted(() => ({ status: vi.fn(), control: vi.fn() }));
vi.mock("../src/services/devices", () => ({
  deviceStatus: receiver.status,
  controlDevice: receiver.control,
}));
vi.mock("../src/services/native", () => ({
  isTauri: () => native.enabled,
  invoke: native.invoke,
  errorMessage: (error: unknown) => String(error),
}));
const source = {};
function Harness({
  remote = false,
  active = true,
  playback = source,
}: {
  remote?: boolean;
  active?: boolean;
  playback?: object;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const warning = usePlaybackAwake(video, playback, remote ? (active ? "remote" : "inactive") : "local");
  return (
    <>
      {!remote && <video ref={video} />}
      <p>{warning}</p>
    </>
  );
}
beforeEach(() => {
  native.enabled = true;
  native.invoke.mockReset().mockResolvedValue(undefined);
  receiver.status.mockReset();
  receiver.control.mockReset().mockResolvedValue(undefined);
});
const states = () =>
  native.invoke.mock.calls.map(([command, args]) => {
    expect(command).toBe("set_playback_awake");
    return args.active;
  });

test.each(["dlna", "cast"] as const)("le lecteur %s suit les états TV et conserve le verrou pendant une erreur réseau", async (kind) => {
  vi.useFakeTimers();
  const playback: Playback = {
    prepared: { id: "tv", url: "/stream.mp4", contentType: "video/mp4" },
    title: "Test TV", language: "VF", format: "file", resumeAt: 0,
    device: { id: "tv", ip: "192.0.2.1", name: "TV", kind },
  };
  const status = (transportState: string) => receiver.status.mockResolvedValue({ transportState, positionSeconds: 10, durationSeconds: 100 });
  status("PLAYING");
  const result = render(<Player playback={playback} onStop={vi.fn()} onProgress={vi.fn()} />);
  const tick = async (ms = 2000) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  try {
    await tick(0);
    expect(result.container.querySelector("video")).toBeNull();
    expect(states()).toEqual([true]);
    status("TRANSITIONING");
    await tick();
    receiver.status.mockRejectedValue(new Error("TV temporairement indisponible"));
    await tick();
    expect(states()).toEqual([true]);
    status("PAUSED_PLAYBACK");
    await tick();
    expect(states()).toEqual([true, false]);
    status("PLAYING");
    await tick();
    expect(states()).toEqual([true, false, true]);
    status("STOPPED");
    await tick();
    expect(states()).toEqual([true, false, true, false]);
    status("NO_MEDIA_PRESENT");
    await tick();
    expect(states()).toEqual([true, false, true, false]);
    status("PLAYING");
    await tick();
    result.unmount();
    await tick(0);
    expect(states()).toEqual([true, false, true, false, true, false]);
  } finally {
    result.unmount();
    vi.useRealTimers();
  }
});

test("le maintien éveillé suit lecture/pause/fin/erreur et fermeture, sans activation au chargement", async () => {
  const result = render(<Harness />);
  const video = result.container.querySelector("video")!;
  expect(native.invoke).not.toHaveBeenCalled();
  fireEvent.playing(video);
  await waitFor(() => expect(states()).toEqual([true]));
  fireEvent.pause(video);
  await waitFor(() => expect(states()).toEqual([true, false]));
  fireEvent.playing(video);
  fireEvent.ended(video);
  fireEvent.playing(video);
  fireEvent.error(video);
  fireEvent.playing(video);
  result.unmount();
  await waitFor(() =>
    expect(states()).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ]),
  );
});

test("pause puis reprise pendant une acquisition lente conserve l'état final de lecture", async () => {
  let finish!: () => void;
  native.invoke.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const result = render(<Harness />);
  const video = result.container.querySelector("video")!;
  fireEvent.playing(video);
  await waitFor(() => expect(states()).toEqual([true]));
  fireEvent.pause(video);
  fireEvent.playing(video);
  await act(async () => finish());
  await waitFor(() => expect(states()).toEqual([true, false, true]));
  result.unmount();
  await waitFor(() => expect(states()).toEqual([true, false, true, false]));
});

test("remplacer la source puis passer à la TV libère et réacquiert le verrou", async () => {
  const result = render(<Harness />);
  const video = result.container.querySelector("video")!;
  fireEvent.playing(video);
  await waitFor(() => expect(states()).toEqual([true]));
  result.rerender(<Harness playback={{}} />);
  fireEvent.playing(video);
  await waitFor(() => expect(states()).toEqual([true, false, true]));
  result.rerender(<Harness remote />);
  await waitFor(() => expect(states()).toEqual([true, false, true, false, true]));
  expect(result.container.querySelector("video")).toBeNull();
  result.unmount();
  await waitFor(() => expect(states()).toEqual([true, false, true, false, true, false]));
});

test("la TV libère le verrou à la pause et à l'arrêt, et le reprend sans vidéo locale", async () => {
  const result = render(<Harness remote />);
  await waitFor(() => expect(states()).toEqual([true]));
  result.rerender(<Harness remote active={false} />);
  await waitFor(() => expect(states()).toEqual([true, false]));
  result.rerender(<Harness remote />);
  await waitFor(() => expect(states()).toEqual([true, false, true]));
  result.unmount();
  await waitFor(() => expect(states()).toEqual([true, false, true, false]));
});

test("fermer la diffusion pendant une acquisition lente libère le verrou après acquisition", async () => {
  let finish!: () => void;
  native.invoke.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const result = render(<Harness remote />);
  await waitFor(() => expect(states()).toEqual([true]));
  result.unmount();
  await act(async () => finish());
  await waitFor(() => expect(states()).toEqual([true, false]));
});

test("un refus natif affiche une information sans empêcher la lecture ni les tentatives suivantes", async () => {
  native.invoke.mockRejectedValueOnce(new Error("Aucun service"));
  const result = render(<Harness />);
  const video = result.container.querySelector("video")!;
  fireEvent.playing(video);
  await waitFor(() =>
    expect(result.container.textContent).toContain(
      "maintien éveillé est indisponible",
    ),
  );
  expect(video.pause).not.toHaveBeenCalled();
  fireEvent.pause(video);
  fireEvent.playing(video);
  await waitFor(() => expect(result.container.textContent).toBe(""));
  result.unmount();
  await waitFor(() => expect(states().at(-1)).toBe(false));
});

test("le verrou navigateur obtenu après la fermeture est immédiatement libéré", async () => {
  native.enabled = false;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  let finish!: (lock: any) => void;
  const request = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: { request },
  });
  const result = render(<Harness />);
  fireEvent.playing(result.container.querySelector("video")!);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  result.unmount();
  const lock = { release: vi.fn().mockResolvedValue(undefined) };
  await act(async () => finish(lock));
  expect(lock.release).toHaveBeenCalledTimes(1);
  expect(native.invoke).not.toHaveBeenCalled();
});
