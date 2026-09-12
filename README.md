# Dallas College AI Club Website

[dallasai.club](https://dallasai.club/)

## Website Team

- Matthew Htang
  - Github: https://github.com/MatthewHtang
  - LinkedIn: https://www.linkedin.com/in/matthew-htang/

- Student Name 2
  - Github:
  - LinkedIn:


## Website team clarification

Student Name 2 is **Minjoo Kim**. Matthew Htang's original credit and profile links above are preserved.

## Run and edit the refreshed website

The website keeps **Hugo and GitHub Pages**. Hugo builds the welcome page, interactive club interface, original content pages, shared browser data and RSS. Node.js runs development checks; no Node server or database connection is required to publish or browse the site.

Install Hugo Extended **0.162.1** and Node.js **22.13 or newer**. From this repository:

```sh
npm ci
npm run check
npm start
```

Open <http://127.0.0.1:4174/>. Hugo rebuilds when you save a content file. Refresh the browser after editing. Run `npm run build` to generate the deployable `public/` folder; keep it out of Git.

| What to edit | Source |
| --- | --- |
| AI Review articles | `content/review/*.md`: metadata at the top, article body in Markdown |
| Publication edition and sample notice | `data/publication.json` |
| Calendar entries | `content/calendar/*.md`: `eventDate`, location and agenda above the Markdown summary |
| Club contacts, advisors and social links | `data/club.json` |
| Shared project links, concepts and dated market examples | `data/projects.json` |
| AI Lab cases and sources | `data/lab.json` |
| Game news cards | `data/discovery.json` |
| Demo recordings and timing | `data/recordings.json` |
| Page structure | `layouts/` |
| Browser code, styles and media | `static/` |
| Original posts and event records | Existing `content/events/`, `content/projects/`, `content/blog/` and `content/news/` paths |

Use an existing content file as a template. Keep article slugs, existing numeric article aliases, event IDs and project anchors stable. Article `publishDate` controls both publication and the displayed date; `draft: true` and future publication dates are excluded from the site, browser data and RSS. A scheduled article appears after a build following its publication time. The workflow attempts a daily rebuild at 08:15 UTC, and maintainers can run it manually. Event dates describe meetings; future events can be announced immediately.

Articles support normal Markdown headings and paragraphs. The browser's table of contents follows the generated heading IDs. Use the Markdown body for an event's summary and the metadata for its date, location, agenda and preparation. Keep dates with known meeting times in ISO format with the correct Central Time offset; a date alone means the time is unconfirmed.

## Publishing and preserved material

Pull requests run the build and checks and save a downloadable `hugo-preview` artifact. They do not deploy the live website. Passing changes on the existing `main` or `hugo` deployment branches publish through GitHub Pages. Pages must use GitHub Actions and the existing `dallasai.club` domain. The workflow uses fixed action revisions and Hugo's pinned version. Update those pins deliberately and rerun checks.

The original theme, configuration and workflow are organized in [the archive](archive/README.md). Existing content URLs still work, including the original events, projects, blog and news paths. The original README text above is retained; future README maintenance should append context without removing existing credits or history.

See [the maintenance guide](docs/maintenance.md) for ownership, review tasks and deferred integrations. Keep archive files, database tools and credentials outside `public/`. The former `server.mjs` remains a development regression harness for existing tests; `npm start` uses Hugo, and production does not run it.

## Leaderboard status

The separate Neon `dallasai_club` database is prepared. **Cloudflare Workers, Turnstile and public shared rankings remain deferred.** The rankings page explains their availability without making API requests; games and local progress continue to work. No credentials are needed for a website build or preview. Subscription, registration and upload services remain as described in the maintenance guide.
