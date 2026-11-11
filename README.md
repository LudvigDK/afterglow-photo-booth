# Afterglow Photo Booth

Afterglow turns a tablet into an event photo booth. Guests take a photo, scan a QR code to save it, and can browse the event gallery if the host enables it. A separate screen follows the latest photo or plays a slideshow. One administrator can run multiple isolated events.

The React site is static and uses hash routes such as `/#/booth/EVENT_ID`, so links work on refresh under a GitHub Pages repository path. Cloudflare Workers runs the API and sign-in. A private R2 Standard bucket stores the JPEGs and thumbnails. Cloudflare D1 stores event settings, photo metadata, and upload reservations on the Workers Free plan.

## Run locally

Use Node.js 22.12+ or 24 LTS and npm.

```sh
npm ci
cp .env.example .env
cp .dev.vars.example .dev.vars
npm run db:local
```

Run `npm run dev:api` in one terminal and `npm run dev` in another. Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Under **Admin dashboard → Sign in**, enter the local `ADMIN_ACCESS_KEY` from `.dev.vars`. Wrangler emulates the Worker, R2, and D1 under `.wrangler/state`. The example credentials are for local testing only.

Camera access requires a secure context. Loopback works on the computer running Vite. For a tablet, use the deployed HTTPS site and Worker.

## Deploy to GitHub Pages and Cloudflare

