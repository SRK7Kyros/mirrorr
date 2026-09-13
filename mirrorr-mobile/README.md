# mirrorr-mobile — Capacitor wrapper (iOS + Android)

Wraps the `mirrorr-web` production build as installable mobile apps.
Same web codebase, no second UI: `mobile.html` (viewport-locked) becomes
the wrapper `index.html`; the browser build keeps page-zoom.

## Setup

```sh
cd mirrorr-mobile
bun install

# Build web + copy assets (mobile.html -> dist/index.html, locked viewport)
bun run build

# Generate native projects (first time only; dirs are gitignored)
bunx cap add ios
bunx cap add android

# Re-apply the iOS ATS exception below, then:
bunx cap sync
```

`scripts/with-mobile-env.mjs` wraps toolchain env
(`DEVELOPER_DIR` via `xcode-select -p`, `JAVA_HOME`, `ANDROID_HOME`):
`node scripts/with-mobile-env.mjs "bun run sync"`.

## iOS ATS exception (required for plain-http LAN)

After every fresh `cap add ios`, re-add to `ios/App/App/Info.plist`
(inside `<dict>`). Without it an Instance like
`http://192.168.1.20:8000` fails closed on iOS with
`NSURLErrorDomain -1022` while Android works via `allowMixedContent`:

```xml
<key>NSAppTransportSecurity</key>
<dict>
	<key>NSAllowsArbitraryLoads</key>
	<false/>
	<key>NSAllowsArbitraryLoadsInWebContent</key>
	<true/>
	<key>NSAllowsLocalNetworking</key>
	<true/>
</dict>
<key>NSLocalNetworkUsageDescription</key>
<string>Mirrorr connects to Mirrorr servers on your local network.</string>
```

(`cap sync` preserves `Info.plist`; only `cap add` regenerates it.)

## Backend prerequisite

The server must allowlist the wrapper origin (done in Todo 1):
CORS `capacitor://localhost` (+ `ionic://localhost`). If the app loads
but API calls fail while `/health` works in curl, check the server's
packaged-client CORS allowlist first.

## Troubleshooting

- `xcodebuild` reports the active developer directory is Command Line
  Tools → use the provided script or set
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
- Android `Unable to locate a Java Runtime` / `source release: 21` →
  install/use JDK 21 and set `JAVA_HOME` accordingly.
- Missing Android SDK packages → install `platform-tools`,
  `platforms;android-35`, `build-tools;35.0.0`, then accept licenses.
- CocoaPods cannot find Capacitor pods after reinstalling deps →
  `bun install`, then rerun `bun run sync`.

## CI (manual dispatch, sideload builds)

Two workflows build the wrapper without signatures or store uploads:

- `.github/workflows/ios-sideload.yml` — macos-15 runner builds the
  web bundle, copies `mobile.html` → `dist/index.html`, runs `cap sync`,
  then `xcodebuild CODE_SIGNING_ALLOWED=NO` and zips the unsigned
  `Mirrorr.ipa`. Publishes a `nightly` release + `mirrorr-ipa` artifact.
- `.github/workflows/android-debug.yml` — ubuntu-latest + Temurin JDK 21
  builds via `bun run build:android:debug` and uploads the
  `mirrorr-android-debug-apk` artifact.

Run either from Actions → workflow → Run workflow. Both trigger only on
`workflow_dispatch` so normal pushes stay green with no runner cost.
