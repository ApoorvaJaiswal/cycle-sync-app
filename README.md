# Cycle Sync (static, no backend)

A period tracker that stores your data **only in your browser** and writes predictions
directly to your Google Calendar. Nothing runs on a server, nothing is stored anywhere
but your own device — this repo is just static files.

Licensed under [MIT](./LICENSE) — a permissive default that's easy to swap for a
different license before you publish, if you'd prefer something else.


## How predictions reach your calendar

Connect your Google account once, and the app writes your next 6 predicted cycles
directly to your Google Calendar. Each cycle is written as three adjacent events that
communicate confidence the way Whoop's solid-vs-dashed band does — a solid `●` most-likely
window in the middle, with lighter `○` "could start earlier" and "could run later" markers
on either side sized to your own cycle variability. Every sync first clears the app's
previous predicted events, then writes fresh ones, so updates never leave duplicates or
stale predictions behind.

Setup requires a Google OAuth client ID (steps below), and — for public use beyond your
own test users — Google's app verification.

## What "no backend" actually means here

- Your logged dates live in `localStorage` in your browser. If you clear browser data
  or switch devices, that history is gone (there's nothing to restore from, by design —
  no server has a copy).
- Signing in to Google happens entirely in your browser via Google's own script
  (`accounts.google.com/gsi/client`). The access token this returns is kept in memory
  only — it's never written to disk, and it disappears the moment you close the tab.
  It's valid for about an hour; after that, clicking Sync will ask you to reconnect.
- Syncing calls Google's Calendar API directly from your browser to `googleapis.com`.
  There is no middle server that ever sees your dates or your token.
- The **only** thing that lives on infrastructure you control is the static HTML/CSS/JS
  itself — the same as hosting any plain website. There is no database to back up, no
  server to patch, no uptime to monitor.

## How the "detects a change, highlights sync" behavior works

Every time you log or delete a period, the app compares your current list of dates
against a snapshot of what was last successfully synced (also stored only in
`localStorage`). If they differ, the Sync button gets a pulsing highlight and its label
changes to "Sync new changes to Google Calendar." Once sync succeeds, that snapshot
updates and the highlight clears.

## Step 1 — Get a Google OAuth Client ID (you do this once, as the maintainer)

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a project.
2. **APIs & Services → Library** → enable the **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → choose **External**, fill in required
   fields, and add your own Google account under **Test users** (required while the app
   is unverified).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**
   - Authorized JavaScript origins: add wherever you'll host this, e.g.
     `http://localhost:8080` for local testing, and `https://yourname.github.io` for
     GitHub Pages. No redirect URI or client secret needed for this flow.
5. Copy the **Client ID** into `config.js`.

## Step 2 — Run it locally

No build step, no npm install. Any static file server works:

```bash
python3 -m http.server 8080
# or: npx serve .
```

Visit `http://localhost:8080`.

## Step 3 — Deploy to GitHub Pages (the recommended host for this project)

Since it's just static files, there's no build step — GitHub Pages serves the repo
directly.

1. Create a new repo on GitHub (public, since this is open source) and push this folder:

   ```bash
   cd cycle-sync-static
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

2. On GitHub, go to your repo's **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Under **Branch**, choose **main** and folder **/ (root)**, then **Save**.
5. GitHub gives you a live URL within a minute or two, in the form
   `https://YOUR_USERNAME.github.io/YOUR_REPO/`.

The `.nojekyll` file in this repo tells GitHub Pages to skip its default Jekyll build
step, so `manifest.json`, `sw.js`, and the icons folder are all served exactly as-is.

**Before Google sign-in will work at that URL**, add the full URL — including the
`/YOUR_REPO/` path — to **Authorized JavaScript origins** in Google Cloud Console
(Step 1.4). GitHub Pages serves project sites from a subpath, not the domain root, so the
path matters here.

**If you later buy a custom domain**, add a file named `CNAME` (no extension) to the repo
root containing just your domain, e.g. `cyclesync.app`, then point your domain's DNS at
GitHub Pages per [their custom domain docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site).
That also gets you a clean root URL instead of a `/YOUR_REPO/` subpath, simplifying the
Google origin setup above.

**For quick testing before you're ready to set up a real repo**, [Netlify Drop](https://app.netlify.com/drop)
gives you a live HTTPS URL in seconds with no account — drag this folder onto the page.
Good for checking things work on your phone; move to GitHub Pages for the real, permanent,
open-source home.

Netlify or Cloudflare Pages both also work as permanent hosts if you'd rather not use
GitHub Pages — same git-connected, zero-maintenance deploy model.

## The one thing that doesn't disappear: Google's verification

Even with zero backend, `calendar.events` is a sensitive scope, so Google still caps you
at ~100 test users until you submit for **app verification** (needs a privacy policy and
a walkthrough of what the app does — genuinely easier to write for this version, since
you can truthfully say "we store nothing server-side," which reviewers respond well to).
This is a one-time form, not ongoing maintenance.

## Installing it as a phone app

This is now a Progressive Web App (PWA) — same static files, no build step, no app
store. Once deployed:

- **Android (Chrome/Edge)**: visiting the site shows an "Install app" card automatically,
  or use the browser's menu → "Install app" / "Add to Home Screen." It installs with a
  real icon, opens full-screen, and works offline for the app shell itself (your data was
  always local anyway).
- **iPhone/iPad (Safari)**: iOS doesn't allow websites to trigger the install prompt
  programmatically — Apple restricts that to Safari itself. The app shows manual
  instructions instead: tap the Share button, then "Add to Home Screen." This is a
  platform limitation, not something fixable from the code.

Nothing about the OAuth or storage architecture changes for the installed version — it's
still the same in-browser Google sign-in and localStorage-only data described above, just
running full-screen without browser chrome.

## Persistence: does it remember data when you reopen the app?

Yes — `localStorage` persists indefinitely on the same device/browser, unlike memory or
session storage. Closing the app, restarting your phone, reopening next month — the
history is still there. You can also now **edit** a previously logged entry directly
(tap the pencil icon next to it) rather than only delete-and-re-add.

**One real platform quirk worth knowing:** on iOS, Safari treats a site opened as a
browser tab and the same site installed to the Home Screen as **separate storage
containers**. If someone tries the site in Safari first, then installs it to their Home
Screen, their logged dates won't carry over automatically — it'll look empty on first
open of the installed version. This is an Apple/WebKit restriction, not a bug in this
code. The practical fix is just telling users to install first, then log their dates —
or add an export/import feature later so history can move between the two.

## Limitations worth knowing

- Data doesn't follow you across devices or browsers — that's the direct tradeoff for
  "nothing is stored anywhere else." A future version could let users optionally export/
  import their local history as a file if that's worth solving later.
- The access token expiring hourly means this is a "open it, log a date, hit sync" tool,
  not a silent background updater — matches how you described actually using it.
