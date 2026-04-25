# Local data drops

Folder for **local-only** data files used by import scripts. Everything in
this directory is gitignored except the folder structure itself.

## Subfolders

### `legacy/`
Drop a TSV or CSV here, then run:

```bash
npm run ingest:legacy -- ./data/legacy/your-file.tsv
```

Required columns (case-insensitive, underscores/dashes/spaces ok):
- `docketNumber` (MC) or `dotNumber` (DOT) — at least one
- `legalName`
- Optional but recommended: `dbaName`, `busnAddress`, `busnCity`, `busnState`,
  `busnZip`, `busnPhone`, `busnFax`, `emailAddress`, `trucksTotal`, `RiskOverall`

The script auto-detects whether the file is tab- or comma-separated.

Default capture date is `2021-11-30`. Override with `--date=YYYY-MM-DD`.
Default source label is `partner-2021`. Override with `--source=label`.
Add `--dry-run` to see what would be inserted without writing anything.

### Privacy

Files in `data/` are gitignored on purpose. Don't commit raw partner data,
even if it's "public record" — bulk-exposing 5,700 emails on github is a
mass-doxxing footgun.
