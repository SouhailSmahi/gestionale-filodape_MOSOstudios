import { defineConfig } from 'vite';

// Identificativo di questa build: l'app lo confronta con /version.json per sapere se c'è una versione nuova
const versione = new Date().toISOString().replace(/\D/g, '').slice(0, 14);

export default defineConfig({
  build: { target: 'es2022', sourcemap: false },
  server: { port: 5173 },
  define: { __VERSIONE__: JSON.stringify(versione) },
  plugins: [{
    name: 'versione',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ v: versione }) });
    },
  }],
});
