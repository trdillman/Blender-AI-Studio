<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/51bfcdd8-6bd6-4c4d-88f5-2583c2165596

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Screenshot tooling (for Codex sessions)

This repo now includes a built-in screenshot tool so future Codex sessions can capture UI evidence without relying on external browser tooling.

1. Install Chromium once:
   `npm run screenshot:install`
2. Start the app:
   `npm run dev`
3. Capture a screenshot:
   `npm run screenshot -- --url http://127.0.0.1:3000 --out artifacts/setup-ui.png`

<!-- codex-managed:start -->
# Codex Workflow

## Codex Workflow

- GitHub is the source of truth for Codex App and Codex Cloud work.
- Local Blender GUI work stays local.
- Cloud work stays headless-safe by default.
- `REMOTE_MCP_GATEWAY_URL` is optional and can point at the already-exposed MCP endpoint for local helper tools.

<!-- codex-managed:end -->
