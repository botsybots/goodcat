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