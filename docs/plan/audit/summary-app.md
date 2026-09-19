# App & deploy security audit — summary (2026-09-19)
HIGH
- H1 release APK falls back to the debug key when MERITAI_RELEASE_* props are missing → make release build fail (plugin), verify with apksigner.
- H2 cleartext HTTP in release depends on prebuild env → app.config.ts: production variant requires https EXPO_PUBLIC_API_URL; one build script; cleartext only in debug manifest; same guard for web export.
- H3 invite codes brute-forceable (course code + 4 chars ≈ 1.05M), no rate limiting, join without approval → rate limits on /join and invites (Postgres counter), 6+ char suffix; DECISION: approval on join?
- H4 Supabase Data API would expose all public tables (no RLS) → migration enabling RLS on every table (no policies) and/or revoke anon/authenticated; disable Data API.
MEDIUM
- M1 web token in localStorage 90 days, no CSP → CSP, shorter web session / shared-computer option; DECISION: web session length.
- M2 invite links use meritai:// custom scheme (hijackable, useless on web, lost through login) → https://<web-domain>/join/CODE + Android App Links + remember code through login; DECISION: web domain.
- M3 no security headers on web host or API → vercel.json headers (CSP, nosniff, referrer, permissions, frame-ancestors none), hono secure-headers + Cache-Control no-store on /api.
- M4 previews/env separation; dev login also off when VERCEL set; preview env → second Supabase project; Deployment Protection; never production DATABASE_URL in server/.env.
- M5 link evidence lookalikes (user@host, homographs) → reject credentials in URL, display punycode hostname, warn on http, re-check scheme in openEvidence.
- M6 future Supabase direct upload: client-chosen content type, window.open without noopener → bucket allowed_mime_types + size limit, re-sniff on done, tab.opener = null.
- M7 release keystore has one copy → 2 offline encrypted backups + passwords; publish cert fingerprint.
LOW
- L1 remove SYSTEM_ALERT_WINDOW / READ/WRITE_EXTERNAL_STORAGE (blockedPermissions).
- L2 npm audit: no reachable server issues; app query-string DoS via deep link (no fix yet).
- L3 clear typed-brief drafts on sign-out.
- L4 signed URLs in history/logs (10 min TTL ok); derive per-use keys from AUTH_SECRET later.
- L5 self-host fonts on web (privacy, CSP).
- L6 /dev/gallery and exp+meritai scheme ship in release; /_sitemap on web.
- L7 .gitignore *.apk *.aab credentials*.json.
