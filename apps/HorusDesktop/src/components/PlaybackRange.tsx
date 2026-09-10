import { useState } from "react";

/** Keep the user's draft position stable while receiver polling continues. */
export function PlaybackRange({
  label,
  value,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  max: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number>();
  const clamp = (value: number) =>
    Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));
  const commit = (value: number) => {
    if (!disabled) onCommit(clamp(value));
    setDraft(undefined);
  };
  return (
    <input
      type="range"
      aria-label={label}
      min={0}
      max={max}
      value={clamp(draft ?? value)}
      disabled={disabled}
      onChange={(event) => setDraft(Number(event.currentTarget.value))}
      onPointerUp={(event) => commit(Number(event.currentTarget.value))}
      onPointerCancel={() => setDraft(undefined)}
      onKeyUp={(event) => {
        if (
          [
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
            "PageUp",
            "PageDown",
          ].includes(event.key)
        )
          commit(Number(event.currentTarget.value));
        if (event.key === "Escape") setDraft(undefined);
      }}
      onBlur={() => {
        if (draft !== undefined) commit(draft);
      }}
    />
  );
}
