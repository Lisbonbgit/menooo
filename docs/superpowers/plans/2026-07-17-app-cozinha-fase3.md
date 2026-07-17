# App de Cozinha — Fase 3: APK Android — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o APK de cozinha do Menooo — Capacitor a carregar `painel.menooo.com` + plugin nativo que imprime ESC/POS por TCP na porta 9100 — distribuído por download direto em `menooo.com/cozinha`.

**Architecture:** O painel **não se reescreve**. `apps/cozinha` é um Capacitor cuja WebView carrega `https://painel.menooo.com` (`server.url`); a única peça nativa é a ponte de impressão. A lógica de socket vive num `PrinterClient` **Kotlin puro, sem dependências Android**, testável na JVM contra um `ServerSocket` local; o `KitchenPrinterPlugin` é só a cola do Capacitor à volta dele. É essa separação que torna a parte perigosa (fila, timeouts, sockets) verificável sem tablet nem impressora.

**Tech Stack:** Capacitor 6 (`@capacitor/core|android|cli ^6.0.0`), Kotlin, JUnit 4, Gradle (JDK 21 do JBR do Android Studio), Next.js 15 (storefront/dashboard), NestJS (api).

## Global Constraints

- **Worktree:** `/Users/matheus.moraes/dev/comanda-cozinha`, ramo `matheus-app-cozinha-fase3`. **NÃO** trabalhar em `~/dev/comanda` — outra sessão está lá noutro ramo.
- **PATH:** `export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"` em todos os comandos node/pnpm.
- **JAVA_HOME:** `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"` (não há java no PATH).
- **ANDROID_HOME:** `export ANDROID_HOME="$HOME/Library/Android/sdk"`.
- **SDK disponível:** platforms `android-34`, `android-36`, `android-36.1`. **Não há `cmdline-tools`** → não se instalam platforms novas. Usar `compileSdkVersion = 36`, `targetSdkVersion = 35`, `minSdkVersion = 22` (precedente comprovado: `~/Developer/RH/frontend/android/variables.gradle`).
- **Capacitor 6, não 7.** O 7 exige `compileSdk 35`, que não está instalado.
- **NUNCA** adicionar `@capacitor/*` às dependências de `apps/dashboard` — o acesso ao bridge é por `window.Capacitor` (spec 15/07 §12). O `apps/cozinha` é um workspace à parte.
- Copy em **PT-PT**, linguagem editorial, **zero emojis** na UI.
- Sem acesso SSH ao VPS. Nada neste plano toca em produção.
- Sem keystore de produção: só `assembleDebug`.

---

## Estrutura de ficheiros

| Ficheiro | Responsabilidade |
|---|---|
| `apps/cozinha/package.json` | Workspace do Capacitor (deps + scripts de build) |
| `apps/cozinha/capacitor.config.ts` | `server.url`, `appId`, `errorPath` |
| `apps/cozinha/www/error.html` | Ecrã offline auto-contido (é o `webDir`) |
| `apps/cozinha/android/…/PrinterClient.kt` | **Kotlin puro**: socket, fila serializada, timeouts. Sem Android. |
| `apps/cozinha/android/…/PrinterClientTest.kt` | JUnit na JVM contra `ServerSocket` local |
| `apps/cozinha/android/…/KitchenPrinterPlugin.kt` | Cola Capacitor: `print()`, `getVersion()` |
| `apps/cozinha/android/…/MainActivity.kt` | `registerPlugin` antes do `super.onCreate` + keep-screen-on |
| `apps/dashboard/src/app/login/page.tsx` | + link "Este é um tablet de cozinha" → `/pair` |
| `apps/dashboard/src/lib/kitchen-printer.ts` | + `getVersion()` no contrato |
| `apps/dashboard/src/components/KitchenPairing.tsx` | **Dono gera/revoga o emparelhamento** — não existia UI nenhuma |
| `apps/dashboard/src/app/settings/page.tsx` | + secção "App de cozinha" |
| `apps/api/src/common/reserved-slugs.ts` | + `cozinha` |
| `apps/storefront/src/app/cozinha/page.tsx` | Página pública de download |
| `deploy/Caddyfile.snippet` | Snippet do `file_server` do APK (para o Matheus aplicar) |

---

### Task 1: Saída do `/login` para o `/pair` (bloqueante da app)

Sem isto o APK **nasce morto**: instalação nova → sem `localStorage` → `kitchenDevice=false` → guard manda para `/login` → ecrã pede email/password do dono, que a cozinha não tem, e não há link nenhum para `/pair`.

**Files:**
- Modify: `apps/dashboard/src/app/login/page.tsx` (bloco final, a seguir ao parágrafo "Ainda não tens conta?")

**Interfaces:**
- Consumes: rota `/pair` existente (`apps/dashboard/src/app/pair/page.tsx`)
- Produces: nada que outras tasks consumam.

- [ ] **Step 1: Acrescentar o link**

Em `apps/dashboard/src/app/login/page.tsx`, **imediatamente a seguir** ao `</p>` do parágrafo "Ainda não tens conta?", antes do `</form>`:

```tsx
          <p className="mt-3 text-center text-[13px] text-ink-soft">
            <a href="/pair" className="font-medium text-ink-mute hover:text-brand hover:underline">
              Este é um tablet de cozinha
            </a>
          </p>
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha && export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH" && pnpm --filter @comanda/dashboard typecheck
```
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha
git add apps/dashboard/src/app/login/page.tsx
git commit -m "fix(dashboard): saida do login para o emparelhamento (tablet sem caminho para /pair)"
```

---

### Task 2: `cozinha` como slug reservado (antes de a página existir)

Em Next.js a rota estática ganha a `[slug]`. Quando a Task 10 criar `/cozinha`, um restaurante com esse slug perde a loja **e os QR codes impressos**. Hoje não colide (as 5 lojas reais são `pizzaria-demo`, `lenha-e-brasa`, `lojapizzaria`, `loja-do-silas`, `lenha-e-brasa-alfragide`), mas tem de fechar antes.

**Files:**
- Modify: `apps/api/src/common/reserved-slugs.ts:6-16`
- Test: `apps/api/src/common/reserved-slugs.spec.ts` (criar)

**Interfaces:**
- Consumes: `isReservedSlug(slug: string): boolean` (já existe)
- Produces: `isReservedSlug('cozinha') === true`. Aplicado em `auth.service.ts:47` e `tenants.service.ts:115`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/src/common/reserved-slugs.spec.ts`:

