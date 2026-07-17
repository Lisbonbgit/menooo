'use client';

// Ponte para o plugin nativo KitchenPrinter (app Capacitor da cozinha, Fase 3).
// Acede via window.Capacitor de propósito — NÃO adicionar @capacitor/core ao
// bundle web (spec §12). No browser normal nada disto existe: isNativeApp()
// devolve false e o resto do painel nem nota.
export interface KitchenPrinterPlugin {
  print(opts: { ip: string; port: number; dataBase64: string }): Promise<void>;
  /**
   * Versão da INTERFACE do plugin (não da app). O APK v1 devolve 1.
   *
   * Existe desde o v1 de propósito: um APK que saia sem este método nunca o
   * poderá ter, e o feature-detect ficaria preso a "existe/não existe" — o que
   * não chega no dia em que o web precisar de mandar um argumento novo (o APK
   * antigo aceitaria a chamada e ignorava-o em silêncio, com o talão a sair
   * errado). O portão de minVersion só se constrói quando houver um v2: até lá
   * seria código a adivinhar o futuro.
   */
  getVersion(): Promise<{ version: number }>;
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
