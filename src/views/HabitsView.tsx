import { formatCount, formatDuration, formatHourRange, formatPercent, weekdayName } from "../app/format";
import type { Library } from "../app/model";
import type { Route } from "../app/router";
import { periodKey, type Period } from "../app/stats";
import { BarChart } from "../components/BarChart";
import { MatrixHeatmap } from "../components/MatrixHeatmap";
import { Card, DataTable, EmptyState, PeriodPicker, StatTile } from "../components/ui";
import { SITTING_BINS, SITTING_GAP_SECONDS } from "../lib/readingDataset";

type ViewProps = { library: Library; route: Route; update: (patch: Partial<Route>) => void };

/** Bins from "30–60 min" up count as long sittings. */
const LONG_SITTING_BIN = 3;

export function HabitsView({ library, route, update }: ViewProps) {
  const period: Period = route.year === null ? { kind: "all" } : { kind: "year", year: route.year };
  const periodName = period.kind === "all" ? "all time" : String(period.year);
  const habits = library.habits[periodKey(period)];

  const matrix = habits ? habits.hours.map((row) => row.map((seconds) => seconds * 1000)) : [];
  const totalMs = matrix.flat().reduce((sum, value) => sum + value, 0);
  const byWeekday = matrix.map((row) => row.reduce((sum, value) => sum + value, 0));
  const byHour = Array.from({ length: 24 }, (_, hour) => matrix.reduce((sum, row) => sum + row[hour], 0));
  const peakHour = byHour.indexOf(Math.max(...byHour));
  const peakWeekday = byWeekday.indexOf(Math.max(...byWeekday));
  const bins = habits
    ? SITTING_BINS.map((bin, index) => ({ label: bin.label as string, count: habits.sittingBins[index][0], ms: habits.sittingBins[index][1] * 1000 }))
    : [];
  const sittingMs = bins.reduce((sum, bin) => sum + bin.ms, 0);
  const longMs = bins.slice(LONG_SITTING_BIN).reduce((sum, bin) => sum + bin.ms, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Habits</h1>
          <p className="page-subtitle">
            When and how long I read, in {library.timeZone.replace(/_/g, " ")} time. Reading fragments less than{" "}
            {SITTING_GAP_SECONDS / 60} minutes apart count as one sitting.
          </p>
        </div>
      </div>

      <div className="filter-row">
        <PeriodPicker years={library.years} year={route.year} onChange={(year) => update({ year })} />
      </div>

      {!habits || totalMs === 0 ? (
        <section className="card">
          <EmptyState>No reading recorded in {periodName}.</EmptyState>
        </section>
      ) : (
        <>
          <div className="stats">
            <StatTile label="Peak hour" value={formatHourRange(peakHour)} detail={`${formatPercent(byHour[peakHour] / totalMs)} of reading time`} />
            <StatTile label="Busiest day" value={weekdayName(peakWeekday)} detail={`${formatPercent(byWeekday[peakWeekday] / totalMs)} of reading time`} />
            <StatTile
              label="Typical sitting"
              value={formatDuration(habits.medianSittingSeconds * 1000)}
              detail={`Median of ${formatCount(habits.sittingCount)} sittings`}
            />
            <StatTile
              label="Long sittings"
              value={formatPercent(sittingMs > 0 ? longMs / sittingMs : 0)}
              detail={`of time is in sittings of 30 min or more; longest ${formatDuration(habits.longestSittingSeconds * 1000)}`}
            />
          </div>

          <Card
            title="When I read"
            subtitle={`Reading time by weekday and hour, ${periodName}`}
            table={
              <DataTable
                caption="Reading minutes by weekday and hour"
                rows={matrix.map((row, weekday) => ({ row, weekday }))}
                rowKey={({ weekday }) => String(weekday)}
                columns={[
                  { key: "day", header: "Day", cell: ({ weekday }) => weekdayName(weekday) },
                  ...Array.from({ length: 24 }, (_, hour) => ({
                    key: String(hour),
                    header: `${String(hour).padStart(2, "0")}h`,
                    numeric: true,
                    cell: ({ row }: { row: number[] }) => (row[hour] > 0 ? Math.round(row[hour] / 60_000) : "")
                  }))
                ]}
              />
            }
          >
            <MatrixHeatmap matrix={matrix} />
          </Card>

          <div className="grid-2">
            <Card
              title="By weekday"
              subtitle={`Total reading time, ${periodName}`}
              table={
                <DataTable
                  caption="Reading time by weekday"
                  rows={byWeekday.map((ms, weekday) => ({ ms, weekday }))}
                  rowKey={({ weekday }) => String(weekday)}
                  columns={[
                    { key: "day", header: "Day", cell: ({ weekday }) => weekdayName(weekday) },
                    { key: "time", header: "Time", numeric: true, cell: ({ ms }) => formatDuration(ms) },
                    { key: "share", header: "Share", numeric: true, cell: ({ ms }) => formatPercent(ms / totalMs) }
                  ]}
                />
              }
            >
              <BarChart
                points={byWeekday.map((value, weekday) => ({ key: String(weekday), value }))}
                ariaLabel={`Reading time by weekday, ${periodName}`}
                seriesName="Reading time"
                label={(key) => weekdayName(Number(key))}
                tickLabel={(key) => weekdayName(Number(key), "short")}
                formatValue={formatDuration}
                detail={(key) => `${formatPercent(byWeekday[Number(key)] / totalMs)} of reading`}
                height={180}
              />
            </Card>

            <Card
              title="By time of day"
              subtitle={`Total reading time per hour, ${periodName}`}
              table={
                <DataTable
                  caption="Reading time by hour of day"
                  rows={byHour.map((ms, hour) => ({ ms, hour }))}
                  rowKey={({ hour }) => String(hour)}
                  columns={[
                    { key: "hour", header: "Hour", cell: ({ hour }) => formatHourRange(hour) },
                    { key: "time", header: "Time", numeric: true, cell: ({ ms }) => formatDuration(ms) },
                    { key: "share", header: "Share", numeric: true, cell: ({ ms }) => formatPercent(ms / totalMs) }
                  ]}
                />
              }
            >
              <BarChart
                points={byHour.map((value, hour) => ({ key: String(hour), value }))}
                ariaLabel={`Reading time by hour of day, ${periodName}`}
                seriesName="Reading time"
                label={(key) => formatHourRange(Number(key))}
                tickLabel={(key) => (Number(key) % 6 === 0 ? `${key.padStart(2, "0")}:00` : null)}
                formatValue={formatDuration}
                detail={(key) => `${formatPercent(byHour[Number(key)] / totalMs)} of reading`}
                height={180}
              />
            </Card>
          </div>

          <Card
            title="Sitting length"
            subtitle="Where my reading time goes, by how long each sitting lasted"
            table={
              <DataTable
                caption="Sittings by length"
                rows={bins}
                rowKey={(bin) => bin.label}
                columns={[
                  { key: "length", header: "Sitting length", cell: (bin) => bin.label },
                  { key: "count", header: "Sittings", numeric: true, cell: (bin) => formatCount(bin.count) },
                  { key: "time", header: "Time", numeric: true, cell: (bin) => formatDuration(bin.ms) },
                  { key: "share", header: "Share of time", numeric: true, cell: (bin) => formatPercent(bin.ms / sittingMs) }
                ]}
              />
            }
          >
            <BarChart
              points={bins.map((bin) => ({ key: bin.label, value: bin.ms }))}
              ariaLabel="Reading time by sitting length"
              seriesName="Reading time"
              label={(key) => `Sittings ${key.toLowerCase()}`}
              tickLabel={(key) => key}
              formatValue={formatDuration}
              detail={(key) => {
                const bin = bins.find((entry) => entry.label === key)!;
                return `${formatCount(bin.count)} sittings · ${formatPercent(bin.ms / sittingMs)} of reading`;
              }}
              height={200}
            />
          </Card>
        </>
      )}
    </div>
  );
}