```ts
import { isReservedSlug } from './reserved-slugs';

describe('isReservedSlug', () => {
  it('reserva os slugs de rotas estáticas do storefront', () => {
    expect(isReservedSlug('termos')).toBe(true);
    expect(isReservedSlug('checkout')).toBe(true);
  });

  it('reserva "cozinha" (página de download do APK tapa a loja)', () => {
    expect(isReservedSlug('cozinha')).toBe(true);
  });

  it('é insensível a maiúsculas', () => {
    expect(isReservedSlug('Cozinha')).toBe(true);
    expect(isReservedSlug('COZINHA')).toBe(true);
  });

  it('deixa passar slugs de lojas reais', () => {
    expect(isReservedSlug('pizzaria-demo')).toBe(false);
    expect(isReservedSlug('lenha-e-brasa')).toBe(false);
  });
});
```

- [ ] **Step 2: Correr o teste e ver falhar**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha/apps/api && export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH" && pnpm test -- reserved-slugs
```
Expected: FAIL — `expect(isReservedSlug('cozinha')).toBe(true)` recebe `false`.

- [ ] **Step 3: Acrescentar o slug**

Em `apps/api/src/common/reserved-slugs.ts`, dentro do `Set`, a seguir a `'checkout',`:

```ts
  'cozinha',
```

- [ ] **Step 4: Correr o teste e ver passar**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha/apps/api && export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH" && pnpm test -- reserved-slugs
```
Expected: PASS, 4 testes.

- [ ] **Step 5: Commit**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha
git add apps/api/src/common/reserved-slugs.ts apps/api/src/common/reserved-slugs.spec.ts
git commit -m "fix(api): reservar slug 'cozinha' antes de a pagina de download existir"
```

---

### Task 3: O repositório deixa de mentir sobre produção

`docker-compose.prod.yml:54-62` e `.env.production.example` ainda têm defaults `http://187.124.4.163:PORTA`. Produção **já está** em `https://*.menooo.com` (verificado por fora: `api.menooo.com/api/health` → 200). Foi esta divergência que enganou o autor do spec **e** as 5 lentes da auditoria.

> **NÃO consigo ler o `.env` real do VPS** (sem SSH). Estes valores são o que se observou **de fora**. O Matheus confirma.

**Files:**
- Modify: `docker-compose.prod.yml:54-62`
- Modify: `.env.production.example`
- Modify: `.gitignore`

- [ ] **Step 1: Defaults do compose alinhados com a realidade**

Em `docker-compose.prod.yml`, substituir as 4 linhas:

```yaml
      DASHBOARD_URL: ${DASHBOARD_URL:-https://painel.menooo.com}
      STORE_URL: ${STORE_URL:-https://menooo.com}
      ADMIN_URL: ${ADMIN_URL:-https://admin.menooo.com}
```

e

```yaml
      PUBLIC_API_URL: ${PUBLIC_API_URL:-https://api.menooo.com}
```

- [ ] **Step 2: `.env.production.example` alinhado**

Substituir o cabeçalho `# Acesso por IP:porta enquanto não há domínio.` por:

```
# Produção corre em https://*.menooo.com atrás de Caddy (Let's Encrypt).
```

e os três blocos de valores:

```
NEXT_PUBLIC_API_URL=https://api.menooo.com

PUBLIC_API_URL=https://api.menooo.com

CORS_ORIGINS=https://menooo.com,https://www.menooo.com,https://painel.menooo.com,https://admin.menooo.com
```

Acrescentar, por baixo do `NEXT_PUBLIC_API_URL`, as duas variáveis que **faltam** e que o compose passa vazias (`${VAR:-}`) para o build do Next:

```
# Embebidas no bundle no build, tal como a de cima. Se ficarem vazias, o
# `??` do código NÃO as apanha (só apanha null/undefined) e o build do
# storefront rebenta em `new URL('')`.
NEXT_PUBLIC_STORE_URL=https://menooo.com
NEXT_PUBLIC_DASHBOARD_URL=https://painel.menooo.com
```

- [ ] **Step 3: `.gitignore` para binários Android**

Acrescentar ao fim de `.gitignore`:

```
# android (APK/keystore nunca entram no repo)
*.apk
*.aab
*.keystore
*.jks
apps/cozinha/android/local.properties
apps/cozinha/android/.gradle/
apps/cozinha/android/app/build/
apps/cozinha/android/build/
```

- [ ] **Step 4: Verificar que o compose continua válido**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha && docker compose -f docker-compose.prod.yml config > /dev/null 2>&1 && echo "compose OK" || echo "compose: docker indisponivel nesta maquina (esperado) — validar sintaxe a olho"
```
Expected: qualquer um dos dois. Não há Docker nesta máquina; a validação real é no VPS.

- [ ] **Step 5: Commit**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha
git add docker-compose.prod.yml .env.production.example .gitignore
git commit -m "fix(deploy): repo alinhado com a producao real (https://*.menooo.com) + gitignore de binarios android"
```

---

### Task 4: Scaffold do `apps/cozinha` (Capacitor 6)

**Files:**
- Create: `apps/cozinha/package.json`
- Create: `apps/cozinha/capacitor.config.ts`
- Create: `apps/cozinha/www/error.html`
- Create: `apps/cozinha/.gitignore`
- Create: `apps/cozinha/README.md`

