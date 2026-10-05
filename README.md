# Dallas College AI Club Website

[dallasai.club](https://dallasai.club/)

## Website Team

- Matthew Htang
  - Github: https://github.com/MatthewHtang
  - LinkedIn: https://www.linkedin.com/in/matthew-htang/

- Minjoo Kim
  - Github: https://github.com/culukuru
  - LinkedIn: https://www.linkedin.com/in/mjkarukim/

## Run the website

Install **Hugo Extended 0.162.1**. Start a local preview:

```sh
hugo server --bind 127.0.0.1 --port 4174 --disableFastRender
```

Open <http://127.0.0.1:4174/>. Hugo rebuilds when you save; refresh the browser to see your edits. No npm installation, server application or database connection is needed.

Build the website with:

```sh
hugo --cleanDestinationDir --panicOnWarning
```

The generated `public/` folder stays out of Git.

## Edit the website

| Content | Location |
| --- | --- |
| Articles | `content/blog/` — metadata and Markdown body |
| Calendar | `content/events/` — meeting details and Markdown summary |
| Club details, projects, publication, experiments and recordings | `data/` |
| Page templates | `layouts/` and `assets/` |
| Browser features, styles and media | `static/` |
| Existing project pages and news | Other folders in `content/` |

Use an existing file as a template. Keep published article slugs, numeric aliases, event IDs and project anchors unchanged. An article's `publishDate` controls publication; drafts and future articles stay out of the website and RSS until a qualifying build. An event's `eventDate` is its meeting date, so future meetings can be announced immediately. Give confirmed times their Central Time offset; leave unknown details explicit.

Preview the pages affected by your edit, check links and phone layouts, and request review before publishing.

## Publish

GitHub Actions builds each pull request and saves a downloadable `hugo-preview` artifact. Passing changes on `main` or `hugo` publish to GitHub Pages at **dallasai.club**. Pages must use GitHub Actions. A daily rebuild at 08:15 UTC publishes scheduled articles; maintainers can also run the workflow manually.

Hugo gives public scripts and styles content-based filenames. The generated import map also versions nested and dynamically loaded modules, including published content. Edit the source files normally; a new page load selects the matching assets without clearing browser storage. GitHub Pages may cache the HTML itself for up to ten minutes, and an already-open page needs a reload to pick up a release.

## Leaderboard

Shared rankings use the Vercel backend in `backend/` and the Neon `dallasai_club` database. The endpoint is set in `data/club.json`: `https://dallasai-leaderboard.vercel.app/api/leaderboard`. Games keep local progress if the service is unavailable.

The browser requests an anonymous player token, saves it on the device, then sends it with score submissions. Vercel verifies the signature and calls restricted database functions. Input checks and request quotas apply; scores are reported by the browser and accepted without bot protection. Clearing browser storage creates a new player identity. The API accepts the club website and the local Hugo preview on port 4174.

`DATABASE_URL` and `SESSION_SECRET` are sensitive environment variables in Vercel. Never put either secret in browser code or Hugo data. Changing `SESSION_SECRET` invalidates existing player tokens; use a stable key across deployments. Set `LEADERBOARD_API_URL` to an empty string to disable shared rankings.

Private local values live in `%LOCALAPPDATA%\dallasai-club-website\`, outside Git and OneDrive. `secrets.env.forms` holds `FORMS_DATABASE_URL` for the operator scripts in `backend/scripts/`. Database administration tools are in [leaderboard-setup.zip](archive/leaderboard-setup.zip); `backend/002_request_limits.sql` defines the API request limits.

Use Vercel project **ai-c64d/dallasai-leaderboard**, Framework **Other**. Deploy from the `backend/` folder as the project root; the Vercel Root Directory setting is unset for this CLI workflow. `backend/package.json` declares Node.js **24**, and CI reads its Node.js version from that file. Keep Vercel's **Settings → Build and Deployment → Node.js Version** set to **24.x** to match; a different version produces an override warning. Build settings are in `backend/vercel.json`; dependencies are pinned in the lockfile. From `backend/`, `vercel --prod --scope ai-c64d` deploys an update after review. This project is deployed through the CLI; automatic Git deployments are not connected.

## Forms and club administration

The Vercel backend stores membership requests, The AI Review subscription requests, event RSVPs, workshop requests, questions, and private article submissions in Neon. Approved officers sign in to `/admin/` using an emailed six-digit code. Access requires both the officer email allowlist and the Neon admin role.

All six forms confirm success on screen only after the record is saved. New records appear in the admin inbox under Upcoming & New, Past or Archived, while What’s new shows the last 14 days; counts update every minute while the office is open, and new arrivals appear when an officer selects Show. Form confirmation emails, inbox email alerts, and newsletter delivery are not enabled. Neon sends authentication codes separately.

Use [operations](docs/operations.md) for configuration, migrations, sessions, verification, and deployment. See [forms and inbox](docs/forms-admin.md), [event editing](docs/event-editor.md), and [custom surveys](docs/custom-surveys.md) for officer workflows. Local calendar downloads are personal conveniences; registration uses the RSVP form.

Cloudflare Turnstile can be added if the existing server-side quotas and honeypot need additional bot protection.

The [original website source](archive/original-website.zip) is retained for reference. Both archives are excluded from the published website.
