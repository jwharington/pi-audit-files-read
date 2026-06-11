import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Key,
  matchesKey,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

type SortMode = "name" | "time" | "count";

interface ReadAuditRecord {
  path: string;
  count: number;
  firstReadAt: number;
  lastReadAt: number;
}

interface PersistedState {
  records: ReadAuditRecord[];
  updatedAt: string;
}

const STATE_CUSTOM_TYPE = "pi-audit-files-read/state";

const SORT_LABEL: Record<SortMode, string> = {
  name: "Name",
  time: "Recent",
  count: "Count",
};

function normalizePath(rawPath: string): string {
  let value = rawPath.trim();
  if (value.startsWith("@")) value = value.slice(1);
  return value;
}

function formatDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "-";
  return new Date(timestamp).toLocaleString();
}

function parseSortMode(value: string | undefined): SortMode | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["name", "n", "alpha", "a-z"].includes(normalized)) return "name";
  if (["time", "recent", "t", "last"].includes(normalized)) return "time";
  if (["count", "c", "hits"].includes(normalized)) return "count";
  return undefined;
}

function nextSortMode(mode: SortMode): SortMode {
  if (mode === "name") return "time";
  if (mode === "time") return "count";
  return "name";
}

function sortedRecords(records: ReadAuditRecord[], sortMode: SortMode): ReadAuditRecord[] {
  const next = [...records];
  if (sortMode === "name") {
    next.sort((a, b) => a.path.localeCompare(b.path));
    return next;
  }
  if (sortMode === "time") {
    next.sort((a, b) => b.lastReadAt - a.lastReadAt || a.path.localeCompare(b.path));
    return next;
  }
  next.sort((a, b) => b.count - a.count || b.lastReadAt - a.lastReadAt || a.path.localeCompare(b.path));
  return next;
}

function restoreFromBranch(ctx: ExtensionContext): Map<string, ReadAuditRecord> {
  const records = new Map<string, ReadAuditRecord>();
  const branch = ctx.sessionManager.getBranch();
  let latest: PersistedState | undefined;

  for (const entry of branch) {
    if (entry.type !== "custom" || entry.customType !== STATE_CUSTOM_TYPE) continue;
    const data = entry.data as PersistedState | undefined;
    if (data?.records && Array.isArray(data.records)) {
      latest = data;
    }
  }

  if (!latest) return records;

  for (const record of latest.records) {
    if (!record.path || typeof record.path !== "string") continue;
    records.set(record.path, {
      path: record.path,
      count: Number(record.count) || 0,
      firstReadAt: Number(record.firstReadAt) || 0,
      lastReadAt: Number(record.lastReadAt) || 0,
    });
  }

  return records;
}

function persist(pi: ExtensionAPI, byPath: Map<string, ReadAuditRecord>): void {
  pi.appendEntry<PersistedState>(STATE_CUSTOM_TYPE, {
    records: [...byPath.values()],
    updatedAt: new Date().toISOString(),
  });
}

function buildListItem(record: ReadAuditRecord): SelectItem {
  return {
    value: record.path,
    label: record.path,
  };
}

function commandHelp(theme: any): string {
  return theme.fg(
    "dim",
    "tab cycle-sort • 1 name • 2 time • 3 count • pgup/pgdn page • del clear • y confirm • n cancel • enter select • esc close",
  );
}

