import type { CapacitorConfig } from "@capacitor/cli"

// Capacitor config + seam only (architecture brief open decision: "config +
// seams yes; native build optional later"). `webDir` points at the plain web
// build for now — the mobile asset-prep step lands with the native wave, and
// ios/android project paths are added by `cap add` at that point.
const config: CapacitorConfig = {
  appId: "com.mirrorr.app",
  appName: "Mirrorr",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
}

export default config
