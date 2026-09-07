<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/c8ee74be-27d8-45c9-8f16-0bb030cbc883

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set `VITE_ANTHROPIC_API_KEY` in `.env.local` to your Anthropic API key
   (get one at https://platform.claude.com — for local testing only; before
   deploying, this call should move behind a serverless function so the key
   is never shipped to the browser)
3. Run the app:
   `npm run dev`
