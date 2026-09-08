import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const cargoManifest = readFileSync(new URL('./src-tauri/Cargo.toml', import.meta.url), 'utf8');
const cargoVersion = cargoManifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? '—';

const processEnv = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};

// Configuración estándar de Tauri v2 con Vite:
// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  define: {
    // El fallback web se genera desde Cargo.toml; Tauri lo confirma en runtime.
    __APP_VERSION__: JSON.stringify(cargoVersion),
  },

  // Evita que Vite limpie la consola del terminal donde corre `tauri dev`
  clearScreen: false,

  server: {
    // Puerto fijo: debe coincidir con `build.devUrl` en src-tauri/tauri.conf.json
    port: 5173,
    // Falla si el puerto está ocupado, en lugar de saltar al siguiente
    strictPort: true,
    watch: {
      // Evita que Vite observe cambios en src-tauri o target (bloqueos EBUSY en Windows por DLLs de Rust)
      ignored: ['**/src-tauri/**'],
    },
  },

  // Expone las variables de entorno de Tauri (TAURI_ENV_*) al cliente
  envPrefix: ['VITE_', 'TAURI_ENV_*'],

  build: {
    // Salida exclusiva del build; `frontendDist` de Tauri apunta aquí
    outDir: 'dist',
    // WebView2 (Windows) se basa en Chromium; macOS usa WKWebView (Safari)
    target: processEnv.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    // Sin minificación ni sourcemaps en builds de debug para depurar mejor
    minify: !processEnv.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: Boolean(processEnv.TAURI_ENV_DEBUG),
  },
});