**Interfaces:**
- Produces: projeto Capacitor com `webDir: 'www'` e `server.url` remoto. A Task 5 acrescenta-lhe `android/`.

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@comanda/cozinha",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "sync": "cap sync android",
    "apk:debug": "cd android && ./gradlew assembleDebug",
    "test:printer": "cd android && ./gradlew :app:testDebugUnitTest"
  },
  "dependencies": {
    "@capacitor/android": "^6.0.0",
    "@capacitor/core": "^6.0.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^6.0.0"
  }
}
```

- [ ] **Step 2: `capacitor.config.ts`**

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.menooo.cozinha',
  appName: 'Menooo Cozinha',
  // O painel é remoto: a WebView carrega painel.menooo.com e o bridge continua
  // a ser injetado (Bridge.java deriva o allowedOrigin do server.url).
  webDir: 'www',
  server: {
    url: 'https://painel.menooo.com',
    androidScheme: 'https',
  },
  android: {
    // Qualquer erro de main-frame (incluindo 404/500) cai aqui — ver spec §5.4.
    // Por isso o error.html não afirma a causa.
    errorPath: 'error.html',
  },
};

export default config;
```

- [ ] **Step 3: `www/error.html` — auto-contido**

Sem rede, qualquer `<link>`/`<script src>`/`<img src>` externo resolve para `https://localhost/...` e falha. Tudo inline:

```html
<!doctype html>
<html lang="pt">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Menooo Cozinha</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0; min-height: 100vh; display: flex; align-items: center;
        justify-content: center; background: #17120f; color: #f5efe9;
        font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
        padding: 24px; text-align: center;
      }
      .card { max-width: 420px; }
      h1 { font-size: 20px; margin: 0 0 12px; font-weight: 600; }
      p { font-size: 15px; line-height: 1.55; color: #b9aca1; margin: 0 0 24px; }
      button {
        background: #e2542c; color: #fff; border: 0; border-radius: 12px;
        padding: 14px 28px; font-size: 15px; font-weight: 600; cursor: pointer;
      }
      button:active { transform: scale(0.98); }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Não foi possível abrir o painel</h1>
      <p>
        Verifica se o tablet está ligado à internet e tenta de novo. Se o
        problema continuar, avisa o responsável.
      </p>
      <button onclick="location.href='https://painel.menooo.com'">Tentar de novo</button>
    </div>
  </body>
</html>
```

- [ ] **Step 4: `.gitignore` do workspace**

```
node_modules/
android/app/build/
android/build/
android/.gradle/
android/local.properties
android/app/src/main/assets/public/
android/app/src/main/assets/capacitor.config.json
android/app/src/main/assets/capacitor.plugins.json
```

- [ ] **Step 5: `README.md`**

```markdown
# Menooo Cozinha (APK Android)

WebView sobre `https://painel.menooo.com` + plugin nativo `KitchenPrinter`
(ESC/POS por TCP, porta 9100). Ver
`docs/superpowers/specs/2026-07-17-app-cozinha-fase3-design.md`.

## Construir o APK de debug

```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
pnpm --filter @comanda/cozinha sync
pnpm --filter @comanda/cozinha apk:debug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

## Testar a impressão sem impressora

```bash
pnpm --filter @comanda/cozinha test:printer   # JUnit contra ServerSocket local
```

## Release

Precisa de keystore (do Matheus). Não está neste repo, por desenho.
```

- [ ] **Step 6: Instalar e verificar que o Capacitor arranca**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha && export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH" && pnpm install && pnpm --filter @comanda/cozinha exec cap --version
```
Expected: imprime `6.x.x`.

- [ ] **Step 7: Commit**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha
git add apps/cozinha pnpm-lock.yaml
git commit -m "feat(cozinha): scaffold do app Capacitor 6 (server.url remoto + ecra offline auto-contido)"
```

---

### Task 5: `PrinterClient` — Kotlin puro, com testes na JVM

A parte perigosa (sockets, fila, timeouts) fica **sem dependências Android** para ser testável sem tablet. É esta task que dá a única prova real que consigo produzir sem hardware.

**Files:**
- Create: `apps/cozinha/android/app/src/main/java/com/menooo/cozinha/PrinterClient.kt`
- Test: `apps/cozinha/android/app/src/test/java/com/menooo/cozinha/PrinterClientTest.kt`
- Modify: `apps/cozinha/android/app/build.gradle` (dependência JUnit)

**Interfaces:**
- Produces:
  - `object PrinterClient`
  - `fun print(ip: String, port: Int, bytes: ByteArray): Unit` — bloqueante, serializado, lança `PrinterException`
  - `class PrinterException(val kind: Kind, message: String) : Exception(message)`
  - `enum class Kind { TIMEOUT, REFUSED, IO }`
  - Consumido pela Task 6 (`KitchenPrinterPlugin`).

