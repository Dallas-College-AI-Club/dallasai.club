# Club Office cleanup — October 3, 2026

## Scope and result

This cleanup covers the Club Office admin page and the server code it depends on: events,
inbox submissions, questions, surveys, contacts and sign-in. It follows
[club-office-review.md](club-office-review.md).

The changes are limited to `backend/`. The Hugo site, the `hugo` branch,
`.github/workflows/hugo.yml`, `config.toml`, `content/` and `archive/` are untouched.

**Result**
- **Size:** 11 commits on `backend/`, 2,045 lines removed and 996 added, about 1,050 fewer lines.
  Most additions are new tests.
- **Tests:** 114 unit tests became 120, after 5 tests for the retired password path were removed.
- **Verification:** every commit passed the full local check described under "How it was verified".

| Area | Lines removed | Lines added |
| --- | ---: | ---: |
| `admin/` | 493 | 160 |
| `lib/` | 245 | 62 |
| `api/` | 52 | 73 |
| `scripts/` | 389 | 84 (includes the new read-only query script) |
| `surveys/` | 37 | 3 |
| `tests/` | 823 | 646 |

## What changed

| Commit | Change |
| --- | --- |
| `5f8b57c` | One `admin/ui.js` replaces 16 copies of the DOM builder and 4 button helpers |
| `2c2aaee` | Removes code that could not run: the old in-page event preview, an event-type fallback, an archived-respondents branch and its styles, the retired comparison styles, a page-size fallback |
| `21c72b0` | Shared `lock()` for forms while saving (fixes a bug, below) |
| `31f1313` | Request and database hardening (fixes three bugs, below) |
| `b9bd916` | Survey ids are checked strictly before any query |
| `9d3d764` | Retires the password sign-in fallback; Neon Auth email codes are the only officer sign-in (717 lines) |
| `e2c0d23` | Every test uses a database built from all migrations; drops two "does this table exist?" queries from production paths |
| `3eba5db` | End-to-end tests for public form intake |
| `c83b4d8` | The build starts from an empty `public/` folder |
| `5da3ecf` | Prettier config, one format-only pass, and LF line endings for `backend/` |
| `adbdbce` | Merges the review session's site fix and `scripts/club-db-read.mjs` |

## Bugs fixed along the way

Each fix has a test that fails when the fix is undone.

- **Disabled buttons switched back on.** Saving, previewing or uploading in the event editor
  re-enabled every control afterwards. That included buttons that were disabled on purpose,
  such as "Move up" on the first choice. The same happened in survey respondents and survey
  results.
- **Failed `ROLLBACK`.** When a `ROLLBACK` failed, that error replaced the original one, and the
  broken connection went back into the pool.
- **Unparseable request bodies.** A body the platform could not parse came back as a 503 instead
  of a 400.
- **Cancelled downloads.** A cancelled attachment or event-image download left the function
  running until its time limit. Downloads now use `stream/promises` `pipeline()`.
- **Malformed survey ids.** An id such as 36 dashes reached Postgres on the survey-results route,
  and the officer saw a 503.
- **An untested privacy rule.** Permanently deleting an archived submission must keep the contact
  of anyone who is a custom-survey respondent. No test covered this, because the old test
  databases did not include the survey tables. It is covered now.

## How it was verified

For every commit:
- `npm test`.
- `npm run build`.
- Both Hugo builds the browser scripts need.
- The five admin browser scripts: `browser-office`, `browser`, `browser-events`,
  `browser-surveys` and `browser-event-layout`. `browser-site` was also run after the merge
  that touched `static/`.

Every new test was mutation-checked: undo the fix and confirm the test fails.

The formatting commit changes no code. All 38 changed `.js`, `.mjs` and `.css` files minify with
esbuild to the same output as before. The two HTML changes only re-wrap paragraph text.

## What is confirmed about Neon

- **Schema.** Production `club_forms` matches migrations 003–018 exactly: 489 of 489 tables,
  columns, indexes, constraints, triggers and functions. This was checked read-only by the
  review session.