This installation has a dedicated [Afterglow Photo Booth Firebase project](https://console.firebase.google.com/project/afterglow-photo-booth/overview) on Spark with the **Afterglow Web** app registered. Runtime hosting, the API, and photo storage follow the GitHub Pages and Cloudflare setup below. The installation’s D1 database is already created and migrated. Its ID is set in `wrangler.toml`.

You need a free GitHub account with a public repository and a Cloudflare account on Workers Free. No domain purchase is needed. Cloudflare may require a billing profile and payment method to activate R2. The [cost section](#free-tier-and-cost-controls) explains when overages can occur.

### 1. Set up the Cloudflare account and resources

1. [Sign up for Cloudflare](https://dash.cloudflare.com/sign-up). In **Workers & Pages**, keep the account on Workers Free and register a `workers.dev` subdomain if prompted.
2. Open **R2 Object Storage**, complete activation, then create a dedicated bucket with **Standard** as the default storage class. Keep its public `r2.dev` URL and custom domains disabled. Alternatively, create it through Wrangler after activation. [R2 setup](https://developers.cloudflare.com/r2/get-started/)
3. In the project directory, authenticate Wrangler. Create the bucket or database only if you have not already created that resource in the dashboard. The D1 database for this installation is already provisioned. [D1 setup](https://developers.cloudflare.com/d1/get-started/)

```sh
npx wrangler login
npx wrangler r2 bucket create afterglow-photos --storage-class Standard
npx wrangler d1 create afterglow-metadata
```

4. Update [wrangler.toml](wrangler.toml). Replace `database_id` with the UUID printed by D1, and set `database_name` and `bucket_name` to the resources you created. Keep the binding names `DB` and `IMAGES`. Set `FRONTEND_URL` to your eventual GitHub Pages URL, including the repository path and trailing slash, such as `https://YOUR-USER.github.io/photobooth/`. For a GitHub user site, use `https://YOUR-USER.github.io/`. The Worker allows API requests from that origin and returns successful logins to that exact site path. If another Worker in the same account uses either rate-limiter namespace ID, choose distinct IDs.
5. Apply the database migration and set an R2 lifecycle backstop on the `photos/` prefix. It removes leftover objects after 32 days, beyond the app’s maximum 30-day retention. The Worker’s ten-minute cron enforces each photo’s earlier deadline. [R2 lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) · [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

```sh
npm run db:remote
npx wrangler r2 bucket lifecycle add afterglow-photos afterglow-backstop photos/ --expire-days 32
```

### 2. Set secrets and deploy the Worker

Generate two independent 32-byte random values. Save the access key in your password manager. Keep the signing key private. Use an ignored `.env.production-secrets` file temporarily and enter your generated values.

```sh
openssl rand -hex 32
openssl rand -hex 32
```

```dotenv
ADMIN_ACCESS_KEY=FIRST_GENERATED_VALUE
SIGNING_KEY=SECOND_GENERATED_VALUE
```

```sh
npm run deploy:api -- --secrets-file .env.production-secrets
```

Delete the temporary secrets file after a successful deploy. Wrangler prints the Worker address, for example `https://afterglow-photo-booth.YOUR-SUBDOMAIN.workers.dev`. Open `/api/health` at that address and check for `{"status":"ok"}`. For later changes, use `npx wrangler secret put ADMIN_ACCESS_KEY` or `npx wrangler secret put SIGNING_KEY`. Changing the signing key invalidates all sessions and signed device links. [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

### 3. Publish the site

1. Push this directory to the `main` branch of your public GitHub repository. If the directory is new, initialize it with `git init -b main`, commit the project files, and add your GitHub repository as `origin`. The ignore file excludes local secrets and runtime state.
2. Under **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source.
3. Under **Settings → Secrets and variables → Actions → Variables**, create the repository variable `VITE_API_URL` with the HTTPS Worker origin printed by Wrangler. This is a public build setting. Enter the origin without `/api`.
4. Under **Actions**, run **Check and deploy Pages** from `main`. Subsequent pushes to `main` run the workflow automatically. Open the deployed Pages URL and enable **Enforce HTTPS** in Pages settings if available. [GitHub Pages workflow setup](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

### 4. Connect the devices

1. Open the deployed site. Choose **Admin dashboard → Sign in**, then enter the Worker’s `ADMIN_ACCESS_KEY` on the Worker-hosted sign-in page. Create your first event and save any settings.
2. Under **Device links**, open or scan **Photo booth** on the tablet. Allow camera access. Use the switch-camera control or device picker and tap **Take photo**. For a real event, keep the tablet on power and configure its screen-lock behavior.
3. Open **Live display** on the TV browser or a computer connected to the display. Select fullscreen. On browsers without element fullscreen, the button expands the display to the viewport. Browser chrome may remain visible.
4. Scan the booth’s result QR code with a phone. It opens the individual photo page. **Download photo** saves the stored JPEG. Native sharing sends the file on supported browsers, with a link fallback. Use the public gallery link for browsing when enabled.

## Event and photo behavior

- **Booth.** The preview can mirror the front camera. Downloads preserve the captured orientation and remain unmirrored. The camera encodes up to a 3840-pixel long edge and compresses only as needed to fit 4 MB. A separate JPEG thumbnail uses up to a 480-pixel long edge. A failed upload keeps the capture available for retry. On browsers with IndexedDB, the latest unsent draft for an event survives a refresh on the booth device. The success QR appears after both files and their metadata are committed.
- **Device links.** Booth links grant upload access only to one event. Resetting the booth link revokes the previous link for future uploads. Treat booth links as private. Live links include a separate viewing key so a TV can still run with the public gallery disabled. Individual photo URLs are bearer links that can be forwarded until the photo expires or is deleted. The IDs are random UUIDs. Turning off the public gallery stops public browsing. It leaves existing individual download links usable.
- **Display.** The TV checks for changes every four seconds while visible. It keeps the last loaded frame during connection interruptions and retries automatically. Latest mode holds the newest photo. All and recent modes cycle at the configured interval. Gallery polling runs every ten seconds and loads 24 thumbnails per page. ETags avoid retransmitting unchanged feeds. A visible display checks again on reconnection or browser resume.
- **Retention.** New captures default to seven days and can be configured from one to thirty days. Changing retention applies to future captures. Expired entries are excluded from API reads at the deadline. Admin deletion hides entries immediately at the API. A browser can reuse a photo cached before deletion for up to 60 seconds. Bulk removal and expiration delete R2 objects on the next successful cleanup runs in batches of 80. The storage limit accounts for pending uploads and queued deletions until they are cleared.
- **Admin session.** The Worker validates the access key and issues a signed eight-hour session. Tokens are stored in that browser tab’s session storage. Sign out clears the current tab’s token. The Worker rate-limits sign-in attempts per IP and uploads per event, approximately per Cloudflare location.

## Free tier and cost controls

Published allowances checked on November 11, 2026.

| Service | Included allowance and practical limit |
| --- | --- |
| Workers Free | 100,000 requests per day across the account, reset at midnight UTC. HTTP invocations have a 10 ms CPU allowance. Requests beyond the daily quota fail until reset. [Worker limits](https://developers.cloudflare.com/workers/platform/limits/) |
| R2 Standard | 10 GB-month of storage, 1 million Class A operations, and 10 million Class B operations per month. Internet egress is free. Usage above the allowances can be billed. [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| D1 on Workers Free | 5 million rows read and 100,000 rows written per day across the account, 5 GB total storage, and 500 MB per database. Over-quota operations fail on the Free plan. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| GitHub Pages | Free with a public repository. Published site limit of 1 GB and a soft 100 GB monthly bandwidth limit. Photos are served by the Worker and R2. [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) |

The Worker reserves space in D1 before any R2 write. It refuses new uploads at a configurable ceiling of 5,000,000,000 bytes, 1,000 stored or reserved captures per event, or 2,000 new upload attempts per UTC day. Lower `STORAGE_LIMIT_BYTES` in Wrangler to reserve capacity for other uses. Setting it to `0` pauses new uploads. Under normal operation, each attempt incurs up to two R2 writes, each uncached image request incurs one R2 read, and cleanup deletes are free. Keep the bucket dedicated to this installation so the app’s accounting covers its contents.

One continuously active TV consumes about 21,600 feed requests per day and one continuously open gallery about 8,640, before preflight, photo traffic, or other Workers. Ten TVs watching for four hours use about 36,000 feed requests. All-photo mode reads up to 1,000 metadata rows per changed feed, so heavily attended events can also reach the D1 daily quota. Monitor **Workers & Pages**, **D1**, and **R2** usage while running events.

**Zero cost depends on account-wide usage.** R2 free allowances are shared across buckets. The app’s safeguards apply to its own traffic and storage. Cloudflare Pay-as-you-go accounts can configure budget email alerts in **Manage Account → Billing → Billable Usage → Create budget alert**. Alerts report usage and have no automatic spending cutoff. Check your account’s Billable Usage dashboard before and after a large event. [Cloudflare budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)

## Verification

```sh
npm run typecheck
npm test
npx playwright install chromium webkit
npm run test:browser
VITE_API_URL=http://127.0.0.1:8787 npm run build
npx wrangler deploy --dry-run
```

- The API suite starts an isolated local Worker and exercises D1 and R2 through Wrangler. It covers session and kiosk authorization, CORS, validation, concurrent upload deduplication, downloads, gallery paging, conditional polling, all display modes, privacy, quota rejection, and expiration cleanup.
- The browser suite uses the production frontend build, a simulated Chromium camera, separate booth and TV browser sessions, and a mobile-sized WebKit guest session. It tests upload recovery across a refresh, photo downloads, and live settings changes.
- Before your first event, run a rehearsal with your actual iPad or Android tablet and your TV. Check camera permission, front/rear switching, landscape capture, phone QR scanning, fullscreen, and behavior after briefly disconnecting the TV from Wi-Fi. Desktop WebKit coverage cannot verify iPad hardware camera behavior.

## Project layout

| Path | Contents |
| --- | --- |
| `src/` | React pages, camera capture, local draft storage, polling, styles and client QR generation |
| `shared/` | API data types, settings defaults and limits |
| `worker/` | REST API, authentication, R2 handling and scheduled cleanup |
| `worker/migrations/` | D1 schema, indexes and quota accounting |
| `tests/` | Worker and browser integration tests |
| `.github/workflows/pages.yml` | GitHub Pages checks, build and deploy |

### Landing artwork

The bundled `src/assets/party.jpg` was generated using the built-in ImageGen tool.

<details>
<summary>Image prompt</summary>

Photorealistic-natural editorial event photography for a premium dark photo booth website. One wide landscape direct-flash snapshot, color film, three adult friends dressed for a night out crowded into a close photo booth frame laughing spontaneously. Person in a champagne satin top in center, friend with dark curls on left and dark jacket on right, all authentic and expressive. Metallic lilac and violet tinsel curtain, hints of amber highlights and warm skin, slight 35mm grain. Medium shot from chest up, top margin above heads, subjects centered, suitable for a 4:3 crop. Strong composition, celebratory night atmosphere. Full bleed single photo. No text, border, frame, labels, watermark, or graphic elements.

</details>
