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

## Leaderboard

Shared rankings use the Vercel backend in `backend/` and the Neon `dallasai_club` database. The endpoint is set in `data/club.json`: `https://dallasai-leaderboard.vercel.app/api/leaderboard`. Games keep local progress if the service is unavailable.

The browser requests an anonymous player token, saves it on the device, then sends it with score submissions. Vercel verifies the signature and calls restricted database functions. Input checks and request quotas apply; scores are reported by the browser and accepted without bot protection. Clearing browser storage creates a new player identity. The API accepts the club website and the local Hugo preview on port 4174.

`DATABASE_URL` and `SESSION_SECRET` are sensitive environment variables in Vercel. Never put either secret in browser code or Hugo data. Changing `SESSION_SECRET` invalidates existing player tokens; use a stable key across deployments. Set `LEADERBOARD_API_URL` to an empty string to disable shared rankings.

The private local values are in `%LOCALAPPDATA%\dallasai-club-website\secrets.env.vercel`, outside Git and OneDrive. Neon Auth is unchanged. Database administration tools are in [leaderboard-setup.zip](archive/leaderboard-setup.zip); `backend/002_request_limits.sql` defines the API request limits.

Use Vercel project **ai-c64d/dallasai-leaderboard**, Framework **Other**. Deploy from the `backend/` folder as the project root; the Vercel Root Directory setting is unset for this CLI workflow. `backend/package.json` declares Node.js **22**. Build settings are in `backend/vercel.json`; dependencies are pinned in the lockfile. From `backend/`, `vercel --prod --scope ai-c64d` deploys an update after review. This project is deployed through the CLI; automatic Git deployments are not connected.

## Forms and club administration

The form implementation uses the existing Vercel backend and Neon with separate database roles. It supports club membership, newsletter subscription requests, event RSVPs, workshop requests, and private article submissions. The protected club office lives at the backend's `/admin/` and uses individual passwords for approved officers, with public account creation disabled.

All five forms confirm success on screen only after the record is saved. New records appear in the admin inbox with New counts and review status; the inbox refreshes every minute while open. Automated email delivery is not enabled.

Read [forms and admin setup](docs/forms-admin.md) for configuration, provisioning, verification, and deployment. Approved officer accounts and a private Vercel Blob store are required; no email provider is needed. Local event plans and calendar downloads remain personal conveniences; registration uses the RSVP form.

Cloudflare Turnstile can be added if the existing server-side quotas and honeypot need additional bot protection.

The [original website source](archive/original-website.zip) is retained for reference. Both archives are excluded from the published website.