- [ ] **Step 1: Gerar o projeto android**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha/apps/cozinha
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
pnpm exec cap add android
```
Expected: cria `android/`. Se falhar por falta de `www/`, confirmar que a Task 4 Step 3 criou `www/error.html`.

- [ ] **Step 2: Fixar as versões do SDK**

Substituir `apps/cozinha/android/variables.gradle` por (cópia do precedente do RH, que compila nesta máquina):

```gradle
ext {
    minSdkVersion = 22
    compileSdkVersion = 36
    targetSdkVersion = 35
    androidxActivityVersion = '1.8.0'
    androidxAppCompatVersion = '1.6.1'
    androidxCoordinatorLayoutVersion = '1.2.0'
    androidxCoreVersion = '1.12.0'
    androidxFragmentVersion = '1.6.2'
    coreSplashScreenVersion = '1.0.1'
    androidxWebkitVersion = '1.9.0'
    junitVersion = '4.13.2'
    androidxJunitVersion = '1.1.5'
    androidxEspressoCoreVersion = '3.5.1'
    cordovaAndroidVersion = '10.1.1'
}
```

- [ ] **Step 3: Escrever os testes que falham**

Criar `apps/cozinha/android/app/src/test/java/com/menooo/cozinha/PrinterClientTest.kt`:

```kotlin
package com.menooo.cozinha

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.ServerSocket
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class PrinterClientTest {

    /** Impressora falsa: aceita ligações e guarda os bytes recebidos. */
    private fun fakePrinter(received: MutableList<ByteArray>, latch: CountDownLatch): ServerSocket {
        val server = ServerSocket(0)
        thread(isDaemon = true) {
            while (!server.isClosed) {
                try {
                    server.accept().use { s ->
                        val bytes = s.getInputStream().readBytes()
                        received.add(bytes)
                        latch.countDown()
                    }
                } catch (e: Exception) {
                    return@thread
                }
            }
        }
        return server
    }

    @Test
    fun `envia os bytes tal e qual para a impressora`() {
        val received = Collections.synchronizedList(mutableListOf<ByteArray>())
        val latch = CountDownLatch(1)
        val server = fakePrinter(received, latch)
        val payload = byteArrayOf(0x1B, 0x40, 'O'.code.toByte(), 'K'.code.toByte())

        PrinterClient.print("127.0.0.1", server.localPort, payload)

        assertTrue(latch.await(5, TimeUnit.SECONDS))
        assertEquals(1, received.size)
        assertArrayEquals(payload, received[0])
        server.close()
    }

    @Test
    fun `serializa impressoes concorrentes — nunca dois sockets ao mesmo tempo`() {
        val abertos = java.util.concurrent.atomic.AtomicInteger(0)
        val maxSimultaneos = java.util.concurrent.atomic.AtomicInteger(0)
        val latch = CountDownLatch(5)
        val server = ServerSocket(0)
        thread(isDaemon = true) {
            while (!server.isClosed) {
                try {
                    val s = server.accept()
                    val agora = abertos.incrementAndGet()
                    maxSimultaneos.updateAndGet { m -> maxOf(m, agora) }
                    Thread.sleep(60)
                    s.getInputStream().readBytes()
                    s.close()
                    abertos.decrementAndGet()
                    latch.countDown()
                } catch (e: Exception) {
                    return@thread
                }
            }
        }

        val threads = (1..5).map {
            thread { PrinterClient.print("127.0.0.1", server.localPort, byteArrayOf(it.toByte())) }
        }
        threads.forEach { it.join(10_000) }

        assertTrue(latch.await(10, TimeUnit.SECONDS))
        assertEquals("nunca pode haver 2 sockets abertos na mesma termica", 1, maxSimultaneos.get())
        server.close()
    }

    @Test
    fun `porta fechada da erro REFUSED, nao TIMEOUT`() {
        val livre = ServerSocket(0).let { val p = it.localPort; it.close(); p }
        try {
            PrinterClient.print("127.0.0.1", livre, byteArrayOf(1))
            fail("devia ter lancado")
        } catch (e: PrinterException) {
            assertEquals(PrinterException.Kind.REFUSED, e.kind)
        }
    }

    @Test
    fun `ip inalcancavel da erro TIMEOUT dentro do prazo`() {
        val inicio = System.currentTimeMillis()
        try {
            // 10.255.255.1 é não-roteável: connect fica pendurado até ao timeout.
            PrinterClient.print("10.255.255.1", 9100, byteArrayOf(1))
            fail("devia ter lancado")
        } catch (e: PrinterException) {
            assertEquals(PrinterException.Kind.TIMEOUT, e.kind)
        }
        val decorrido = System.currentTimeMillis() - inicio
        assertTrue("timeout tem de ser ~4s, foi ${decorrido}ms", decorrido < 8_000)
    }

    private fun assertArrayEquals(esperado: ByteArray, real: ByteArray) {
        org.junit.Assert.assertArrayEquals(esperado, real)
    }
}
```

- [ ] **Step 4: Correr e ver falhar**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha/apps/cozinha/android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
./gradlew :app:testDebugUnitTest --tests '*PrinterClientTest*'
```
Expected: FAIL — `Unresolved reference: PrinterClient`.

- [ ] **Step 5: Implementar o `PrinterClient`**

Criar `apps/cozinha/android/app/src/main/java/com/menooo/cozinha/PrinterClient.kt`:

```kotlin
package com.menooo.cozinha

import java.io.IOException
import java.net.ConnectException
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors

/**
 * Erro de impressão, com a causa distinguida: a acção do utilizador é
 * diferente conforme seja rede (subrede/isolamento) ou impressora (porta).
 */
class PrinterException(val kind: Kind, message: String) : Exception(message) {
    enum class Kind { TIMEOUT, REFUSED, IO }
}

/**
 * Envia ESC/POS cru para uma térmica TCP/IP (porta 9100).
 *
 * Kotlin puro de propósito: sem uma única dependência Android, para poder ser
 * testado na JVM contra um ServerSocket local (PrinterClientTest). A cola do
 * Capacitor vive no KitchenPrinterPlugin.
 *
 * A fila é serializada: um executor de uma só thread garante UM socket de cada
 * vez. A maioria das térmicas só aceita uma ligação — duas encomendas ao mesmo
 * tempo abririam dois sockets e uma delas perdia-se.
 */
object PrinterClient {
    private const val CONNECT_TIMEOUT_MS = 4_000
    private const val READ_TIMEOUT_MS = 4_000

    private val fila = Executors.newSingleThreadExecutor { r ->
        Thread(r, "menooo-printer").apply { isDaemon = true }
    }

    @Throws(PrinterException::class)
    fun print(ip: String, port: Int, bytes: ByteArray) {
        try {
            fila.submit(Callable { enviar(ip, port, bytes) }).get()
        } catch (e: ExecutionException) {
            throw (e.cause as? PrinterException)
                ?: PrinterException(PrinterException.Kind.IO, e.cause?.message ?: "Erro de impressão")
        }
    }

    private fun enviar(ip: String, port: Int, bytes: ByteArray) {
        try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(ip, port), CONNECT_TIMEOUT_MS)
                socket.soTimeout = READ_TIMEOUT_MS
                // Dar tempo ao FIN de levar os últimos bytes antes de fechar.
                socket.setSoLinger(true, 2)
                socket.getOutputStream().apply {
                    write(bytes)
                    flush()
                }
            }
        } catch (e: SocketTimeoutException) {
            throw PrinterException(
                PrinterException.Kind.TIMEOUT,
                "A impressora não respondeu em $ip:$port. Confirma que está ligada e na mesma rede do tablet.",
            )
        } catch (e: ConnectException) {
            throw PrinterException(
                PrinterException.Kind.REFUSED,
                "Ligação recusada por $ip:$port. Confirma o IP e a porta da impressora.",
            )
        } catch (e: IOException) {
            throw PrinterException(
                PrinterException.Kind.IO,
                e.message ?: "Não foi possível imprimir em $ip:$port.",
            )
        }
    }
}
```