- **Test schema.** Tests now build the same schema with `tests/helpers/db.mjs`, so the save paths
  are tested against the real tables.
- **Save paths covered by tests:**
  - public intake: questions, signups, RSVPs, requests, the spam trap, rejections;
  - inbox edits, archive and permanent deletion;
  - attachment downloads and their audit row;
  - events, surveys and contacts.
- **Events data.** The review session copied the 19 events that existed only as repository files
  into `club_forms.events`, with the user's approval. Their `updated_by` is
  `website-files-import`. Neon now holds 22 events: 21 live and 1 archived. The public events API
  serves the same 21 as before. From now on, edit those events in Club Office.
- **Email-queue leftovers.** `outbox` and `webhook_events` have 0 rows, `entries.email_verified`
  is never true, and all 7 inbox entries are `active`.

## Left for the redesign

The redesign rewrites these files, so cleaning them now would be wasted work. The full plan is
the review session's code-quality plan and redesign spec, saved outside the repository.

- **`index.js`.** Split it into a shell and an inbox, with one router that reads the URL hash
  once. Use one CSV download path: the survey export shows a raw error on a non-JSON reply. Use
  one submission editor and one contacts dialog.
- **More shared helpers.** Plurals (fixes "1 website submissions"), one Central-time format,
  a page size and kind labels in `ui.js`.
- **One question and choice editor** for both RSVP and custom surveys.
- **CSS.**
  - About 160 lines can be removed with no visual change: no-op declarations, duplicate rules,
    repeated media blocks.
  - One button hierarchy and one danger style.
  - Higher-contrast field borders.

## Later server cleanup

- **Validation helpers in one place.** Today there are:
  - 5 copies of the offset check and 6 UUID patterns;
  - the dedupe key defined twice, and the upcoming-event rule written twice;
  - 6 versions of the text validator. Unifying them changes behaviour, so add tests first.
- **Contacts.** The code is split across three files with a shared lock, revision check and
  activity insert.
- **Shared `sendCSV()`.** The admin CSV lacks `nosniff`.
- **Pagination helpers.** One page-offset helper and one "next page" helper.
- **Import cycles.** Two cycles in the survey modules. They touch the Advisor Studio code, so
  handle them with that change.
- **Small query fixes.**
  - One insert per file in contact purges.
  - One query per image in event validation.
  - `events.json` is read several times per request.
- **An index on `attachments(entry_id)`.** It needs a migration; none are planned for this
  release.

## Decisions waiting on someone

- **Vercel settings.** `AUTH_DATABASE_URL` and `BETTER_AUTH_SECRET` are no longer read and are
  still set in production. Remove them after the next deploy.
- **Email-queue schema.** A future migration 019 can drop `outbox`, `webhook_events`,
  `queue_new_entry()` and `entries.email_verified`. The daily maintenance no longer
  touches `webhook_events`; nothing has written to it since 2026-09-20.
- **Advisor Studio.** The round `advisor-studio-2026` is open until 2026-11-02 UTC. Moving its
  questions into Neon was approved, in this order:
  1. Replace the `definition IS NULL` checks with an explicit Advisor round check.
  2. Deploy that.
  3. Run a one-time fill script, tested on PGlite first.

  The respondent code can be retired only after the round closes.
- **`scripts/provision.mjs`.** It is the only record of how the forms runtime role was created,
  and it still creates the retired auth role. Trim it, or replace it with a short bootstrap
  section in `operations.md`.
- **Browser checks in CI.** Only `browser-office` runs in CI. Adding the other suites means
  changing `.github/workflows/hugo.yml`, which is left as it is. Run them locally before a
  release.
- **A real-looking address in a public file.** `tests/surveys.test.mjs` contains a test address
  that looks like a real student address. The repository is public.
- **The legacy `hugo` branch.** It is unprotected and its old workflow can still deploy to GitHub
  Pages. Only the repository admin can lock it. Left as it is by choice.
