# Preserved website baseline

The original repository is preserved by commit `fba342d9492b33a6c5d0b7cf507102b2a7df33a9` and the local tag `archive/pre-refresh-20260912`. The tag is not pushed as part of PR preparation.

| Original location | Preserved location | Current use |
| --- | --- | --- |
| `themes/ai-theme/` | `archive/pre-refresh/themes/ai-theme/` | Historical source and assets; excluded from publishing |
| `config.toml` | `archive/pre-refresh/config.toml` | Original configuration reference |
| `.github/workflows/hugo.yml` | `archive/pre-refresh/hugo.yml` | Original deployment workflow reference |
| `content/` | Original paths | Existing posts and URLs remain active; event publication dates are separated from meeting dates |
| `README.md` | Original file prefix | Original credits and text retained; new instructions appended |

Active templates live in `layouts/`, browser code and media in `static/`, and editable new content in `content/review/`, `content/calendar/`, and `data/`. Hugo generates `public/`; do not commit it. No archive directory, database tooling or credentials belongs in that output.

To review the exact original website, use a separate checkout of the baseline commit. Do not reset or overwrite the integration branch to inspect the archive. The existing database migration files describe the separate Neon database and are unrelated to the archived theme.