> **Nota sobre o teste do TIMEOUT:** um `connect` a um IP não-roteável lança
> `SocketTimeoutException` ao fim do `CONNECT_TIMEOUT_MS`. Em algumas redes o
> router responde de imediato com *host unreachable* → `ConnectException` (=
> REFUSED). Se o teste `ip inalcancavel` for instável nesta máquina, marcar
> `@Ignore` com o motivo escrito e registar no relatório — **não** relaxar a
> asserção para passar.

- [ ] **Step 6: Correr e ver passar**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha/apps/cozinha/android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
./gradlew :app:testDebugUnitTest --tests '*PrinterClientTest*'
```
Expected: PASS, 4 testes. **Este é o único sítio deste plano onde a impressão fica genuinamente provada sem hardware.**

- [ ] **Step 7: Commit**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha
git add apps/cozinha/android apps/cozinha/package.json
git commit -m "feat(cozinha): PrinterClient (socket TCP serializado, timeouts distinguidos) + testes JVM"
```

---

### Task 6: `KitchenPrinterPlugin` + `MainActivity`

**Files:**
- Create: `apps/cozinha/android/app/src/main/java/com/menooo/cozinha/KitchenPrinterPlugin.kt`
- Modify: `apps/cozinha/android/app/src/main/java/com/menooo/cozinha/MainActivity.java` → **apagar** e criar `MainActivity.kt`
- Modify: `apps/cozinha/android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Consumes: `PrinterClient.print(ip, port, bytes)` e `PrinterException` (Task 5).
- Produces: bridge JS `Capacitor.Plugins.KitchenPrinter` com:
  - `print({ ip: string, port: number, dataBase64: string }): Promise<void>`
  - `getVersion(): Promise<{ version: number }>` → `1`
  Consumido pela Task 7 (`kitchen-printer.ts`) e já esperado por `print.ts:96-110`.

- [ ] **Step 1: O plugin**

```kotlin
package com.menooo.cozinha

import android.util.Base64
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Ponte de impressão. O contrato está fixado do lado web em
 * apps/dashboard/src/lib/kitchen-printer.ts — não mudar sem lá mexer.
 */
@CapacitorPlugin(name = "KitchenPrinter")
class KitchenPrinterPlugin : Plugin() {

    /**
     * Versão da INTERFACE, não da app. O web usa-a para feature-detetar antes
     * de mandar argumentos novos (spec 15/07 §12). Incrementar sempre que a
     * assinatura de um método mudar.
     */
    private val interfaceVersion = 1

    @PluginMethod
    fun getVersion(call: PluginCall) {
        call.resolve(com.getcapacitor.JSObject().put("version", interfaceVersion))
    }

