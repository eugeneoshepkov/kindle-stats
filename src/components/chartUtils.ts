import { useLayoutEffect, useRef, useState } from "react";

/** Tracks an element's content width so SVG charts can lay out in real pixels instead of scaling text. */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/** Round axis steps in the value's own unit (hours, %, ...): at most `maxTicks` gridlines above zero. */
export function niceTicks(maxValue: number, maxTicks = 4): number[] {
  if (maxValue <= 0) {
    return [0, 1];
  }

  const rough = maxValue / maxTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough)!;
  const ticks: number[] = [];
  for (let value = 0; value < maxValue + step; value += step) {
    ticks.push(Number(value.toFixed(6)));
    if (value >= maxValue) {
      break;
    }
  }
  return ticks;
}

/** A vertical bar whose data end (top) is rounded and whose baseline end stays square. */
export function barPath(x: number, y: number, width: number, height: number, radius = 4): string {
  if (height <= 0 || width <= 0) {
    return "";
  }

  const r = Math.min(radius, width / 2, height);
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${y + height}`,
    "Z"
  ].join(" ");
}

/** Sequential heat level 0 (none) to 5 for a value against fixed thresholds. */
export function heatLevel(value: number, thresholds: readonly number[]): number {
  if (value <= 0) {
    return 0;
  }
  const index = thresholds.findIndex((threshold) => value < threshold);
  return index === -1 ? thresholds.length + 1 : index + 1;
}
