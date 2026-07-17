import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.menooo.cozinha',
  appName: 'Menooo Cozinha',
  // O painel é remoto. O bridge continua a ser injetado: o Bridge.java deriva o
  // allowedOrigin do server.url e faz addDocumentStartJavaScript sobre ele — é o
  // que sustenta o window.Capacitor de apps/dashboard/src/lib/kitchen-printer.ts.
  webDir: 'www',
  server: {
    url: 'https://painel.menooo.com',
    androidScheme: 'https',
  },
  android: {
    // Atenção: o errorPath dispara em QUALQUER erro de main-frame, incluindo
    // 404/500 — o onReceivedHttpError não inspeciona o código de estado. Por
    // isso o error.html não afirma a causa. Ver spec §5.4.
    errorPath: 'error.html',
  },
};

export default config;
