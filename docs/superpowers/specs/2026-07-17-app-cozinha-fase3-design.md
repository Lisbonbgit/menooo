# App de Cozinha Menooo — Fase 3: APK Android (Capacitor + plugin de impressão)

**Data:** 2026-07-17
**Ramo:** `matheus-app-cozinha-fase3` (worktree `~/dev/comanda-cozinha`)
**Estado:** escrito de madrugada, sem o Matheus disponível. **Por rever.**
**Emenda a:** [2026-07-15-app-cozinha-impressao-tcp-design.md](2026-07-15-app-cozinha-impressao-tcp-design.md)

> Este documento **emenda** o spec de 15/07 com o que foi apurado empiricamente na
> noite de 16→17/07. A alteração mais importante: **a migração de endereços que se
> julgava necessária já está feita em produção**. Ver §2.

---

## 1. Objetivo

Entregar o APK que falta para fechar o desenho de 15/07: um tablet Android na
cozinha que mostra a fila de encomendas em tempo real e **imprime o talão por TCP**
(ESC/POS, porta 9100) na térmica da LAN do restaurante. Distribuído por **download
direto**, fora da Play Store, porque a aprovação da Play demora e o restaurante
precisa disto agora.

As Fases 1 (backend `KITCHEN` + emparelhamento) e 2 (painel em modo cozinha) estão
**feitas e no `main`**. O caminho nativo do `printOrder` já está escrito à espera do
plugin ([print.ts:96-110](../../../apps/dashboard/src/lib/print.ts)).

## 2. Correção ao spec de 15/07: a Fase 3a não existe

O spec de 15/07 assumia `https://painel.menooo.com` como um destino futuro. **Já é o
presente.** Verificado por fora, em 17/07 ~01:20:

| Endereço | Resultado |
|---|---|
| `https://api.menooo.com/api/health` | `200` · `{"status":"ok","db":"up"}` |
| `https://painel.menooo.com` (e `/pair`, `/login`, `/orders`) | `200` |
| `https://admin.menooo.com` | `200` |
| Certificados | Let's Encrypt, servidos por Caddy (`via: 1.1 Caddy`) |
| CORS a partir de `https://menooo.com` | `Access-Control-Allow-Origin: https://menooo.com` |
| CORS de origem forjada | recusado (204 sem `allow-origin`) |
| Bundle da loja em produção | já chama `https://api.menooo.com` |
| Imagens com o IP antigo nas 5 lojas reais | **zero** ocorrências |

**Não é preciso migrar nada.** Uma auditoria adversarial de 5 lentes (48 agentes)
produziu 22 achados sobre uma migração que não é precisa fazer, porque lhe foi dado
como "estado verificado" um pressuposto falso: que produção estava em HTTP nas
portas do IP. Estava no repositório, não em produção.

**Causa raiz, que vale mais do que os achados:** `docker-compose.prod.yml:54-62` e
`.env.production.example` ainda têm defaults `http://187.124.4.163:PORTA`. **O
repositório mente sobre a produção.** Enganou o autor deste spec e enganou as cinco
lentes. Enganará o próximo. Ver Task 3a′.2.

### 2.1 O que sobreviveu da auditoria

Os achados sobre o Capacitor não dependiam do pressuposto falso e mantêm-se:

- **A premissa central está CONFIRMADA** (e era o maior risco do desenho): em
  `Bridge.java` (Capacitor 6.2.1) o `loadWebView()` chama
  `addDocumentStartJavaScript(..., Collections.singleton(allowedOrigin))` com
  `allowedOrigin` derivado de `appUrl`, que **é** o `server.url`. Logo
  `window.Capacitor` e o plugin custom **existem** numa WebView de origem remota.
  O [kitchen-printer.ts](../../../apps/dashboard/src/lib/kitchen-printer.ts) que a
  Fase 2 escreveu às cegas está certo.
- `registerPlugin` antes do `super.onCreate()` (§5.2 abaixo).
- `errorPath` dispara em **qualquer** erro HTTP de main-frame (§5.4).
- `getVersion()` tem de ir na v1 (§5.3).
- `cozinha` tem de ser slug reservado **antes** de a página existir (§6).
- O `.apk` nunca pode viver em `apps/*/public/` (§6).

