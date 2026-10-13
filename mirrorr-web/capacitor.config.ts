import type { CapacitorConfig } from "@capacitor/cli"

// Remote shell: the app's own content is only the server picker under
// mobile/launcher. Choosing a server navigates the WebView to that host, so the
// console runs from its real origin and its cookies, /api and /ws all behave as
// they do in a browser. `allowNavigation` has to be a wildcard because servers
// are added at runtime; without it the WebView would hand the host to Safari.
const config: CapacitorConfig = {
  appId: "com.mirrorr.app",
  appName: "Mirrorr",
  webDir: "mobile/launcher",
  ios: {
    path: "mobile/ios",
  },
  android: {
    path: "mobile/android",
    allowMixedContent: true,
  },
  server: {
    androidScheme: "https",
    allowNavigation: ["*"],
  },
}

export default config
