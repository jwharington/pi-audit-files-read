# pi-audit-files-read

Pi extension that tracks `read` tool calls and provides `/audit-files-read`.

## Features

- Tracks every `read` tool call path in the current session branch
- Stores per-file stats:
  - read count
  - first read timestamp
  - last read timestamp
- Exposes `/audit-files-read` popup dialog with:
  - bordered centered overlay dialog
  - user-selectable sort: **name / time / count**
  - filename/path-focused list rows (no time/count text in each row)
  - paging controls (PageUp/PageDown, Ctrl+U/Ctrl+D)
  - searchable/selectable list via `SelectList`
  - in-dialog clear confirmation flow (Del → Del/y confirm, n cancel)
- Persists state in session custom entries and restores on session reload/tree navigation

## Install

### Local extension test

```bash
pi -e /home/jmw/opt/AI/pi-audit-files-read/index.ts
```

### As a project package

From your project root:

```bash
pi install /home/jmw/opt/AI/pi-audit-files-read -l
```

## Usage

- `/audit-files-read` -> open popup sorted by recent reads
- `/audit-files-read name` -> open popup sorted by file name
- `/audit-files-read time` -> open popup sorted by most recent read
- `/audit-files-read count` -> open popup sorted by descending read count
- `/audit-files-read summary` -> quick stats notification
- `/audit-files-read clear` -> clear tracked read data for current branch

## Popup controls

- `Tab` -> cycle sort mode
- `1` -> sort by name
- `2` -> sort by time
- `3` -> sort by count
- `PageDown` / `Ctrl+D` -> next page
- `PageUp` / `Ctrl+U` -> previous page
- `Del` -> start clear confirmation
- `Del` (again) or `y` -> confirm clear
- `n` -> cancel clear confirmation
- `Enter` -> load selected file audit details into editor
- `Esc` -> close dialog

## Notes

- This tracks reads only while the extension is active.
- State is branch-aware through session custom entries.
- Popup UI requires TUI mode (`ctx.mode === "tui"`).
