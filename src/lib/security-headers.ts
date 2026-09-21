/**
 * The headers every response carries (DEVELOPMENT_PLAN.md §7 Phase 10).
 *
 * They are built here and served from `next.config.ts` rather than written
 * into `vercel.json`, because `pnpm start` never reads that file — and
 * `pnpm start` is how the E2E suite runs. Four headers guarded the deployment
 * and not one test in the repository could see them. From `next.config.ts` the
 * same table is served by `next dev`, by `next start` and on Vercel, so the
 * app that is tested is the app that is deployed.
 */

export type Header = { key: string; value: string };

export type PolicyEnvironment = {
  /**
   * `next dev`. Turbopack evaluates the modules it has just pushed, React
   * rebuilds server stacks with `eval` so the overlay can show where an error
   * came from, and the overlay listens on a websocket. Production needs none
   * of that, so production does not get it.
   */
  development: boolean;
  /**
   * The origin of the Supabase project that holds attachments, or `null` when
   * the bytes are on this disk — `STORAGE_DRIVER=local`, which is development
   * and every test run.
   */
  storageOrigin: string | null;
};

/**
 * Why this policy has no nonce, and what it is worth without one.
 *
 * A nonce is the policy one wants: it drops `'unsafe-inline'`, so injected
 * script does not run even when it reaches the page. In Next 16 the nonce must
 * be minted per request in `proxy.ts` and is applied during **server
 * rendering** — which means every page must render dynamically, since a page
 * prerendered at build time has no request to carry one. `/login`,
 * `/register` and `/forgot-password` are prerendered today; under a nonce they
 * would either ship scripts the browser refuses to run or have to be forced
 * dynamic one by one, giving up the static shell on exactly the pages that
 * have no session to make dynamic. Hashes do not rescue it either: the theme
 * script in the root layout is stable and hashable, but React's flight data
 * arrives as inline `<script>self.__next_f.push(...)</script>` whose contents
 * differ per page and per build.
 *
 * So `script-src` keeps `'unsafe-inline'`, and every other directive is drawn
 * as tightly as the application allows. What is left is still worth serving:
 * no script may be *loaded* from another origin, nothing may be evaluated
 * (no `'unsafe-eval'` outside `next dev`), there is no plugin, no `<base>`, no
 * form posting to a foreign action, no framing and no worker. It does not stop
 * injected inline script, and this comment says so rather than let the header
 * imply otherwise. Closing that hole is a `proxy.ts` change plus `connection()`
 * on the public pages, and it costs those pages their prerender.
 *
 * Report-Only was considered and rejected: without a collector, a report-only
 * policy is a console message nobody reads, and this policy is already known
 * to hold — every font is self-hosted through `next/font`, there is no
 * analytics, no third-party script, no iframe and no worker.
 */
export function contentSecurityPolicy({
  development,
  storageOrigin,
}: PolicyEnvironment): string {
  // Attachments live in a private Supabase bucket. The browser reaches it
  // twice: it PUTs an upload to a signed URL, and it follows the 302 from
  // /api/attachments to a signed download URL. A redirect does not escape the
  // policy — CSP skips the *path* of a redirected request, never the host — so
  // the project origin has to be named here or every image in a task body goes
  // grey. With the local driver nothing leaves this origin.
  const bucket = storageOrigin ? [storageOrigin] : [];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      // Read the comment above before removing this.
      "'unsafe-inline'",
      ...(development ? ["'unsafe-eval'"] : []),
    ],
    // Inline *attributes*, not inline sheets: `style={{ transform }}` is how
    // dnd-kit moves a card and how the charts size a bar, and style attributes
    // fall back to `style-src`. The stylesheets themselves are all 'self'.
    "style-src": ["'self'", "'unsafe-inline'"],
    // `data:` is not decoration: the paper grain in tokens.css is an inline
    // SVG data URL, and without it the application loses its background.
    "img-src": ["'self'", "data:", ...bucket],
    // next/font/google downloads the files at build time and serves them from
    // /_next/static/media. Nothing is fetched from Google at runtime.
    "font-src": ["'self'"],
    "connect-src": [
      "'self'",
      ...bucket,
      // Turbopack's HMR socket — plain over `next dev`, TLS when it is
      // started with a certificate. Schemes, so nothing else widens with it.
      ...(development ? ["ws:", "wss:"] : []),
    ],
    "worker-src": development ? ["'self'", "blob:"] : ["'none'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    // The modern half of X-Frame-Options, which is sent as well for browsers
    // that never learned this one.
    "frame-ancestors": ["'none'"],
    // Deliberately absent: `upgrade-insecure-requests`. Every asset is
    // same-origin and referenced relatively, so there is no mixed content to
    // upgrade; HSTS already forbids plaintext on the deployed origin; and the
    // E2E suite is served over http://localhost, which is the one place where
    // a browser that ever stopped exempting loopback would take the whole
    // suite down for nothing. `media-src` and `manifest-src` are absent too:
    // `default-src 'self'` already answers for them and the app embeds no
    // media and ships no manifest.
  };

  return Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * Everything else the response says about itself.
 *
 * `Permissions-Policy` denies the capabilities this application has no use
 * for, so a compromised script cannot ask for them and no browser ever shows
 * the person a prompt Planora did not mean to raise. Clipboard and fullscreen
 * are left alone — the editor pastes, and an attachment may want the screen.
 *
 * `Cross-Origin-Opener-Policy: same-origin` severs `window.opener`. There is no
 * OAuth popup and nothing here talks to a window it opened, so the whole class
 * of cross-window attacks costs nothing to close.
 *
 * `Cross-Origin-Resource-Policy: same-origin` keeps another site from
 * embedding what this one serves — which matters most for /api/files, where
 * the bytes are somebody's private attachment.
 *
 * Left out on purpose: `Cross-Origin-Embedder-Policy`, because `require-corp`
 * would block the Supabase upload and the signed image URLs, and nothing here
 * needs cross-origin isolation; and `X-DNS-Prefetch-Control`, because with
 * every resource same-origin there is no DNS to prefetch, and `off` would only
 * slow down the one origin that is remote.
 */
export function securityHeaders(environment: PolicyEnvironment): Header[] {
  return [
    {
      key: "Content-Security-Policy",
      value: contentSecurityPolicy(environment),
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: [
        "accelerometer=()",
        "autoplay=()",
        "camera=()",
        "display-capture=()",
        "encrypted-media=()",
        "geolocation=()",
        "gyroscope=()",
        "magnetometer=()",
        "microphone=()",
        "midi=()",
        "payment=()",
        "usb=()",
        "xr-spatial-tracking=()",
      ].join(", "),
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    // A browser ignores HSTS arriving over plaintext, so sending it from
    // `next dev` would be noise; the E2E suite runs a production build and
    // still sees it.
    ...(environment.development
      ? []
      : [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ]),
  ];
}

/**
 * The origin of `SUPABASE_URL`, for the two directives that need to name it.
 *
 * `server/storage/supabase.ts` validates the same variable properly, and its
 * error message is the one a deploy should read — but that module is
 * `server-only` and pulls in the SDK, so it cannot be imported by
 * `next.config.ts`. Here a value that is not a URL is simply not a bucket:
 * the policy stays closed, the attachment route fails loudly on the first
 * request, and a header table does not get to break the build.
 */
export function storageOriginOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
