import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { SeriesPoint } from "../app/stats";
import { barPath, niceTicks, useElementWidth } from "./chartUtils";
import { Tooltip, TooltipRow } from "./Tooltip";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/** Minimum distance between x-axis label centers before labels are thinned out. */
const MIN_LABEL_GAP = 44;
const MARGIN = { top: 8, right: 0, bottom: 24, left: 44 };
const MAX_BAR_WIDTH = 28;

export type BarChartProps = {
  points: SeriesPoint[];
  ariaLabel: string;
  /** Tooltip heading for a point. */
  label: (key: string) => string;
  /** X-axis label for a point, or null to leave that slot unlabeled. */
  tickLabel: (key: string, index: number) => string | null;
  formatValue: (value: number) => string;
  seriesName: string;
  compareName?: string;
  /** Values are milliseconds by default and the axis reads in hours; pass "count" for plain numbers. */
  unit?: "ms" | "count";
  height?: number;
  onSelect?: (key: string) => void;
  /** Extra tooltip line for a point. */
  detail?: (key: string) => ReactNode;
};

export function BarChart({
  points,
  ariaLabel,
  label,
  tickLabel,
  formatValue,
  seriesName,
  compareName,
  unit = "ms",
  height = 200,
  onSelect,
  detail
}: BarChartProps) {
  const [frameRef, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const hasCompare = points.some((point) => point.compare !== undefined);
  const maxRaw = Math.max(0, ...points.flatMap((point) => [point.value, point.compare ?? 0]));
  // Durations read in hours, or in minutes when every bar is under two hours.
  const axisScale = unit === "count" ? 1 : maxRaw < 2 * HOUR_MS ? MINUTE_MS : HOUR_MS;
  const axisSuffix = unit === "count" ? "" : axisScale === MINUTE_MS ? " min" : " h";
  const toAxis = (value: number) => value / axisScale;
  const ticks = niceTicks(toAxis(maxRaw));
  const top = ticks.at(-1)!;

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const band = points.length > 0 ? plotWidth / points.length : 0;
  const gap = Math.max(2, band * 0.25);
  const groupWidth = Math.max(1, band - gap);
  const barWidth = Math.min(MAX_BAR_WIDTH, hasCompare ? (groupWidth - 2) / 2 : groupWidth);
  const y = (value: number) => MARGIN.top + plotHeight - (toAxis(value) / top) * plotHeight;

  // Thin out x labels right to left, so the most recent label always survives a collision.
  const visibleTicks = new Map<number, string>();
  let lastLabelX = Number.POSITIVE_INFINITY;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const text = tickLabel(points[index].key, index);
    const x = MARGIN.left + band * (index + 0.5);
    if (text && lastLabelX - x >= MIN_LABEL_GAP) {
      visibleTicks.set(index, text);
      lastLabelX = x;
    }
  }

  const bandAt = (clientX: number, rect: DOMRect) => {
    const index = Math.floor((clientX - rect.left - MARGIN.left) / band);
    return index >= 0 && index < points.length ? index : null;
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setActive(bandAt(event.clientX, rect));
    setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      setActive((current) => Math.min(points.length - 1, Math.max(0, (current ?? (delta > 0 ? -1 : points.length)) + delta)));
      setPointer(null);
    } else if (event.key === "Enter" && active !== null && onSelect) {
      onSelect(points[active].key);
    }
  };

  const activePoint = active !== null ? points[active] : null;
  const tooltipX = pointer?.x ?? (active !== null ? MARGIN.left + band * (active + 0.5) : 0);
  const tooltipY = pointer?.y ?? MARGIN.top;

  return (
    <div className="chart-frame" ref={frameRef}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          className={onSelect ? "chart-svg is-selectable" : "chart-svg"}
          onPointerMove={onPointerMove}
          onPointerLeave={() => {
            setActive(null);
            setPointer(null);
          }}
          onClick={() => activePoint && onSelect?.(activePoint.key)}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className={tick === 0 ? "axis-baseline" : "axis-grid"}
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(tick * axisScale)}
                y2={y(tick * axisScale)}
              />
              <text className="axis-label" x={MARGIN.left - 8} y={y(tick * axisScale)} dy="0.32em" textAnchor="end">
                {`${tick}${axisSuffix}`}
              </text>
            </g>
          ))}

          {active !== null ? (
            <rect className="hover-band" x={MARGIN.left + band * active} y={MARGIN.top} width={band} height={plotHeight} />
          ) : null}

          {points.map((point, index) => {
            const groupX = MARGIN.left + band * index + (band - (hasCompare ? barWidth * 2 + 2 : barWidth)) / 2;
            const baseline = MARGIN.top + plotHeight;
            const tick = visibleTicks.get(index);
            return (
              <g key={point.key}>
                {hasCompare ? (
                  <path className="bar bar-compare" d={barPath(groupX, y(point.compare ?? 0), barWidth, baseline - y(point.compare ?? 0))} />
                ) : null}
                <path
                  className="bar bar-primary"
                  d={barPath(hasCompare ? groupX + barWidth + 2 : groupX, y(point.value), barWidth, baseline - y(point.value))}
                />
                {tick ? (
                  <text className="axis-label" x={MARGIN.left + band * (index + 0.5)} y={height - 6} textAnchor="middle">
                    {tick}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {hasCompare && compareName ? (
        <div className="legend">
          <span className="legend-item">
            <span className="swatch swatch-compare" aria-hidden="true" />
            {compareName}
          </span>
          <span className="legend-item">
            <span className="swatch swatch-primary" aria-hidden="true" />
            {seriesName}
          </span>
        </div>
      ) : null}
      <Tooltip
        frameWidth={width}
        state={
          activePoint
            ? {
                x: tooltipX,
                y: tooltipY,
                content: (
                  <>
                    <div className="tooltip-title">{label(activePoint.key)}</div>
                    <TooltipRow swatch={hasCompare ? "swatch-primary" : undefined} label={seriesName} value={formatValue(activePoint.value)} />
                    {hasCompare && compareName ? (
                      <TooltipRow swatch="swatch-compare" label={compareName} value={formatValue(activePoint.compare ?? 0)} />
                    ) : null}
                    {detail ? <div className="tooltip-detail">{detail(activePoint.key)}</div> : null}
                  </>
                )
              }
            : null
        }
      />
    </div>
  );
}
