'use client';

// Ponte para o plugin nativo KitchenPrinter (app Capacitor da cozinha, Fase 3).
// Acede via window.Capacitor de propósito — NÃO adicionar @capacitor/core ao
// bundle web (spec §12). No browser normal nada disto existe: isNativeApp()
// devolve false e o resto do painel nem nota.
export interface KitchenPrinterPlugin {
  print(opts: { ip: string; port: number; dataBase64: string }): Promise<void>;
}

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: any }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/** Plugin nativo, ou null se este APK ainda não o tiver (skew web↔APK). */
export function getKitchenPrinter(): KitchenPrinterPlugin | null {
  if (!isNativeApp()) return null;
  const cap = (window as unknown as { Capacitor?: any }).Capacitor;
  const available = cap?.isPluginAvailable?.('KitchenPrinter');
  const plugin = cap?.Plugins?.KitchenPrinter;
  return available && plugin ? (plugin as KitchenPrinterPlugin) : null;
}
