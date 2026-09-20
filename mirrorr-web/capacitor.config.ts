import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "com.mirrorr.app",
  appName: "Mirrorr",
  webDir: "mobile/dist",
  ios: {
    path: "mobile/ios",
  },
  android: {
    path: "mobile/android",
    // The Android WebView serves the app from an https:// origin, so its fetch
    // and WebSocket calls to plain-http LAN servers are blocked as mixed content
    // even with cleartext allowed in the manifest. Allow it — LAN transport is a
    // core feature; iOS has no equivalent issue (capacitor:// scheme) and
    // relay/tunnel traffic is TLS anyway (spec L588).
    allowMixedContent: true,
  },
  server: {
    androidScheme: "https",
  },
  plugins: {
    Keyboard: {
      // 'none' leaves the WebView at full height; the UI follows the keyboard
      // itself via `--keyboard-inset` driven by keyboardWillShow. The built-in
      // 'native' resize lands only after the keyboard animation finishes, which
      // reads as lag (spec L608).
      resize: "none",
      resizeOnFullScreen: true,
    },
    StatusBar: {
      overlaysWebView: true,
      style: "DEFAULT",
    },
  },
}

export default config
