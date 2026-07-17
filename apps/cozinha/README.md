# Menooo Cozinha (APK Android)

WebView sobre `https://painel.menooo.com` + plugin nativo `KitchenPrinter`
(ESC/POS por TCP, porta 9100). Desenho:
[`docs/superpowers/specs/2026-07-17-app-cozinha-fase3-design.md`](../../docs/superpowers/specs/2026-07-17-app-cozinha-fase3-design.md).

O painel **não é reescrito** aqui. Esta app é a casca nativa; a única peça que não
existe no browser é a ponte de impressão TCP.

## Ambiente

Não há `java` no PATH desta máquina — usa-se o JDK que vem com o Android Studio:

```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
```

## Testar a impressão sem impressora

```bash
pnpm --filter @comanda/cozinha test:printer
```

Sobe um `ServerSocket` local e verifica que o `PrinterClient` envia os bytes tal e
qual, **serializa** ligações concorrentes (nunca dois sockets na mesma térmica) e
distingue *timeout* de *ligação recusada*. É a única prova de impressão possível
sem hardware — **não** prova que a térmica interpreta bem os bytes.

## Construir o APK de debug

```bash
pnpm --filter @comanda/cozinha sync
pnpm --filter @comanda/cozinha apk:debug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

## Release

Precisa de keystore, que **não está neste repositório por desenho** — perdê-la é
perder o caminho de atualização da app para sempre. Ver `deploy/README-cozinha.md`.

## Armadilhas conhecidas

- **`registerPlugin` antes do `super.onCreate()`** (`MainActivity.kt`). O
  `KitchenPrinter` é uma classe local, não um pacote npm, logo nunca entra no
  `capacitor.plugins.json` (que o `cap sync` regenera inteiro). Registado depois do
  `super`, o bridge já foi criado e `Capacitor.Plugins.KitchenPrinter` fica
  `undefined` — a app instala, arranca, e só falha no primeiro talão.
- **`errorPath` dispara em qualquer erro de main-frame**, não só sem rede. Um 404 ou
  um 500 do painel mostra o ecrã "sem ligação".
- **Skew web↔APK:** o painel atualiza a quente, o APK não. Nunca introduzir no web
  uma chamada nova do plugin sem feature-detect (`getVersion`).
