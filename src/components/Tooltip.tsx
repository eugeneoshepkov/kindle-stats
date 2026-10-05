import type { ReactNode } from "react";

export type TooltipState = { x: number; y: number; content: ReactNode } | null;

/** Positioned inside a `position: relative` chart frame; flips to stay within it. */
export function Tooltip({ state, frameWidth }: { state: TooltipState; frameWidth: number }) {
  if (!state) {
    return null;
  }

  const flip = state.x > frameWidth * 0.6;
  return (
    <div
      className="tooltip"
      role="status"
      style={{
        left: flip ? undefined : state.x + 12,
        right: flip ? frameWidth - state.x + 12 : undefined,
        top: Math.max(0, state.y - 12)
      }}
    >
      {state.content}
    </div>
  );
}

export function TooltipRow({ swatch, label, value }: { swatch?: string; label: ReactNode; value: ReactNode }) {
  return (
    <div className="tooltip-row">
      {swatch ? <span className={`swatch ${swatch}`} aria-hidden="true" /> : null}
      <span className="tooltip-label">{label}</span>
      <span className="tooltip-value">{value}</span>
    </div>
  );
}
