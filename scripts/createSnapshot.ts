import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const workspaceRoot = process.cwd();
const exportsDir = join(workspaceRoot, "data", "exports");
const processedDir = join(workspaceRoot, "data", "processed");
const snapshotsDir = join(workspaceRoot, "data", "snapshots");

mkdirSync(exportsDir, { recursive: true });
mkdirSync(snapshotsDir, { recursive: true });

const exportCandidates = readdirSync(exportsDir)
  .map((name) => join(exportsDir, name))
  .filter((path) => path.toLowerCase().endsWith(".zip"))
  .map((path) => ({
    path,
    stat: statSync(path)
  }))
  .filter((entry) => entry.stat.isFile())
  .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

if (exportCandidates.length === 0) {
  throw new Error(
    "No zip exports found in data/exports. Put a new Amazon Kindle export zip there and run `bun run snapshot` again."
  );
}

const latestExport = exportCandidates[0];
const latestExportName = basename(latestExport.path);
const snapshotTimestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
const snapshotSlug = latestExportName.replace(/\.zip$/i, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
const snapshotId = `${snapshotTimestamp}-${snapshotSlug || "kindle-export"}`;
const snapshotRoot = join(snapshotsDir, snapshotId);
const snapshotProcessedDir = join(snapshotRoot, "processed");

mkdirSync(snapshotProcessedDir, { recursive: true });

// Without KINDLE_ARCHIVE_PATH the extractor merges every export in data/exports.
const { KINDLE_ARCHIVE_PATH: _archiveOverride, ...extractEnv } = process.env;
const extract = Bun.spawnSync(["bun", "run", "scripts/extractKindleData.ts"], {
  cwd: workspaceRoot,
  env: extractEnv,
  stderr: "inherit",
  stdout: "inherit"
});

if (extract.exitCode !== 0) {
  throw new Error(`Extract failed with exit code ${extract.exitCode ?? "unknown"}.`);
}

const metrics = Bun.spawnSync(["bun", "run", "scripts/buildDerivedMetrics.ts"], {
  cwd: workspaceRoot,
  env: process.env,
  stderr: "inherit",
  stdout: "inherit"
});

if (metrics.exitCode !== 0) {
  throw new Error(`Metrics failed with exit code ${metrics.exitCode ?? "unknown"}.`);
}

if (!existsSync(processedDir)) {
  throw new Error("Expected data/processed to exist after extract + metrics.");
}

for (const fileName of readdirSync(processedDir)) {
  if (!fileName.toLowerCase().endsWith(".json")) {
    continue;
  }

  cpSync(join(processedDir, fileName), join(snapshotProcessedDir, fileName));
}

function describeExport(entry: (typeof exportCandidates)[number]) {
  return {
    path: entry.path,
    fileName: basename(entry.path),
    sizeBytes: entry.stat.size,
    modifiedAt: entry.stat.mtime.toISOString()
  };
}

const metadata = {
  snapshotId,
  createdAt: new Date().toISOString(),
  sourceExport: describeExport(latestExport),
  mergedExports: exportCandidates.map(describeExport),
  outputs: {
    currentProcessedDir: processedDir,
    snapshotProcessedDir
  }
};

writeFileSync(join(snapshotRoot, "snapshot.json"), JSON.stringify(metadata, null, 2));

console.log(`Created snapshot ${snapshotId} from ${exportCandidates.length} export(s), latest ${latestExportName}.`);
