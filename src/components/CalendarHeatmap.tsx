import { useState } from "react";
import { formatDate, formatDuration, formatMonth, weekdayName } from "../app/format";
import { localDayKey } from "../app/model";
import { weekdayIndex } from "../app/stats";
import { heatLevel, useElementWidth } from "./chartUtils";
import { Tooltip, type TooltipState } from "./Tooltip";

const MINUTE_MS = 60_000;
export const CALENDAR_THRESHOLDS_MIN = [15, 30, 60, 120] as const;
const CALENDAR_THRESHOLDS_MS = CALENDAR_THRESHOLDS_MIN.map((minutes) => minutes * MINUTE_MS);
const LEGEND = ["Under 15 min", "15–30 min", "30–60 min", "1–2 h", "2 h or more"];

const LABEL_WIDTH = 36;
const MONTH_BAND = 16;
const GAP = 2;
const WEEKS = 53;

type Cell = { key: string; week: number; weekday: number; inRange: boolean };

function yearCells(year: number, start: string, end: string): Cell[] {
  const cells: Cell[] = [];
  const firstOffset = weekdayIndex(new Date(year, 0, 1).getTime());
  for (let date = new Date(year, 0, 1); date.getFullYear() === year; date.setDate(date.getDate() + 1)) {
    const key = localDayKey(date.getTime());
    const dayOfYear = Math.round((Date.UTC(year, date.getMonth(), date.getDate()) - Date.UTC(year, 0, 1)) / 86_400_000);
    cells.push({
      key,
      week: Math.floor((dayOfYear + firstOffset) / 7),
      weekday: weekdayIndex(date.getTime()),
      inRange: key >= start && key <= end
    });
  }
  return cells;
}

export function CalendarHeatmap({
  years,
  daily,
  start,
  end
}: {
  years: number[];
  daily: Map<string, number>;
  /** First and last day the export covers; days outside are drawn as "no data", not "no reading". */
  start: string;
  end: string;
}) {
  const [frameRef, width] = useElementWidth<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  // A single year may grow to fill the card; stacked years stay compact so the card doesn't get too tall.
  const maxCell = years.length > 1 ? 13 : 18;
  const cell = Math.max(6, Math.min(maxCell, Math.floor((width - LABEL_WIDTH) / WEEKS) - GAP));
  const pitch = cell + GAP;
  const yearHeight = MONTH_BAND + pitch * 7;
  const showYearLabels = years.length > 1;

  return (
    <div className="chart-frame calendar" ref={frameRef}>
      {width > 0
        ? years.map((year) => {
            const cells = yearCells(year, start, end);
            return (
              <svg
                key={year}
                width={LABEL_WIDTH + pitch * WEEKS}
                height={yearHeight}
                role="img"
                aria-label={`Reading time per day in ${year}`}
                className="calendar-year"
                onPointerLeave={() => setTooltip(null)}
              >
                {showYearLabels ? (
                  <text className="axis-label calendar-year-label" x={0} y={MONTH_BAND + pitch * 3.5} dy="0.32em">
                    {year}
                  </text>
                ) : (
                  [0, 2, 4].map((weekday) => (
                    <text key={weekday} className="axis-label" x={0} y={MONTH_BAND + pitch * weekday + cell / 2} dy="0.32em">
                      {weekdayName(weekday, "short")}
                    </text>
                  ))
                )}
                {cells
                  .filter((entry) => entry.key.endsWith("-01"))
                  .map((entry) => (
                    <text key={entry.key} className="axis-label" x={LABEL_WIDTH + entry.week * pitch} y={10}>
                      {formatMonth(entry.key.slice(0, 7))}
                    </text>
                  ))}
                {cells.map((entry) => {
                  const value = daily.get(entry.key) ?? 0;
                  return (
                    <rect
                      key={entry.key}
                      className={entry.inRange ? `heat heat-${heatLevel(value, CALENDAR_THRESHOLDS_MS)}` : "heat heat-out"}
                      x={LABEL_WIDTH + entry.week * pitch}
                      y={MONTH_BAND + entry.weekday * pitch}
                      width={cell}
                      height={cell}
                      rx={2}
                      onPointerEnter={(event) => {
                        const frame = frameRef.current!.getBoundingClientRect();
                        const target = event.currentTarget.getBoundingClientRect();
                        setTooltip({
                          x: target.left - frame.left + cell / 2,
                          y: target.top - frame.top,
                          content: (
                            <>
                              <div className="tooltip-title">{formatDate(entry.key)}</div>
                              <div className="tooltip-row">
                                {entry.inRange ? (value > 0 ? formatDuration(value) : "No reading") : "Outside the export"}
                              </div>
                            </>
                          )
                        });
                      }}
                    />
                  );
                })}
              </svg>
            );
          })
        : null}
      <div className="legend heat-legend" aria-label="Color scale: reading time per day">
        <span className="legend-item">
          <span className="swatch heat-0" aria-hidden="true" />
          No reading
        </span>
        {LEGEND.map((text, index) => (
          <span className="legend-item" key={text}>
            <span className={`swatch heat-${index + 1}`} aria-hidden="true" />
            {text}
          </span>
        ))}
      </div>
      <Tooltip state={tooltip} frameWidth={width} />
    </div>
  );
}
