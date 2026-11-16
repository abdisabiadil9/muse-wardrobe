# MUSE · Lenso mobile refresh

Updated: 2026-11-16

## What is implemented

The existing React/Vite application now imports real Lenso UI components:

- `TabBar.Root / Group / Link`: Today, Wardrobe, Inspiration, Profile. Destination state remains owned by MUSE, and Lenso owns the glass navigation presentation.
- `Sheet`: the wardrobe picker, with native drawer snap points, focus, Escape/outside dismissal and touch behavior. The legacy document-level focus trap deliberately excludes this sheet.
- `SegmentedControl`: today's occasion and the picker categories.
- `Button`: primary homepage actions and picker confirmation.
- `ThemeScope`: a light theme scope for all in-place overlays and controls.

Current pinned UI dependencies: `@lenso/ui@0.11.4`, `@lenso/tokens@0.11.4`, with matching `@lenso/glass@0.2.4` transitively. StyleX declarations are compiled by official `@stylexjs/unplugin@0.19.1`. React was updated to a matching >=19.2 peer range. `package-lock.json` records the resolved versions.

The old shared `node_modules` symlink was removed, not the target directory. MUSE has its own installed dependencies; the sibling fitting-studio installation is not modified.

## User flow

1. Open on **今日搭配**, see the current five-piece outfit.
2. Tap a garment or its thumbnail: an owned-only picker opens in that category. Choosing a garment immediately replaces that slot and returns to Today. Other garments and the saved canvas layout remain unchanged.
3. Use **从衣橱选衣**: draft an entire outfit by category. **用这套搭配** applies it; closing or swiping away discards the draft.
4. **就穿这套** saves the look and remembers the local date/outfit/occasion signature. An outfit or occasion change makes it editable again.
5. **试穿这套** continues to the existing, explicitly labeled Decart demo. This work does not claim to connect the real service.

Existing `muse-mobile-v1` browser records, saved outfits, canvas layouts, wardrobe uploads, recommendation views and try-on entry points are preserved.

## Visual direction

White content surfaces, pale system gray grouping, black primary type and one system-blue action color. Glass is reserved for floating navigation; the clothing collage remains an ordinary opaque surface. App copy uses system Chinese fonts and avoids blocking on Google Fonts. The focused homepage includes the full outfit, selection entry and try-on entry before long-form inspiration.

## Mobile web / home-screen installation

- `public/manifest.webmanifest`: standalone presentation, Chinese metadata, Today as start URL and portrait-primary orientation.
- Local 192 / 512 PNG app icons plus 180 PNG Apple touch icon.
- `viewport-fit=cover`, safe-area insets and dynamic viewport height already applied and retained.
- Served through HTTPS, users can add it to the home screen in browsers that support installation. iOS uses Safari Share → Add to Home Screen.
- No service worker is registered. There is no offline AI, background sync or native App Store bundle in this prototype.
- HTTP LAN URLs can demonstrate browsing/UI but do not satisfy camera secure-context requirements. Real mobile camera/Decart tests require a reachable HTTPS origin.

## Running locally

```sh
npm ci --registry=https://registry.npmjs.org
npm run dev -- --port 5179
npm run build
```

The development host is `0.0.0.0`; do not assume localhost on a phone reaches the developer's computer. Use the computer's actually reachable network address for a same-LAN UI demo or a deployed HTTPS URL for a shareable/mobile camera demo.

## Verification and boundaries

- TypeScript and Vite production build passed after the first integration.
- UI and local StyleX maps are compiled into production CSS.
- Parent agent completed browser checks at 360/390 px and desktop: selection/close/apply/save/reload, navigation and production stylesheet delivery passed. Evidence is in `lenso-refresh/QA.md`. This is not a real-device camera test.
- Build reports a main bundle >500 kB. Lenso's glass runtime is a meaningful dependency cost; before production, profile actual iOS/Android devices and split infrequently used screens if indicated.
- User data remains browser-local. Qoder, account synchronization, product inventory and realtime Decart are separate backend integration work.

## Notices

The exact installed UI and Glass package notices are copied into `public/licenses`. Lenso original work is MIT, UI adaptations include Apache-2.0, and the optional Glass GPU backend includes LGPL-2.0-or-later material. Do not describe the whole dependency tree as MIT. The default renderer is used; the app does not explicitly enable the optional GPU backend. A production distribution must retain notices and fulfill the terms for the exact included artifacts.

Official references:

- https://ui.lenso.dev/cn/docs/react/getting-started/installation
- https://ui.lenso.dev/cn/docs/react/components/tab-bar
- https://ui.lenso.dev/cn/docs/react/components/sheet
- https://ui.lenso.dev/cn/docs/react/components/segmented-control
- https://github.com/LioRael/lenso-ui/blob/main/THIRD_PARTY_NOTICES.md
