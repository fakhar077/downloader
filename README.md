# Safe Video Downloader (Compliant)

A minimal web app to download videos you own or are licensed to use. It does not bypass DRM, and it blocks popular platforms whose ToS prohibit downloading.

## Quick Start

1. Copy `.env.example` to `.env` and adjust values.
2. Use Node 18+.
3. Run: `npm run start` (or `npm run dev`).
4. Open http://localhost:3000

## Environment

- `PORT` default 3000
- `MAX_BYTES` max allowed download size in bytes (default 100MB)
- `ALLOWED_HOSTS` comma list to exclusively allow certain hosts (recommended in production)
- `BLOCKED_HOSTS` default list of disallowed hosts
- `GA_MEASUREMENT_ID` optional GA4 ID (e.g., G-XXXXXXXXXX)
- `ADSENSE_CLIENT_ID` optional AdSense client (e.g., ca-pub-XXXXXXXXXXXX)

## Google Search Console

1. Deploy your site to a public domain.
2. In Search Console, add property (Domain or URL prefix).
3. Verify ownership with the recommended method (DNS TXT) or the `HTML tag` method:
   - Choose HTML tag, copy the meta tag.
   - Add it to `public/index.html` inside `<head>` (a custom meta tag line).
   - Redeploy and click Verify.
4. Submit `/sitemap.xml` and request indexing for `/`.

## Google Analytics (GA4)

- Put your GA4 measurement ID into `.env` as `GA_MEASUREMENT_ID` and restart. The server injects the script only when the ID is present.

## Google AdSense (Important Policy Notes)

- Many “video downloader” sites are ineligible for AdSense due to content policies (copyright circumvention, system abuse). This project is designed to avoid prohibited behavior, but approval is not guaranteed. Proceed only if your use case is lawful and compliant.
- If approved, set `ADSENSE_CLIENT_ID` in `.env`. The script loads only when set.

## SEO Basics Included

- Descriptive title + meta description
- OpenGraph/Twitter meta
- JSON-LD WebApplication schema
- `robots.txt` and `sitemap.xml`
- Clean, fast static markup

## Deployment Options

- Render: Create a Web Service from this repo. Start command: `npm run start`. Set env vars from `.env`.
- Fly.io/Hetzner/VPS: Use Node 18+, run as a systemd service or Docker.
- Vercel/Netlify (note): This is a custom Node server. Prefer Render/Fly. For Vercel, you would need to adapt into serverless functions.

## Legal

Use only for content you own or are licensed to use. Do not circumvent DRM or violate Terms of Service of other platforms.