    @PluginMethod
    fun print(call: PluginCall) {
        val ip = call.getString("ip")
        val dataBase64 = call.getString("dataBase64")
        val port = call.getInt("port") ?: 9100

        if (ip.isNullOrBlank()) {
            call.reject("Falta o IP da impressora.")
            return
        }
        if (dataBase64.isNullOrBlank()) {
            call.reject("Talão vazio.")
            return
        }

        val bytes = try {
            Base64.decode(dataBase64, Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
            call.reject("Talão corrompido (base64 inválido).")
            return
        }

        // PrinterClient.print é bloqueante e serializado; o Capacitor já chama
        // os @PluginMethod fora da main thread.
        try {
            PrinterClient.print(ip, port, bytes)
            call.resolve()
        } catch (e: PrinterException) {
            call.reject(e.message, e.kind.name)
        }
    }
}
```

- [ ] **Step 2: `MainActivity.kt` — registo ANTES do `super.onCreate`**

Apagar `MainActivity.java` gerado pelo `cap add android` e criar `MainActivity.kt` no mesmo pacote:

```kotlin
package com.menooo.cozinha

import android.os.Bundle
import android.view.WindowManager
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // OBRIGATÓRIO antes do super: o KitchenPrinter é uma classe LOCAL, não um
        // pacote npm, logo nunca entra no capacitor.plugins.json (que o `cap sync`
        // regenera inteiro). O super.onCreate() cria o bridge — registar depois
        // dele deixa Capacitor.Plugins.KitchenPrinter a undefined, e a app só
        // falha no primeiro talão.
        registerPlugin(KitchenPrinterPlugin::class.java)
        super.onCreate(savedInstanceState)
        // Cozinha: o quadro de encomendas não pode adormecer.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}
```

- [ ] **Step 3: Kotlin no build.gradle**

Confirmar que `apps/cozinha/android/app/build.gradle` tem o plugin de Kotlin. Se o `cap add android` gerou um projeto só-Java, acrescentar no topo:

```gradle
apply plugin: 'com.android.application'
apply plugin: 'kotlin-android'
```

e em `apps/cozinha/android/build.gradle`, no bloco `dependencies` do `buildscript`:

```gradle
        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.24'
```

- [ ] **Step 4: Manifest — permissão de INTERNET**

Confirmar que `apps/cozinha/android/app/src/main/AndroidManifest.xml` tem (o `cap add android` já costuma pôr):

```xml
    <uses-permission android:name="android.permission.INTERNET" />
```

Não acrescentar `usesCleartextTraffic`: o painel é https e o socket TCP cru não é afetado pela política de cleartext.

- [ ] **Step 5: Compilar**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha/apps/cozinha/android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
./gradlew :app:compileDebugKotlin
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 6: Commit**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha
git add apps/cozinha/android
git commit -m "feat(cozinha): plugin KitchenPrinter (print + getVersion) e registo antes do bridge"
```

---

### Task 7: `getVersion()` no contrato web

**Files:**
- Modify: `apps/dashboard/src/lib/kitchen-printer.ts:6-9`

**Interfaces:**
- Consumes: bridge da Task 6.
- Produces: `KitchenPrinterPlugin.getVersion(): Promise<{version: number}>` no tipo TS.

> **Decisão (YAGNI):** acrescenta-se o **método** agora, porque um APK v1 sem ele
> nunca o terá — mas **não** se constrói o portão de `minVersion` já. Só faz
> sentido quando existir um v2 com assinatura nova. Registado no spec §5.3.

- [ ] **Step 1: Alargar a interface**

Em `apps/dashboard/src/lib/kitchen-printer.ts`, substituir o bloco da interface:

```ts
export interface KitchenPrinterPlugin {
  print(opts: { ip: string; port: number; dataBase64: string }): Promise<void>;
  /**
   * Versão da INTERFACE do plugin (não da app). O APK v1 devolve 1. Existe
   * desde o v1 de propósito: um APK que não a tenha nunca a poderá ter, e o
   * feature-detect ficaria preso a "existe/não existe" (spec §5.3).
   */
  getVersion(): Promise<{ version: number }>;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha && export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH" && pnpm --filter @comanda/dashboard typecheck
```
Expected: sem erros (nenhum consumidor chama `getVersion` ainda).

- [ ] **Step 3: Commit**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha
git add apps/dashboard/src/lib/kitchen-printer.ts
git commit -m "feat(dashboard): getVersion no contrato do KitchenPrinter (tem de existir desde o v1)"
```

---

### Task 8: Construir o APK de debug

**Files:** nenhum (só verificação)

- [ ] **Step 1: Sync + build**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
pnpm --filter @comanda/cozinha sync
pnpm --filter @comanda/cozinha apk:debug
ls -la apps/cozinha/android/app/build/outputs/apk/debug/
```
Expected: `app-debug.apk` existe.

- [ ] **Step 2: Confirmar que o APK NÃO entra no git**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha && git status --short | grep -i "\.apk" && echo "FALHA: o apk esta a ser seguido pelo git" || echo "OK: apk ignorado"
```
Expected: `OK: apk ignorado` (a Task 3 pôs a regra).

- [ ] **Step 3: Copiar para um sítio onde o Matheus o encontre**

```bash
mkdir -p ~/Downloads/menooo-cozinha
cp apps/cozinha/android/app/build/outputs/apk/debug/app-debug.apk ~/Downloads/menooo-cozinha/menooo-cozinha-debug.apk
ls -lh ~/Downloads/menooo-cozinha/
```

---

### Task 9: Página pública `/cozinha`

**Files:**
- Create: `apps/storefront/src/app/cozinha/page.tsx`

**Interfaces:**
- Consumes: slug reservado da Task 2.
- Produces: rota `https://menooo.com/cozinha`.

> O APK é servido pelo Caddy a partir de uma pasta do VPS (Task 10), **não** de
> `apps/storefront/public/`: o container não tem volume, e o binário entraria pela
> imagem — que é a mesma dos 4 serviços. Publicar um APK novo (mudança 100% nativa)
> obrigaria a reconstruir 3 bundles Next com 1,5 GB de heap no VPS.

- [ ] **Step 1: A página**

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'App de cozinha — Menooo',
  description:
    'Instala a app de cozinha do Menooo no tablet do restaurante: recebe as encomendas e imprime o talão na impressora de rede.',
  robots: { index: false, follow: false },
};

const PASSOS = [
  {
    n: '1',
    titulo: 'Descarrega no tablet',
    texto:
      'Abre esta página no browser do próprio tablet da cozinha — não no computador. O ficheiro tem de ficar no tablet onde a app vai correr.',
  },
  {
    n: '2',
    titulo: 'Permite a instalação',
    texto:
      'O Android vai perguntar se confia nesta origem, porque a app não vem da Play Store. É esperado. Autoriza o browser a instalar apps e volta atrás.',
  },
  {
    n: '3',
    titulo: 'Emparelha com o restaurante',
    texto:
      'Na app, escreve o código de emparelhamento. O código é gerado pelo dono no painel, em Definições, e só serve uma vez.',
  },
  {
    n: '4',
    titulo: 'Aponta a impressora',
    texto:
      'Em Impressão, escreve o IP da impressora térmica e carrega em Testar. A impressora tem de estar na mesma rede do tablet.',
  },
];

