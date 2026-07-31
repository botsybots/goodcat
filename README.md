# Good Cat — Personal Accountability App

Good Cat is a lightweight PWA-style personal accountability app for tracking per-user commitments, streaks, weekly goals, and friendly encouragements.

Quick start (frontend-only)

1. From the project root, serve the static files:

```bash
# Python simple server (quick demo)
python3 -m http.server 8000

# or using http-server (npm):
npx http-server -p 8000
```

2. Open http://localhost:8000 in your browser.

Backend (optional)

The `server/` folder contains an Express + SQLite backend used for remote sync, auth, and push subscriptions. To run the backend:

```bash
cd server
npm install
cp .env.example .env
# edit .env to set JWT_SECRET and VAPID keys if desired
npm start
```

By default the backend listens on port 3000. Set the API base in the app's UI to `http://localhost:3000`.

Deploying for real (frontend + synced backend)

This app is live at https://botsybots.github.io/goodcat/, built from this
repo's `main` branch via GitHub Pages (Settings -> Pages -> Deploy from a
branch -> `main` / root). Add it to your phone's home screen from that URL
to install it as an app.

For paws/comments/reminders to sync between two phones, the `server/`
backend needs to be hosted somewhere reachable over HTTPS (not just
`localhost`):

1. **Database**: create a free database at [turso.tech](https://turso.tech)
   (no credit card, 5GB free, never expires) and grab its `libsql://...`
   URL and an auth token.
2. **Server**: deploy `server/` to [Render](https://render.com)'s free web
   service tier using the `render.yaml` blueprint at the repo root ("New +"
   -> "Blueprint" -> select this repo). Fill in `TURSO_DATABASE_URL`,
   `TURSO_AUTH_TOKEN`, `VAPID_PUBLIC`, and `VAPID_PRIVATE` when prompted;
   `JWT_SECRET` is generated for you automatically.
3. **Keep it awake**: Render's free tier spins down after ~15 minutes idle,
   which would also stop it noticing due reminders. Set the `RENDER_APP_URL`
   repository variable (Settings -> Secrets and variables -> Actions ->
   Variables) to your deployed Render URL -- `.github/workflows/keep-alive.yml`
   pings it every 10 minutes for free (GitHub Actions is unlimited for
   public repos).
4. In the app's Settings panel, set **API base** to your Render URL on each
   phone, then register/log in as `anna` or `jordan`.

Running tests

The streak/schedule calculations have a small dependency-free test script:

```bash
node tests/schedule.test.mjs
```

Preparing for GitHub

1. Create a new repository on GitHub.
2. Push this folder as the repository root by running these commands from this project root:

```bash
git init
git add .
git commit -m "Initial Good Cat app commit"
git remote add origin https://github.com/yourname/good-cat.git
git branch -M main
git push -u origin main
```

Sharing a quick demo

- Run the static server and expose it with `ngrok` or `localtunnel`:

```bash
ngrok http 8000
# or
npx localtunnel --port 8000
```

Contributing

- Open issues and PRs. See `server/README.md` for backend notes.

License

- Add your preferred license when publishing.