### 2.2 Achados de produção que NÃO são desta fase

- **Portas 8080-8082 abertas ao público** (`200` em 17/07 01:25). Quem lhes bate
  direto contorna o Caddy. Combinado com `trust proxy`, permitia forjar
  `X-Forwarded-For` e contornar o rate-limit do login.
  **Já corrigido noutro ramo** (`matheus-reservas-fase3`, commit `2053fc8`, "trust
  proxy só com proxy real"), encontrado independentemente por outra revisão de 4
  lentes. Fechar as portas no VPS continua por fazer — **é do Matheus**, não deste
  ramo.

## 3. Âmbito

| Fase | O quê |
|---|---|
| **3a′** | Arrumação mínima que a app precisa: saída `/login`→`/pair`, slug reservado, repo alinhado com produção |
| **3b** | `apps/cozinha` (Capacitor) + plugin nativo `KitchenPrinter` |
| **3c** | Distribuição: página `menooo.com/cozinha` + APK servido pelo Caddy |

Fora de âmbito, explicitamente: Play Store · iOS · reservas no tablet (decisão do
Matheus em 17/07: "deixa por enquanto só para os pedidos mesmo") · QR de
emparelhamento · fechar as portas do VPS · webhook do Stripe.

## 4. Fase 3a′ — arrumação

### 4.1 A app nasce morta sem isto (bloqueante)

Instalação nova → sem `localStorage` → `kitchenDevice=false`
([auth-store.ts:31](../../../apps/dashboard/src/lib/auth-store.ts)) → o guard manda
para `/login` ([api.ts:82-89](../../../apps/dashboard/src/lib/api.ts)) → o ecrã pede
**email e password do dono**, que a cozinha por desenho não tem. E o
[login/page.tsx](../../../apps/dashboard/src/app/login/page.tsx) só tem links para
`/forgot` e `/register`: **não há caminho nenhum para o `/pair`**. O caminho inverso
existe (`pair/page.tsx:37-41`), o de volta não.

**Decisão:** link discreto no `/login` — "Este é um tablet de cozinha" → `/pair`.
Uma linha, e remove o beco sem saída agora e em qualquer reinstalação futura.

### 4.2 `cozinha` como slug reservado

`RESERVED` em [reserved-slugs.ts:6-16](../../../apps/api/src/common/reserved-slugs.ts)
não inclui `cozinha`. Em Next.js a rota estática ganha à dinâmica `[slug]`: no dia em
que a Fase 3c publicar `/cozinha`, um restaurante com esse slug perde a loja — e os
QR codes impressos deixam de funcionar.

Verificado em 17/07: as 5 lojas reais são `pizzaria-demo`, `lenha-e-brasa`,
`lojapizzaria`, `loja-do-silas`, `lenha-e-brasa-alfragide`. **Nenhuma colide.** O
risco é futuro, e fecha-se com uma linha antes de a página existir.

### 4.3 O repositório tem de deixar de mentir

`docker-compose.prod.yml:54-62` e `.env.production.example` alinhados com o que
produção realmente serve. **Não consigo ler o `.env` do VPS** (sem acesso SSH), por
isso escrevo o que observei de fora e marco o resto para o Matheus confirmar.

## 5. Fase 3b — a app

### 5.1 `apps/cozinha` (Capacitor)

- **Capacitor 6** (`@capacitor/core|android|cli ^6.0.0`), `compileSdk 36`,
  `targetSdk 35`, `minSdk 22` — cópia exacta do precedente do RH
  (`~/Developer/RH/frontend`), que **comprovadamente compila nesta máquina**.
  Não se usa Capacitor 7: exige `compileSdk 35`, e o SDK local tem 34/36/36.1 sem
  `cmdline-tools` para instalar o que falta.
- `server.url = https://painel.menooo.com` · `androidScheme: https`.
- `appId: com.menooo.cozinha` · `appName: Menooo Cozinha`.
- Não precisa de `usesCleartextTraffic`: o painel é https e a impressão é um
  `java.net.Socket` nativo, que a política de cleartext do WebView não toca.
- Ecrã sempre aceso: `FLAG_KEEP_SCREEN_ON` na `MainActivity` (não precisa de plugin).

### 5.2 Plugin `KitchenPrinter` (Kotlin)

Contrato **já fixado** em [kitchen-printer.ts](../../../apps/dashboard/src/lib/kitchen-printer.ts):
`print({ ip, port, dataBase64 }): Promise<void>`.

- **Registo antes do bridge:** `registerPlugin(KitchenPrinter::class.java)` **antes**
  de `super.onCreate(s)`. É uma classe local, não um pacote npm — nunca entra no
  `capacitor.plugins.json` (que o `cap sync` regenera inteiro). Registado depois do
  `super`, o bridge já foi criado e `Capacitor.Plugins.KitchenPrinter` fica
  `undefined`: a app instala, arranca, e só falha **no primeiro talão**.
- **Fila serializada** (spec 15/07 §5.2): executor single-thread, **um socket de cada
  vez**. Duas encomendas juntas não podem abrir dois sockets — a maioria das térmicas
  só aceita um.
- **Timeouts:** `connect` 4 s + `SO_TIMEOUT` 4 s, `flush()` antes de fechar.
- **Erros distintos:** `timeout` (isolamento de rede/subrede) vs `connection refused`
  (porta/impressora desligada) → mensagens diferentes, porque a acção do utilizador é
  diferente.
- `<uses-permission android:name="android.permission.INTERNET"/>`.

### 5.3 `getVersion()` — vai na v1 ou nunca mais

A ponte de hoje só distingue "APK sem plugin" de "APK com plugin". Quando o web
precisar de um argumento novo (ex.: `cut: false`), um APK v1 responde
`isPluginAvailable === true`, aceita a chamada, e o Kotlin **ignora o argumento em
silêncio** — o talão sai errado sem ninguém saber porquê.

`getVersion(): Promise<{version: number}>` tem de existir **antes de haver APKs no
terreno**. Depois é tarde: os v1 nunca terão o método. Vai na v1 = 1.

### 5.4 Ecrã offline (`errorPath`)

`errorPath` carrega o HTML empacotado em **qualquer** erro de main-frame — o
`onReceivedHttpError` do `BridgeWebViewClient` **não inspecciona o código de estado**.
Um 404 ou um 500 momentâneo do painel atira a app para o ecrã de "sem ligação", que
mente sobre a causa.

**Decisão (compromisso assumido):** usar `errorPath` na mesma, porque o cold-start sem
WAN a mostrar ecrã branco é pior e mais provável do que um 500 do painel. Mitigações:
- O `server.url` é a **raiz** de `painel.menooo.com`, verificada a responder 200; a
  navegação dentro do painel é client-side (Next.js) e não dispara main-frame loads.
- O `error.html` é **auto-contido**: CSS em `<style>`, JS em `<script>`, zero
  referências externas — senão, sem rede, o próprio ecrã de erro fica sem estilo e
  possivelmente sem o botão "tentar de novo".
- O texto não afirma a causa. Diz "não foi possível abrir o painel" e oferece repetir.

### 5.5 Desvio assumido ao spec de 15/07: §5.4 (Preferences nativo) fica adiado

O spec de 15/07 exige guardar o IP da impressora em **Capacitor Preferences**, não em
`localStorage`, porque "a WebView remota pode despejar o localStorage".

**Não vou implementar isto esta noite, e a decisão é do Matheus.** Razão: obriga o
`print-store` a storage **assíncrono** (o `persist` do zustand), e o
[print.ts:96](../../../apps/dashboard/src/lib/print.ts) lê `usePrintStore.getState()`
de forma **síncrona** no caminho da auto-impressão. Uma hidratação assíncrona
introduz uma janela em que `getState()` devolve os defaults — `autoPrint=false`,
`printerIp=null` — e o talão **não sai, em silêncio**. Trocar um risco raro (o
WebView despejar storage de uma origem fixa num tablet dedicado) por um risco de
corrida no caminho crítico da impressão é mau negócio, e não é uma troca que eu deva
fazer sozinho às 2 da manhã.

Fica registado como decisão em aberto. Se acontecer no terreno, faz-se — mas com a
corrida resolvida primeiro.

## 6. Fase 3c — distribuição

- Página **`menooo.com/cozinha`** (storefront): passos, botão de download, e o aviso
  das "fontes desconhecidas". O funcionário abre-a **no browser do próprio tablet** —
  é esse o ponto de a pôr num endereço público e curto, em vez de dentro do painel
  autenticado (senão o dono descarrega no PC e tem de passar o ficheiro para o tablet,
  que é onde este tipo de instalação morre).
- **O `.apk` nunca vive em `apps/*/public/`.** O container da storefront não tem
  volume: o ficheiro só entraria pela imagem, e a imagem é a mesma dos 4 serviços →
  publicar um APK novo (mudança 100% nativa) obrigaria a reconstruir os três bundles
  Next com 1,5 GB de heap no VPS e a reiniciar storefront+dashboard+admin.
  **Caddy `file_server`** a partir de uma pasta do VPS (ex.: `/srv/menooo/downloads/`),
  com o `handle` do `.apk` **antes** do `reverse_proxy` genérico.
- `.gitignore`: o repo não tem regra para `*.apk`/`*.aab`/`*.keystore` — um `git add -A`
  engole o binário sem aviso e cada versão acrescenta ~10-20 MB permanentes ao
  histórico.
- Link para a página no painel do dono, ao lado do código de emparelhamento.

## 7. Verificação

O que **consigo** verificar (e vou):
1. `typecheck` do dashboard, storefront e api limpos.
2. E2e existente do KITCHEN continua verde (`scripts/e2e-kitchen.mjs`).
3. **Bytes do talão contra servidor TCP falso** (`nc -l 9100` + `xxd`) — prova o
   ESC/POS sem impressora.
4. Build do **APK de debug** (`assembleDebug`) conclui.
5. `caddy validate` no snippet, se o Caddy local existir.

O que **não consigo** verificar, e fica marcado como **NÃO VERIFICADO**:
- **O talão sair bem de uma térmica real.** É a verificação que o próprio spec de
  15/07 §10 diz não ser simulável. Precisa do tablet e da impressora.
- `Capacitor.isPluginAvailable('KitchenPrinter') === true` num APK instalado.
- Cold-start sem WAN com LAN viva.
- Qualquer coisa no VPS.

## 8. O que precisa do Matheus

1. **Keystore de assinatura.** Não crio nem giro uma keystore de produção: é uma
   decisão dele e uma password que não devo tocar — e perdê-la é perder o caminho de
   atualização da app para sempre. Deixo APK de **debug**, que instala e testa.
2. **Teste com tablet + térmica real.** Ver §7.
3. **Deploy** (o `main` no VPS) e **fechar as portas 8080-8082**.
4. **Confirmar o `.env` real do VPS** contra o que escrevi em 4.3.
5. Decidir sobre o **§5.5** (Preferences nativo).

## 9. Riscos

- **Skew web↔APK** (spec 15/07 §12): o web atualiza a quente, o APK não. Um deploy do
  painel com regressão parte **todos** os tablets ao mesmo tempo. O `getVersion()` é a
  defesa mínima; a defesa real é fasear o que toca no modo cozinha.
- **Dependência do site vivo:** sem `painel.menooo.com`, o tablet não abre. É a
  consequência aceite de reaproveitar o painel em vez de reescrever o ecrã.
- **Play Protect** pode avisar num APK sideloaded assinado por keystore desconhecida.
  Esperado; a página `/cozinha` deve dizê-lo por antecipação em vez de o utilizador
  achar que é vírus.
- **Duas sessões no mesmo repositório:** em 17/07 01:18 esta sessão fez `git checkout
  main` numa árvore que outra sessão estava a usar (`matheus-reservas-fase3`, commit
  53 s antes). Sem perdas — a árvore estava limpa — e reposta de imediato. Daí esta
  fase viver numa **worktree separada** (`~/dev/comanda-cozinha`). Registado porque a
  skill `fluxo` existe exactamente para evitar isto e não o apanhou.