export default function CozinhaPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-ink-mute">
        Tablet de cozinha
      </p>
      <h1 className="font-display text-3xl font-semibold leading-tight">App de cozinha</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
        Mostra as encomendas em tempo real no tablet do balcão e imprime o talão na
        impressora térmica da tua rede, sem computador e sem programas extra.
      </p>

      <a
        href="/downloads/menooo-cozinha.apk"
        className="mt-8 inline-flex items-center rounded-xl bg-brand px-6 py-3.5 text-[15px] font-semibold text-white shadow-lift transition-all hover:bg-brand-dark active:scale-[0.99]"
      >
        Descarregar para Android
      </a>
      <p className="mt-3 text-[13px] text-ink-mute">
        Android 5.1 ou mais recente. Ainda não está na Play Store — instala-se
        diretamente.
      </p>

      <ol className="mt-12 space-y-7">
        {PASSOS.map((p) => (
          <li key={p.n} className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line text-[13px] font-semibold">
              {p.n}
            </span>
            <div>
              <h2 className="text-[15px] font-semibold">{p.titulo}</h2>
              <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{p.texto}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-12 rounded-xl border border-line p-5">
        <h2 className="text-[14px] font-semibold">A impressora não imprime?</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
          O tablet e a impressora têm de estar na mesma rede — a mesma do restaurante,
          não a de convidados. Se o teste disser que a impressora não responde, confirma
          o IP; se disser que a ligação foi recusada, confirma a porta (quase sempre
          9100).
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha && export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH" && pnpm --filter @comanda/storefront typecheck
```
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha
git add apps/storefront/src/app/cozinha/page.tsx
git commit -m "feat(storefront): pagina publica de download da app de cozinha"
```

---

### Task 10: Snippet do Caddy + instruções de deploy (para o Matheus aplicar)

Não há acesso SSH. Esta task **escreve** o que ele tem de correr; não corre nada.

**Files:**
- Create: `deploy/Caddyfile.cozinha.snippet`
- Create: `deploy/README-cozinha.md`

- [ ] **Step 1: O snippet**

Criar `deploy/Caddyfile.cozinha.snippet`:

```
# Menooo — servir o APK da app de cozinha.
# Acrescentar DENTRO do bloco que já serve menooo.com.
#
# O `handle` do .apk TEM de vir ANTES do reverse_proxy genérico da storefront,
# senão o Next.js apanha o pedido e devolve 404.
#
#   menooo.com {
#       handle /downloads/* {
#           root * /srv/menooo
#           file_server
#       }
#       handle {
#           reverse_proxy 127.0.0.1:8080     # <- o que já lá está
#       }
#   }
```

- [ ] **Step 2: As instruções**

Criar `deploy/README-cozinha.md`:

```markdown
# Publicar o APK da cozinha (passos manuais, no VPS)

> Nada disto foi executado por mim — não tenho acesso ao servidor.

1. Criar a pasta e lá pôr o APK **assinado** (não o debug):
   ```bash
   mkdir -p /srv/menooo/downloads
   # do Mac:
   scp menooo-cozinha-1.0.0.apk root@187.124.4.163:/srv/menooo/downloads/
   ln -sf /srv/menooo/downloads/menooo-cozinha-1.0.0.apk /srv/menooo/downloads/menooo-cozinha.apk
   ```
   O link fixo `menooo-cozinha.apk` é o que a página `/cozinha` aponta; o
   ficheiro versionado por baixo é o que muda.

2. Acrescentar ao Caddyfile o bloco de `deploy/Caddyfile.cozinha.snippet`.

3. **Validar antes de recarregar** — o Caddy é um processo só e serve o
   menooo.com que está no ar; um reload falhado derruba a loja:
   ```bash
   caddy validate --config /etc/caddy/Caddyfile
   systemctl reload caddy
   ```

4. Confirmar:
   ```bash
   curl -sI https://menooo.com/downloads/menooo-cozinha.apk | head -3
   ```
   Deve dar `200`. O `Content-Type` costuma sair
   `application/vnd.android.package-archive`; se sair `application/octet-stream`,
   o Android instala na mesma.

## Ainda por fazer (não é deste ramo)

- **Fechar as portas 8080-8082 ao público.** Estão abertas (verificado 17/07:
  `200`). Quem lhes bate direto contorna o Caddy. Passar os `ports:` do
  docker-compose.prod.yml para `127.0.0.1:PORTA:INTERNA`. Nota: fechar no `ufw`
  **não chega** — o docker-proxy escreve regras iptables que lhe passam à frente.
- **Confirmar o `.env` real** contra o `.env.production.example` deste ramo.
```

- [ ] **Step 3: Commit**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha
git add deploy/
git commit -m "docs(deploy): snippet do Caddy e passos manuais para publicar o APK"
```

---

### Task 11: O dono precisa de conseguir gerar o código (senão nada disto serve)

**Sem esta task o APK é inútil.** A Fase 1 criou três endpoints de OWNER e **nenhuma
UI os consome** — a verificação da Fase 2 gerava o código com `curl` ("gerar código de
emparelhamento **por API**", plano da Fase 2, Task 8). O dono instala a app, chega ao
`/pair`, e não tem de onde tirar o código.

**Files:**
- Create: `apps/dashboard/src/components/KitchenPairing.tsx`
- Modify: `apps/dashboard/src/app/settings/page.tsx` (a seguir à secção "Impressão de pedidos", linha ~451)

**Interfaces:**
- Consumes (já existem, `apps/api/src/modules/tenants/tenants.controller.ts:91-112`):
  - `POST /tenants/me/kitchen/pair-code` → `{ code: string; expiresAt: string }`
  - `GET /tenants/me/kitchen` → `{ paired: boolean; pairedAt: string | null; activeSessions: number; pendingCode: boolean }`
  - `DELETE /tenants/me/kitchen` → revoga as sessões
- Produces: `<KitchenPairing />`, sem props.

- [ ] **Step 1: O componente**

Criar `apps/dashboard/src/components/KitchenPairing.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Tablet, Copy, Unlink } from 'lucide-react';
import { api } from '@/lib/api';

// `||` e não `??`: o compose passa as NEXT_PUBLIC_* como string VAZIA quando
// não estão no .env, e o `??` só apanha null/undefined.
const STORE_URL = process.env.NEXT_PUBLIC_STORE_URL || 'https://menooo.com';

interface KitchenStatus {
  paired: boolean;
  pairedAt: string | null;
  activeSessions: number;
  pendingCode: boolean;
}

/** Emparelhamento do tablet de cozinha (lado do dono). */
export function KitchenPairing() {
  const [status, setStatus] = useState<KitchenStatus | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await api.get<KitchenStatus>('/tenants/me/kitchen');
      setStatus(data);
    } catch {
      // secção informativa: um erro aqui não deve estragar as Definições
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function generate() {
    setBusy(true);
    try {
      const { data } = await api.post<{ code: string; expiresAt: string }>(
        '/tenants/me/kitchen/pair-code',
      );
      setCode(data.code);
      toast.success('Código gerado. Válido por 10 minutos.');
      void load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Não foi possível gerar o código.');
    } finally {
      setBusy(false);
    }
  }

  async function unpair() {
    if (!confirm('Desemparelhar o tablet? Deixa de receber pedidos até voltar a emparelhar.')) return;
    setBusy(true);
    try {
      await api.delete('/tenants/me/kitchen');
      setCode(null);
      toast.success('Tablet desemparelhado.');
      void load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Não foi possível desemparelhar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-[13.5px] leading-relaxed text-ink-soft">
        Instala a app no tablet a partir de{' '}
        <a
          href={`${STORE_URL}/cozinha`}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-brand hover:underline"
        >
          {STORE_URL.replace(/^https?:\/\//, '')}/cozinha
        </a>{' '}
        — abre esse endereço no browser do próprio tablet. Depois gera aqui um código e
        escreve-o na app.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="rounded-xl bg-espresso px-4 py-2.5 text-[13.5px] font-semibold text-cream transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'A gerar…' : 'Gerar código de emparelhamento'}
        </button>
        {status?.paired && (
          <button
            type="button"
            onClick={unpair}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-[13.5px] font-medium text-ink-soft transition-colors hover:border-brand hover:text-brand disabled:opacity-60"
          >
            <Unlink size={14} /> Desemparelhar
          </button>
        )}
      </div>

      {code && (
        <div className="mt-4 rounded-xl border border-line bg-paper p-4">
          <p className="text-[11px] uppercase tracking-[0.16em] text-ink-mute">
            Escreve este código na app
          </p>
          <div className="mt-2 flex items-center gap-3">
            <code className="select-all font-mono text-[19px] font-semibold tracking-wider">
              {code}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(code);
                toast.success('Copiado.');
              }}
              className="text-ink-mute transition-colors hover:text-brand"
              title="Copiar"
            >
              <Copy size={15} />
            </button>
          </div>
          <p className="mt-2 text-[12px] text-ink-mute">
            Válido 10 minutos e só serve uma vez.
          </p>
        </div>
      )}

      {status && (
        <p className="mt-4 flex items-center gap-1.5 text-[12.5px] text-ink-mute">
          <Tablet size={13} />
          {status.paired
            ? `${status.activeSessions} tablet(s) ligado(s)${
                status.pairedAt
                  ? ` desde ${new Date(status.pairedAt).toLocaleDateString('pt-PT')}`
                  : ''
              }`
            : 'Nenhum tablet emparelhado'}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Montar nas Definições**

Em `apps/dashboard/src/app/settings/page.tsx`, acrescentar ao bloco de imports (junto ao `PrinterConfig`, linha 23):

```tsx
import { KitchenPairing } from '@/components/KitchenPairing';
```

Acrescentar `Tablet` à lista de ícones importados de `lucide-react` (bloco que começa na linha 5), e **imediatamente a seguir** ao `</section>` da secção "Impressão de pedidos" (linha 451):

```tsx
        <section className="rounded-xl border border-line bg-white p-5 shadow-card">
          <div className="mb-4 flex items-center gap-3">
            <span className="text-ink-mute">
              <Tablet size={17} />
            </span>
            <div>
              <h2 className="font-display text-[16px] font-semibold leading-tight">
                App de cozinha
              </h2>
              <p className="text-[12px] text-ink-mute">
                Tablet Android que recebe os pedidos e imprime na impressora de rede
              </p>
            </div>
          </div>
          <KitchenPairing />
        </section>
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha && export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH" && pnpm --filter @comanda/dashboard typecheck
```
Expected: sem erros.

> Tokens verificados em `apps/dashboard/tailwind.config.ts:7-28`: existem `brand`
> (DEFAULT/dark/soft/ink), `paper`, `espresso` (DEFAULT/light/line), `ink`
> (DEFAULT/soft/mute), `line`, `cream`. **Não existem** `danger` nem `paper-soft` —
> o código acima já usa só os que existem.

- [ ] **Step 4: Commit**

```bash
cd /Users/matheus.moraes/dev/comanda-cozinha
git add apps/dashboard/src/components/KitchenPairing.tsx apps/dashboard/src/app/settings/page.tsx
git commit -m "feat(dashboard): dono gera e revoga o emparelhamento da cozinha nas Definicoes"
```

---

## Verificação final da fase

- [ ] `pnpm --filter @comanda/dashboard typecheck` limpo
- [ ] `pnpm --filter @comanda/storefront typecheck` limpo
- [ ] `pnpm --filter @comanda/api typecheck` limpo
- [ ] `pnpm --filter @comanda/api test` verde (inclui `reserved-slugs.spec.ts`)
- [ ] `./gradlew :app:testDebugUnitTest` verde (4 testes do `PrinterClient`)
- [ ] `app-debug.apk` construído
- [ ] `git status` sem `.apk` por seguir
- [ ] Secção "App de cozinha" aparece nas Definições e o botão gera um código (stack local)

## NÃO VERIFICADO (precisa do Matheus)

Escrever isto no relatório final, sem o diluir:

1. **O talão sair de uma térmica real.** O `PrinterClient` está provado contra um
   `ServerSocket` local: prova que os bytes saem, serializados, com os timeouts
   certos. **Não** prova que a TP8002 os interpreta bem.
2. **`Capacitor.isPluginAvailable('KitchenPrinter') === true` num APK instalado.**
   O registo antes do `super.onCreate` está escrito conforme a fonte do Capacitor,
   mas nunca correu num dispositivo.
3. **Cold-start sem WAN com LAN viva** (o teste que o spec 15/07 §5.1 exige).
4. **Emparelhamento ponta a ponta** a partir do APK.
5. **Qualquer coisa no VPS.**
