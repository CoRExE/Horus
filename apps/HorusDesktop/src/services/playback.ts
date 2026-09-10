export function resumePosition(position: number, duration: number): number {
  if (
    !Number.isFinite(position) ||
    !Number.isFinite(duration) ||
    position <= 0 ||
    duration <= 0
  )
    return 0;
  // Restart completed media, without treating most of a short clip as its ending.
  const ending = Math.min(5, duration * 0.05);
  return position < duration - ending ? position : 0;
}
