import { useState } from "react";
import { formatDuration, formatHourRange, formatPercent, weekdayName } from "../app/format";
import { heatLevel, useElementWidth } from "./chartUtils";
import { Tooltip, type TooltipState } from "./Tooltip";

const LABEL_WIDTH = 40;
const AXIS_BAND = 18;
const GAP = 2;

/** Reading time by weekday (rows, Monday first) and hour (columns). */
export function MatrixHeatmap({ matrix }: { matrix: number[][] }) {
  const [frameRef, width] = useElementWidth<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  const total = matrix.flat().reduce((sum, value) => sum + value, 0);
  // Quintiles of the non-empty cells: one late-evening peak would otherwise flatten every other hour into one shade.
  const nonEmpty = matrix
    .flat()
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  const thresholds = [0.2, 0.4, 0.6, 0.8].map((quantile) => nonEmpty[Math.floor(quantile * nonEmpty.length)] ?? 0);
  const cellWidth = Math.max(8, Math.floor((width - LABEL_WIDTH) / 24) - GAP);
  const cellHeight = Math.min(28, Math.max(16, cellWidth * 0.8));
  const pitchX = cellWidth + GAP;
  const pitchY = cellHeight + GAP;

  return (
    <div className="chart-frame" ref={frameRef}>
      {width > 0 ? (
        <svg
          width={LABEL_WIDTH + pitchX * 24}
          height={pitchY * 7 + AXIS_BAND}
          role="img"
          aria-label="Reading time by weekday and hour of day"
          onPointerLeave={() => setTooltip(null)}
        >
          {matrix.map((row, weekday) => (
            <g key={weekday}>
              <text className="axis-label" x={0} y={weekday * pitchY + cellHeight / 2} dy="0.32em">
                {weekdayName(weekday, "short")}
              </text>
              {row.map((value, hour) => (
                <rect
                  key={hour}
                  className={`heat heat-${heatLevel(value, thresholds)}`}
                  x={LABEL_WIDTH + hour * pitchX}
                  y={weekday * pitchY}
                  width={cellWidth}
                  height={cellHeight}
                  rx={2}
                  onPointerEnter={() =>
                    setTooltip({
                      x: LABEL_WIDTH + hour * pitchX + cellWidth / 2,
                      y: weekday * pitchY,
                      content: (
                        <>
                          <div className="tooltip-title">
                            {weekdayName(weekday)} · {formatHourRange(hour)}
                          </div>
                          <div className="tooltip-row">
                            {value > 0 ? `${formatDuration(value)} · ${formatPercent(value / total)} of reading` : "No reading"}
                          </div>
                        </>
                      )
                    })
                  }
                />
              ))}
            </g>
          ))}
          {Array.from({ length: 8 }, (_, step) => step * 3).map((hour) => (
            <text key={hour} className="axis-label" x={LABEL_WIDTH + hour * pitchX} y={pitchY * 7 + 12}>
              {String(hour).padStart(2, "0")}:00
            </text>
          ))}
        </svg>
      ) : null}
      <div className="legend heat-legend" aria-label="Color scale: each step is a fifth of the hours with any reading, from least to most">
        <span className="legend-item">
          <span className="swatch heat-0" aria-hidden="true" />
          None
        </span>
        {["Least", "", "", "", "Most"].map((text, index) => (
          <span className="legend-item" key={index}>
            <span className={`swatch heat-${index + 1}`} aria-hidden="true" />
            {text}
          </span>
        ))}
      </div>
      <Tooltip state={tooltip} frameWidth={width} />
    </div>
  );
}
