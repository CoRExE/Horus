// Kept free of React Native imports so node --test can run it.

/** A DLNA time ("H:MM:SS" with optional fraction), or undefined when unusable. */
export function readDlnaTime(value?: string): number | undefined {
  const text = value?.trim();
  if (!text || !/^\d+:\d{1,2}:\d{1,2}(?:\.\d+)?$/.test(text)) return undefined;
  const [hours, minutes, seconds] = text.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

type TransportState = string;

/**
 * Some TVs briefly answer 00:00:00 while transitioning or between two polls.
 * A drop to zero from further in the video is shown only once a second poll
 * confirms it; a real return to the start is therefore displayed 2 s later.
 */
export function createDlnaPositionFilter(suspiciousAfterSeconds = 5) {
  let last: number | undefined;
  let zeroPending = false;
  return {
    accept(reported: number | undefined, state: TransportState): number | undefined {
      if (reported === undefined) return undefined;
      if (reported === 0 && state === 'TRANSITIONING') return undefined;
      if (reported === 0 && last !== undefined && last > suspiciousAfterSeconds && !zeroPending) {
        zeroPending = true;
        return undefined;
      }
      zeroPending = false;
      last = reported;
      return reported;
    },
    /** Record a position the user just asked for, so it is not treated as a glitch. */
    set(position: number) {
      last = position;
      zeroPending = false;
    },
  };
}
