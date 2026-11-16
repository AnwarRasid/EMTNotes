import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// The build machine's local date as YYYY-MM-DD.
const now = new Date();
const buildDate = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
].join('-');

export default defineConfig({
  base: './',
  plugins: [
    preact(),
    // The installable app: a manifest, and a service worker that precaches everything (the app, the content JSON,
    // the note and question images, the fonts) so the app works offline once opened online. 'prompt': a new version
    // waits for the trainee's Reload (src/app/PwaPrompts.tsx registers it). 6 MB covers the largest file, the
    // 1.4 MB ECG crop (img/q/mt-b-q197.png), kept full size so it reads lead by lead.
    VitePWA({
      registerType: 'prompt', injectRegister: false,
      includeAssets: ['robots.txt', 'icons/icon.svg'],
      manifest: { name: 'EMTNotes', short_name: 'EMTNotes', description: 'PAM, theory quiz and survey notes practice.',
        lang: 'en-SG',   // as <html lang>; the plugin's default is 'en'
        start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
        background_color: '#121719', theme_color: '#121719',
        icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,txt,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, navigateFallback: 'index.html', cleanupOutdatedCaches: true,
        // The first install takes over the page that installed it, so "Ready to use offline." is true at once (lazy
        // images and data come from the precache) and Settings says so with no reload. An update still waits for
        // Reload: claiming happens only on activation, and prompt mode never skips waiting by itself.
        clientsClaim: true },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/unit/setup.ts'],
    // Room for a loaded machine (final review, parked 6): the slowest tests after the sweeps take 0.25–0.4 s, so the
    // default 5 s fails only past a 12× slowdown, which a busy host can reach. The four whole-run sweeps keep their own 20 s.
    testTimeout: 15_000,
  },
});
