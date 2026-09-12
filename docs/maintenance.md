# Maintain and improve the website

Use the [README](../README.md) to run the site and find content files. This guide covers ownership, automation and decisions for future work. Update both guides in place until official GitHub deployment; keep progress notes in the active work item instead of adding changelogs.

## Keep one editing workflow

Assign a primary editor and backup for events, articles, projects and club information. A maintainer owns code, publishing and connected services. Record those assignments and access in the club's working space; do not assume the people credited for building the website own every service.

For each update: confirm the facts, edit the shared content, run the checks, preview the affected pages, and have a second person review before publishing. Keep final wording in its content file. Unpublished drafts and attendee records belong outside the public website.

| When                           | What to review                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| Before an event                | Date, Central time, location/joining link, agenda, preparation and contact            |
| After an event                 | Confirmed historical details; preserve the event ID and shared link                   |
| Before an article is published | Author, sample status, date, references, article link and feed entry                  |
| When a project changes         | Stage, actual demo capability, description and matching search/news entries           |
| At each new term               | Advisors, Teams/social links, college programs, upcoming events and remaining samples |
| At officer handoff             | Owners and access, plus a complete trial update by the incoming editor                |

This cadence applies [GOV.UK's guidance on reviewing existing content](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/plan-manage-content/manage-existing-govuk-content/). Keep review reminders in the team's task system rather than another copy of the website content.

## Automation available now

| Working feature              | What it handles                                                                              | What remains manual                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Shared events                | Calendar, calendar downloads, search, game news and Latest's next event                      | Confirm facts; saving or downloading does not register attendance                       |
| Shared articles and Lab data | Reading estimates, search, Latest selections and Lab discovery                               | Review facts, authorship and sample status                                              |
| Stable article links         | Slug URLs and permanent numeric aliases keep bookmarks intact when articles move             | Keep published slugs and existing aliases unchanged; new articles need no numeric alias |
| Generated RSS                | Hugo builds `/review-feed.xml` from published Markdown articles and the shared site URL      | Rebuild to publish edits; drafts and scheduled articles are excluded until eligible     |
| Shared club settings         | Reuses contacts, social links and copyright                                                  | Confirm the details with their owners                                                   |
| Shared project links         | `PROJECT_LINKS` supplies Start-menu labels, search names/descriptions and destinations       | Other page and news descriptions still require coordinated edits                        |
| Latest refresh               | Refreshes open Latest windows from Hugo-generated `latest.json` while preserving their state | Hugo must rebuild and publish edits; other open pages need a refresh                    |
| Local checks                 | Formatting, lint, imports, assets, content structure and covered behavior                    | Visual review, factual accuracy and external service checks                             |
| Browser storage              | Game progress, personal event plans and saved draft text                                     | Limited to that browser; files are not uploaded or saved with drafts                    |

The GitHub Actions workflow builds Hugo, runs the source and integration checks, and saves a review artifact for each pull request. Only the existing deployment branches publish to GitHub Pages. See [publishing instructions](../README.md#publishing-and-preserved-material).

## Improve maintenance in this order

Effort describes relative implementation size, not a delivery estimate. Add automation when it removes a real recurring task.

| Priority / effort                                     | Before → after                                                                                                        | Evidence and validation                                                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| At GitHub handoff / medium                            | Editors run checks and send screenshots manually → automatic checks and a reviewable preview for each proposed change | An incoming editor changes an event and a reviewer verifies its page before publishing; the existing checks must pass                       |
| Before project updates become frequent / small–medium | Menu/search entries are shared, but page/news copy is separate → extend the catalog to common summaries and stages    | Change one project fact and verify Projects, Latest, game news and search agree; preserve existing anchors and useful surface-specific copy |
| If editors struggle with source files / medium        | An officer edits Markdown or JSON → a small form edits approved fields with a draft preview                           | Observe a first-time editor completing an accurate update before selecting a content-management system                                      |
| Once live / small–medium                              | Editors discover broken links or failed flows by chance → scheduled checks notify the assigned owner                  | Retry temporary failures; verify an actionable alert and recovery, without treating an HTTP success as proof of correct content             |

Use the existing Node checks in CI; [GitHub's Node.js guide](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs) describes installing dependencies and running tests in Actions. Validate the Hugo build and preview before publishing through GitHub Pages. If Microsoft Lists becomes the editor interface, start with a one-way export of approved public event fields. Keep attendee data in a separate private list.

## Proposed UX changes

These proposals apply published guidance to behavior visible in the source. They have not been validated with students. Subscription replacement is **not approved**; the submission redesign is **pending approval**. Keep their current interfaces until those decisions change. Event planning and calendar downloads are already implemented as independent actions.

| Priority / effort                          | Current behavior → reviewable proposal                                                                                                                                                 | Validation before release                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| High / small; not approved                 | Subscribe asks for an email to preview a form without creating a subscription → “Follow the club” offers working Teams, social and RSS links, with an email-unavailable note           | A visitor finds a working follow option and correctly explains whether an email subscription exists   |
| High / small; pending                      | “Send draft for submission” opens email; the file picker only lists filenames → “Open email draft” shows the editor address and attachment instructions, retaining local save/download | Try with and without a mail app; the visitor keeps their text and knows files still need attaching    |
| Medium / medium; facts and approval needed | “Build with us” leads to the general Teams community → each project offers one confirmed first contribution task and the responsible contact/topic                                     | After trying a demo, a newcomer can choose a useful next step without guessing what the project needs |

The first two proposals follow [W3C's advice to ask only for necessary form information](https://www.w3.org/WAI/tutorials/forms/) and [clearly communicate outcomes and recovery](https://www.w3.org/WAI/tutorials/forms/notifications/). The contribution proposal applies [GOV.UK's task-based user-needs guidance](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/plan-manage-content/identify-user-needs/); its value is a hypothesis, not evidence that the current project pages are unused.

Preserve the approved concept visuals and Latest desktop while testing their task flow. Check descriptive headings, keyboard order, focus, readable phone layouts and reduced motion. [W3C's page structure guidance](https://www.w3.org/WAI/tutorials/page-structure/) explains orientation and navigation. Its [minimum target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) specifies 24 by 24 CSS pixels with exceptions; aim larger for primary controls. These are checks to perform, not a claim of accessibility conformance.

## Future shared leaderboard (deferred)

Cloudflare Workers and Turnstile setup is deferred until the owner is ready. A separate Neon database, `dallasai_club`, is prepared in the existing project and branch. The existing Neon Auth database and tables are unchanged. The website is not connected to the new database. Shared rankings are disabled in the published site; the former Node score store is retained only in the development test harness.

Keep Hugo and GitHub Pages for the website. The planned request flow is: browser → Cloudflare Worker → Neon. Turnstile adds a check to score submissions, and the Worker verifies its response before accepting a score. The browser receives the public API address and Turnstile site key; database credentials and the Turnstile secret stay on the server.

When this work resumes:

1. Use the prepared database and restricted role described below. Store the restricted Neon PostgreSQL connection string as the Worker's `DATABASE_URL` secret; a Neon account-management API key is not needed for ordinary database queries. Keep local credentials outside Git and cloud-synced project folders, and keep only placeholders in documentation or example configuration.
2. Implement the leaderboard read and score-submission endpoints, server-side Turnstile verification, input checks, rate limits and duplicate handling. A browser-generated player ID is not proof of identity. Define how players and their scores are associated before enabling updates, and publish only the intended nickname, game, score and date fields.
3. Keep the implemented unavailable-rankings state and local game progress until the reviewed API is ready. RSS and Latest already use Hugo-generated output and do not depend on that service.
4. Before enabling public score submissions, test successful and repeated submissions, invalid scores, rejected Turnstile responses and service outages. Assign an owner for moderation, backups and usage limits. Confirm the actual account plans and quotas; free tiers do not guarantee unlimited use. Turnstile reduces automated abuse but does not prove that a browser-reported score was earned.

Use Cloudflare's [Neon integration guide](https://developers.cloudflare.com/workers/databases/third-party-integrations/neon/) and [server-side Turnstile validation guide](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) when implementing this work.

### Prepared database and maintenance

The `dallasai_club` database contains the `leaderboard` schema. It was prepared without importing player records or scores. It shares the existing Neon project's resources and plan limits; creating this database does not create a separate Neon project or hosting plan.

| Object                                                | Purpose                                                                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `leaderboard.players`                                 | Opaque player UUID, creation time and an administrator-controlled blocked flag; no email, password or session token                      |
| `leaderboard.daily_scores`                            | One best score per player, game and Central Time day, plus nickname and the timestamp when that score was first saved                    |
| `leaderboard.schema_migrations`                       | Applied migration version and checksum; preserve applied SQL files and add a new migration for later schema changes                      |
| `leaderboard.submit_score(uuid, text, text, integer)` | Validates and atomically saves a daily best score; computes the date and timestamp on the server; rejects blocked players                |
| `leaderboard.list_scores(text, date)`                 | Returns the top ten, one result per player; accepts a Central Time date or `NULL` for all time; excludes blocked players and private IDs |

Scores must be integers from 1 to 1,000,000 for `explore`, `ride` or `snake`. Nicknames are trimmed and limited to 2–20 letters, numbers, spaces, dots, dashes or underscores. The database accepts Unicode nicknames; the future Worker must also apply the existing JavaScript nickname validation. A lower or repeated score can update the nickname but preserves the best score and its timestamp. Equal scores rank by the earlier timestamp, then a stable private ID.

The `dallasai_leaderboard_api` login can execute only the two leaderboard functions within this schema. It cannot read or write the underlying tables directly, change moderation flags, create database objects or administer roles. Public access to the new database and its functions is revoked. The functions use a fixed search path and fully qualified table names, following PostgreSQL's [guidance for functions that execute with their owner's permissions](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY). The future Worker remains responsible for verifying player identity, checking Turnstile, rate limiting and validating requests before calling them.

Local connection files are stored outside this repository and OneDrive, in `%LOCALAPPDATA%\dallasai-club-website\`:

| Private file                 | Intended use                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `secrets.env`                | Original supplied administrative connection; preserved unchanged                                    |
| `secrets.env.database-admin` | Administrative connection to `dallasai_club` for migrations, moderation and recovery                |
| `secrets.env.worker`         | Restricted connection to `dallasai_club`; use its `DATABASE_URL` value for the future Worker secret |

These are private plaintext files, not public documentation or encrypted backups. The database maintenance runner explicitly loads them; Wrangler will not automatically load this external folder. Keep passwords and full connection strings out of source, browser scripts, Hugo output, commands and screenshots.

From the website folder, with Node.js 22.13+ and PostgreSQL 18+ `psql` available, use:

```sh
node database/manage.mjs inspect
node database/manage.mjs verify
```

`inspect` reads database and role metadata. `verify` tests score handling, Unicode nicknames, date filters, ranking order, the top-ten limit, moderation, invalid input and actual restricted-account access. Every test runs inside a transaction that is rolled back. Connections require TLS and channel binding; credentials are passed privately to the database client rather than included in command arguments.

The initial setup is implemented in [the database runner](../database/manage.mjs), [migration 001](../database/migrations/001_leaderboard.sql) and [database checks](../database/verify.sql). `node database/manage.mjs apply` creates the dedicated database if needed, refuses an unrelated existing database or role, and applies migration 001 transactionally. On a completed setup it checks the stored checksum and verifies the existing setup without replacing credentials or data. Extend the runner with a new numbered migration for future schema changes. Keep these files with the Hugo source during GitHub integration; do not place them in Hugo's published output.

When implementing the Worker, map `GET /api/leaderboard?game=...&date=all` to `list_scores(game, NULL)` and a date filter to `list_scores(game, date)`. Map score submissions to `submit_score` using the player UUID from a verified server-issued session, never trusting the request body's `playerId` as authentication. Both functions return the existing public fields: `nickname`, `score`, `game`, `date` and `savedAt`; wrap list results as `{ entries: [...] }`. No browser integration, player-session service, Turnstile setup, score import or scheduled backup is enabled by this database preparation.

## Future event registration

This requires Microsoft 365 setup beyond the website. Keep “Save to my plans” and “Add to calendar” distinct from a future registration service.

1. An event's “Register” link opens a short Microsoft Form identifying the event.
2. Power Automate receives the response, retrieves its details and validates the event and email.
3. The flow creates or updates a registration in a private SharePoint list.
4. After the list write succeeds, it sends confirmation with the date, Central time, joining details and contact.
5. An owner handles failures, changes and cancellations. Add reminders after registration works reliably.

Microsoft documents the [Forms trigger and response details](https://learn.microsoft.com/en-us/connectors/microsoftforms/), [SharePoint list actions](https://learn.microsoft.com/en-us/connectors/sharepointonline/) and [emailing respondents](https://learn.microsoft.com/en-us/power-automate/forms/popular-scenarios). This sequence is a proposed combination of those capabilities, not a configured flow.

| Decision                | Starting point                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audience and account    | Choose college sign-in or outside attendees; ask public respondents for an email if confirmation is needed                                            |
| Ownership               | Club-managed form, primary and backup flow owners, private organizer list and authorized email sender; confirm college access and licensing           |
| Record                  | Stable event ID, form/response ID, attendee email, necessary name information, registration status and confirmation status                            |
| Retries and duplicates  | Reprocessing one response must not create another registration; define repeat signup, cancellation and retry behavior                                 |
| Email and recovery      | Send after the saved registration; track confirmation attempts and offer an organizer retry path without promising exactly-once delivery              |
| Public/private boundary | Explain data purpose and removal; keep optional newsletter signup separate; publish only approved event/form URLs, never attendee data or credentials |

The Forms connector requires an organizational account; group forms may need the Form ID entered manually. See [connector limitations](https://learn.microsoft.com/en-us/connectors/microsoftforms/) and [Microsoft's response-audience settings](https://support.microsoft.com/en-us/forms/send-a-form-and-collect-responses). Confirm sender permissions in the chosen mailbox before enabling email.

Use a test form, private list and designated recipients to check success, duplicate responses, invalid email, closed events, failed list writes and failed email. Verify recovery and what the attendee sees before enabling a public registration link.

## Facts and decisions needed before launch

Confirm any event location/joining details still marked unconfirmed, the submission inbox owner, public-facing sample content, project owners and contribution tasks. Confirm the public domain, Hugo build and GitHub Pages deployment access. Shared rankings remain a [deferred integration](#future-shared-leaderboard-deferred); confirm their owner and backup plan before enabling that service. Connected registration, uploads and subscriptions each need an owner and a tested service; the website alone does not provide them. Keep unknown details explicit until the responsible person supplies them.

## Test the tasks students actually need

Run a small round with students unfamiliar with the site, including phone users and people who use a keyboard or assistive technology. Give tasks without explaining the controls. Observe completion, mistaken expectations, hesitation and recovery. [GOV.UK's moderated testing guide](https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing) describes this method. Browser automation can check behavior; it cannot establish student interest or usefulness.

| Task                              | Successful outcome                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Find a meeting and plan to attend | Identify date, time, location/contact; save/remove a plan and download a calendar entry independently |
| Join or follow the club           | Reach the intended destination and understand any sign-in requirement                                 |
| Find a useful project             | Identify what works, try it and find a way to contribute                                              |
| Explore an AI idea                | Change an experiment, interpret the result and describe one limitation                                |
| Read and contribute               | Open an article/reference and retain or prepare a draft without assuming files were uploaded          |
| Explore a game and return         | Understand controls, pause/exit and return to club content                                            |
| Recover from a problem            | Handle no search results, blocked storage, a failed refresh or external sign-in without losing work   |
| Update the site as a new editor   | Make one factual change, verify every affected surface, obtain review and hand it off                 |

Repeat failed tasks after an approved change. Keep or reposition features based on what students accomplish and learn, rather than assumptions about popularity. Temporary observations belong in the active work item; this guide holds the current workflow and next decisions.