export default function auditFilesReadExtension(pi: ExtensionAPI) {
  let byPath = new Map<string, ReadAuditRecord>();
  let dirty = false;

  function trackRead(path: string): void {
    const normalizedPath = normalizePath(path);
    if (!normalizedPath) return;

    const now = Date.now();
    const existing = byPath.get(normalizedPath);
    if (existing) {
      existing.count += 1;
      existing.lastReadAt = now;
      byPath.set(normalizedPath, existing);
    } else {
      byPath.set(normalizedPath, {
        path: normalizedPath,
        count: 1,
        firstReadAt: now,
        lastReadAt: now,
      });
    }
    dirty = true;
  }

  function flushIfDirty(): void {
    if (!dirty) return;
    persist(pi, byPath);
    dirty = false;
  }

  async function openAuditPopup(ctx: ExtensionContext, initialSort: SortMode): Promise<void> {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("/audit-files-read popup requires TUI mode", "warning");
      return;
    }

    if (byPath.size === 0) {
      ctx.ui.notify("No read tool calls tracked yet in this session.", "info");
      return;
    }

    await ctx.ui.custom<string | null>(
      (tui, theme, _kb, done) => {
        let sortMode: SortMode = initialSort;
        let pageIndex = 0;
        let clearConfirmPending = false;
        const pageSize = 12;

        let root = new Container();
        const title = new Text("", 1, 0);
        const pageInfo = new Text("", 1, 0);
        const warningInfo = new Text("", 1, 0);
        const footer = new Text("", 1, 0);
        const spacer = new Spacer(1);

        let selectList: SelectList | null = null;

        function getSorted(): ReadAuditRecord[] {
          return sortedRecords([...byPath.values()], sortMode);
        }

        function getPageCount(total: number): number {
          return Math.max(1, Math.ceil(total / pageSize));
        }

        function rebuildBody(): void {
          root = new Container();

          const sorted = getSorted();
          const pageCount = getPageCount(sorted.length);
          if (pageIndex >= pageCount) pageIndex = pageCount - 1;
          if (pageIndex < 0) pageIndex = 0;

          const start = pageIndex * pageSize;
          const pageItems = sorted.slice(start, start + pageSize);
          const selectItems = pageItems.map((record) => buildListItem(record));

          title.setText(
            theme.fg("accent", theme.bold("Audit Files Read")) +
              `  ` +
              theme.fg("muted", `sort=${SORT_LABEL[sortMode]} • total=${sorted.length}`),
          );
          root.addChild(title);

          pageInfo.setText(
            theme.fg("dim", `page ${pageIndex + 1}/${pageCount} • showing ${pageItems.length} item(s)`),
          );
          root.addChild(pageInfo);

          warningInfo.setText(
            clearConfirmPending
              ? theme.fg("warning", "Warning: Press Del again or y to confirm clear (n to cancel)")
              : "",
          );
          root.addChild(warningInfo);
          root.addChild(spacer);

          selectList = new SelectList(selectItems, pageSize, {
            selectedPrefix: (text) => theme.fg("accent", text),
            selectedText: (text) => theme.fg("accent", text),
            description: (text) => theme.fg("muted", text),
            scrollInfo: (text) => theme.fg("dim", text),
            noMatch: (text) => theme.fg("warning", text),
          });

          selectList.onSelect = (item) => {
            const record = byPath.get(item.value);
            if (!record) {
              done(item.value);
              return;
            }
            const line = `${record.path}\ncount=${record.count}\nfirst=${formatDate(record.firstReadAt)}\nlast=${formatDate(record.lastReadAt)}`;
            ctx.ui.setEditorText(line);
            ctx.ui.notify(`Loaded audit details for ${record.path} into editor`, "info");
            done(item.value);
          };
          selectList.onCancel = () => done(null);

          root.addChild(selectList);
          root.addChild(spacer);

          footer.setText(commandHelp(theme));
          root.addChild(footer);
        }

        function changeSort(next: SortMode): void {
          sortMode = next;
          pageIndex = 0;
          rebuildBody();
        }

        function changePage(delta: number): void {
          const totalPages = getPageCount(getSorted().length);
          pageIndex = Math.max(0, Math.min(totalPages - 1, pageIndex + delta));
          rebuildBody();
        }

        rebuildBody();

        return {
          render(width: number): string[] {
            if (width <= 4) {
              const lines = root.render(width);
              return lines.map((line) => truncateToWidth(line, width));
            }

            const innerWidth = width - 2;
            const horizontalPadding = 1;
            const contentWidth = Math.max(1, innerWidth - horizontalPadding * 2);
            const rawLines = root.render(contentWidth);
            const contentLines = rawLines.map((line) => {
              const trimmed = truncateToWidth(line, contentWidth);
              const pad = Math.max(0, contentWidth - visibleWidth(trimmed));
              return `${theme.fg("accent", "│")}${" ".repeat(horizontalPadding)}${trimmed}${" ".repeat(pad)}${" ".repeat(horizontalPadding)}${theme.fg("accent", "│")}`;
            });

            const top = theme.fg("accent", `┌${"─".repeat(innerWidth)}┐`);
            const bottom = theme.fg("accent", `└${"─".repeat(innerWidth)}┘`);
            return [top, ...contentLines, bottom];
          },
          invalidate(): void {
            root.invalidate();
          },
          handleInput(data: string): void {
            if (matchesKey(data, Key.escape)) {
              done(null);
              return;
            }
            if (matchesKey(data, Key.tab)) {
              changeSort(nextSortMode(sortMode));
              tui.requestRender();
              return;
            }
            if (data === "1") {
              changeSort("name");
              tui.requestRender();
              return;
            }
            if (data === "2") {
              changeSort("time");
              tui.requestRender();
              return;
            }
            if (data === "3") {
              changeSort("count");
              tui.requestRender();
              return;
            }
            if (matchesKey(data, "pagedown") || matchesKey(data, Key.ctrl("d"))) {
              changePage(1);
              tui.requestRender();
              return;
            }
            if (matchesKey(data, "pageup") || matchesKey(data, Key.ctrl("u"))) {
              changePage(-1);
              tui.requestRender();
              return;
            }
            if (matchesKey(data, "delete") || data === "\u001b[3~") {
              if (!clearConfirmPending) {
                clearConfirmPending = true;
                rebuildBody();
                tui.requestRender();
                return;
              }

              byPath = new Map<string, ReadAuditRecord>();
              dirty = true;
              flushIfDirty();
              ctx.ui.notify("Cleared read-file audit data for this session branch.", "info");
              done(null);
              return;
            }

            if (clearConfirmPending && (data === "y" || data === "Y")) {
              byPath = new Map<string, ReadAuditRecord>();
              dirty = true;
              flushIfDirty();
              ctx.ui.notify("Cleared read-file audit data for this session branch.", "info");
              done(null);
              return;
            }

            if (clearConfirmPending && (data === "n" || data === "N")) {
              clearConfirmPending = false;
              rebuildBody();
              ctx.ui.notify("Clear cancelled", "info");
              tui.requestRender();
              return;
            }

            selectList?.handleInput(data);
            tui.requestRender();
          },
        };
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: "88%",
          maxHeight: "85%",
          margin: 1,
        },
      },
    );
  }

  pi.on("session_start", (_event, ctx) => {
    byPath = restoreFromBranch(ctx);
    dirty = false;
  });

  pi.on("session_tree", (_event, ctx) => {
    byPath = restoreFromBranch(ctx);
    dirty = false;
  });

  pi.on("tool_call", (event, _ctx) => {
    if (event.toolName !== "read") return;
    const path = (event.input as { path?: unknown }).path;
    if (typeof path !== "string") return;
    trackRead(path);
  });

  pi.on("turn_end", () => {
    flushIfDirty();
  });

  pi.on("session_shutdown", () => {
    flushIfDirty();
  });

  pi.registerCommand("audit-files-read", {
    description: "Show read-tool audit with sortable paged popup (name/time/count)",
    getArgumentCompletions: (prefix) => {
      const values = ["name", "time", "count", "clear", "summary"];
      return values
        .filter((value) => value.startsWith(prefix.toLowerCase()))
        .map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();

      if (arg === "clear") {
        byPath = new Map<string, ReadAuditRecord>();
        dirty = true;
        flushIfDirty();
        ctx.ui.notify("Cleared read-file audit data for this session branch.", "info");
        return;
      }

      if (arg === "summary") {
        const totalReads = [...byPath.values()].reduce((sum, record) => sum + record.count, 0);
        ctx.ui.notify(`Tracked ${byPath.size} file(s), ${totalReads} read call(s).`, "info");
        return;
      }

      const sortMode = parseSortMode(arg) ?? "time";
      await openAuditPopup(ctx, sortMode);
    },
  });
}
