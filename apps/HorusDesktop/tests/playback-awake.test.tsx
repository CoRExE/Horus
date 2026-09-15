import { beforeEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { usePlaybackAwake } from "../src/components/usePlaybackAwake";

const native = vi.hoisted(() => ({ enabled: true, invoke: vi.fn() }));
vi.mock("../src/services/native", () => ({
  isTauri: () => native.enabled,
  invoke: native.invoke,
}));
const source = {};
function Harness({
  remote = false,
  playback = source,
}: {
  remote?: boolean;
  playback?: object;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const warning = usePlaybackAwake(video, playback, !remote);
  return (
    <>
      <video ref={video} />
      <p>{warning}</p>
    </>
  );
}
beforeEach(() => {
  native.enabled = true;
  native.invoke.mockReset().mockResolvedValue(undefined);
});
const states = () =>
  native.invoke.mock.calls.map(([command, args]) => {
    expect(command).toBe("set_playback_awake");
    return args.active;
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

test("remplacer la source libère l'ancien verrou ; la diffusion TV n'en acquiert aucun", async () => {
  const result = render(<Harness />);
  const video = result.container.querySelector("video")!;
  fireEvent.playing(video);
  await waitFor(() => expect(states()).toEqual([true]));
  result.rerender(<Harness playback={{}} />);
  fireEvent.playing(video);
  await waitFor(() => expect(states()).toEqual([true, false, true]));
  result.rerender(<Harness remote />);
  fireEvent.playing(video);
  await waitFor(() => expect(states()).toEqual([true, false, true, false]));
  result.unmount();
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
