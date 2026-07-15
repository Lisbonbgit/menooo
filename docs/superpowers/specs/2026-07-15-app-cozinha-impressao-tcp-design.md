# App de Cozinha Menooo — impressão por TCP/IP (Android)

**Data:** 2026-07-15
**Ramo:** `matheus-app-cozinha`
**Estado:** design aprovado + revisão adversarial incorporada (falta revisão final do utilizador)

> Este spec foi endurecido por uma revisão adversarial de 4 lentes (viabilidade
> Android/Capacitor, segurança, casos-limite operacionais, correção do
> reaproveitamento) sobre o spec inicial e o código real. As secções §5.5–§7 e §9
> refletem correções a falhas sérias encontradas (fuga de PII entre unidades,
> matriz de permissões, fiabilidade do socket, concorrência de impressão).

## 1. Contexto e problema

O Menooo imprime talões com o **QZ Tray** — agente de desktop que fala com a
impressora via WebSocket local. Problemas:

- O **QZ Tray não corre em tablets**. Restaurantes só com **tablet** ficam sem
  impressão automática.
- O **backend está na cloud** e não alcança o IP privado da impressora na LAN; e o
  **browser não abre sockets TCP** para a porta 9100. A impressão TEM de partir de
  dentro da rede do restaurante.

Impressoras-alvo: **térmicas genéricas TCP/IP** (ESC/POS cru na porta 9100). Sem HTTP
(ePOS Epson) nem cloud-poll (CloudPRNT Star).

## 2. Objetivo

Uma **app Android de cozinha** no tablet do balcão: mostra os pedidos em tempo real e
imprime o talão enviando ESC/POS **por TCP** para o `IP:porta` da impressora na mesma
LAN. Sem PC, sem QZ, sem caixa extra. **Fiável em serviço** (picos, reconexões,
tablet a dormir).

## 3. Decisões (aprovadas)

| Tema | Decisão |
|---|---|
| Arquitetura | Reaproveitar o painel existente dentro de Capacitor; troca só o transporte de impressão |
| Plataforma | Só Android |
| Acesso | Papel `KITCHEN` novo, restrito no servidor e **preso a uma unidade** |
| Emparelhamento | **Código curto** gerado no painel (uso-único). **QR fica como extra pós-MVP** (ver §5.6) |
| Config da impressora | Local no tablet, em **armazenamento nativo** (não localStorage) |
| Plugin de impressão | Plugin Capacitor próprio (`KitchenPrinter`) com **fila serializada** |

> **Ajuste vindo da revisão:** o QR ao vivo dentro de uma WebView remota exige
> permissão de câmara + plugin de barcode + declaração de Data Safety na Play — muito
> mais do que "trivial". Para o MVP fica **só o código curto à mão**; o QR entra depois
> como extra nativo orçamentado à parte. (A confirmar contigo.)

## 4. Arquitetura

A app **não reescreve o painel**. É um **Capacitor** cuja WebView carrega o painel
existente (via `server.url`), em **"modo cozinha"**. A única peça nativa nova é a ponte
de impressão TCP. O mesmo código web continua a servir o desktop com QZ.

```
┌──────────────────── Tablet Android (cozinha) ─────────────────────┐
│  App Capacitor "cozinha"                                          │
│  WebView → painel.menooo.com (modo cozinha)   Plugin KitchenPrinter│
│      │  socket.io + REST                          │ fila TCP 9100 │
└──────┼────────────────────────────────────────────┼──────────────┘
   internet ▼                                    LAN ▼
     api.menooo.com (cloud)              Impressora térmica TCP/IP
```

- **Origem preservada:** com `server.url` remoto, a WebView tem a **mesma origem**
  `painel.menooo.com`, logo os pedidos a `api.menooo.com` são tão cross-origin como no
  desktop de hoje — **o CORS já está configurado, não é problema novo**. A auth é
  **Bearer token** (não cookies), por isso o bloqueio de cookies de 3.os na WebView
  não se aplica. *(Se algum dia se empacotar um bundle local — "Plano B" — a origem
  muda para `capacitor://localhost` e o allowlist de CORS do backend teria de a incluir;
  por isso o remoto é o caminho principal.)*
- **Cleartext/mixed-content não se aplicam:** imprimir é um `java.net.Socket` nativo, não
  um `fetch('http://…')` da página https — o browser nunca o bloqueia. A UI de teste
  **nunca** deve tentar "pingar" a impressora por fetch JS.

## 5. Componentes

### 5.1 App Capacitor `apps/cozinha` (novo)
- Projeto Capacitor mínimo, Android apenas. `capacitor.config` com
  `server.url = https://painel.menooo.com`.
- **Arranque offline:** definir um `errorPath`/ecrã de erro **empacotado localmente**
  (com botão "tentar de novo") para o cold-start sem WAN não mostrar ecrã branco.
  Testar explicitamente **LAN sem WAN** (impressora alcançável, site não).
- Inclui o plugin nativo `KitchenPrinter`. Ícone/splash Menooo. `FLAG_KEEP_SCREEN_ON`
  enquanto a receção está aberta.

### 5.2 Plugin nativo `KitchenPrinter` (novo)
Interface: `print({ ip, port, dataBase64 }): Promise<PrintResult>` + `getVersion()`.
- **Fila serializada:** um single-thread executor interno garante **um socket de cada
  vez** para a impressora. Nunca confiar na ordem/concorrência das chamadas JS (2
  encomendas juntas não podem abrir 2 sockets → a maioria das térmicas só aceita 1).
- **Timeouts explícitos:** `Socket s = new Socket(); s.connect(new InetSocketAddress(ip,
  port), 4000); s.setSoTimeout(4000);` — connect-timeout + SO_TIMEOUT (~3–5 s). `flush()`
  + pequeno `setSoLinger` antes de fechar para não cortar bytes.
- **Erros distintos:** mapear **timeout** (isolamento de rede / subnet / firewall) vs
  **connection-refused** (porta/impressora) para mensagens diferentes.
- `AndroidManifest`: `<uses-permission android:name="android.permission.INTERNET"/>`.
  Socket TCP cru NÃO é afetado pela política de cleartext.
- **Versão da interface** exposta (`getVersion`) para o web feature-detetar (ver §12).

### 5.3 Modo cozinha (web, `apps/dashboard`)
- **Decidido pelo PAPEL** (`role === 'KITCHEN'`), não pela plataforma — para um
  OWNER/STAFF que abra a app não ficar preso à UI reduzida. (`isNativePlatform()` usa-se
  só para **rotear a impressão** para o plugin nativo, §6.) Decidir o shell **só depois
  de hidratado** (reutilizar o padrão [use-hydrated.ts](../../../apps/dashboard/src/lib/use-hydrated.ts))
  para evitar flash/mismatch de SSR.
- Em modo cozinha a nav mostra **só Receção**. A configuração da impressora reutiliza o
  **modal "Impressão" que a Receção já tem** ([orders/page.tsx](../../../apps/dashboard/src/app/orders/page.tsx) →
  `PrinterSettings`/`PrinterConfig`) — **evita reestruturar as 8 secções das Definições**.
- Esconder no `AppShell`: o **TenantSwitcher** (chama endpoints OWNER → 403) e os
  **banners de subscrição/trial/expirado** (deep-link para faturação, bloqueada a KITCHEN).
- **Sem `/login`:** o guard e os botões "Sair" do [AppShell](../../../apps/dashboard/src/components/AppShell.tsx)
  têm `/login` cravado (linhas ~63, 124-127, 146-150). Em modo cozinha, o destino
  não-autenticado e o "Sair" passam a `/pair` (emparelhamento). O "Sair" vira
  **"desemparelhar"** controlado.

### 5.4 Ecrã da impressora (reutiliza `PrinterConfig`)
- Campos: **IP**, **porta** (9100), **largura** (58/80 mm), **auto-imprimir**.
- **"Testar impressão"** → caminho nativo; diferencia timeout vs refused e **mostra o IP
  do próprio tablet** (para o instalador confirmar a mesma subrede). Documentar: mesma
  LAN, sem *client isolation*/SSID de convidados.
- Guardado em **armazenamento nativo** (Capacitor Preferences), não localStorage (a
  WebView remota pode despejar o localStorage; re-introduzir o IP à mão numa cozinha é
  doloroso). Adiciona `printerIp`/`printerPort` ao modelo de config.
- **`autoPrint` liga por omissão em modo cozinha** (ou proposto logo a seguir a um
  "Testar impressão" bem-sucedido) — senão o tablet não imprime nada em silêncio.

### 5.5 Papel `KITCHEN` (backend) — matriz de permissões precisa
- Enum `UserRole += KITCHEN` (migração aditiva).
- **Preso a uma unidade:** o utilizador KITCHEN guarda o `tenantId` da unidade
  (coluna nova, ou entidade de emparelhamento). `accountId = tenant.accountId`,
  `passwordHash` aleatório **não-loginável**, `emailVerifiedAt` preenchido, `email`
  determinístico e único por unidade (ex.: derivado do id da unidade, sem colidir com
  emails reais). Reutilizar o utilizador existente ao re-emparelhar (não duplicar).
- **`@Roles` ao NÍVEL DO MÉTODO, nunca da classe.** Hoje o `OrdersController` tem
  `@Roles(OWNER, STAFF)` **na classe** (linhas 12-13), o que cobre `GET /orders/summary`
  (receita/ticket médio). KITCHEN entra **só** em:
  - `GET /orders` (listar), `GET /orders/:id`, `PATCH /orders/:id/status`
  - `GET /tenants/me` e `GET /tenants/me/hours` (nome da loja para o talão)
- KITCHEN fica **fora** (403, com teste e2e) de: `GET /orders/summary`, `GET /tenants/mine`,
  `PATCH /tenants/me`, `POST /tenants`, `PUT /tenants/me/hours`, catálogo, uploads,
  promoções, faturação.
- **`/tenants/me` para KITCHEN** deve devolver o mínimo (nome/loja) — decidir se inclui
  `subscription/status` (os banners dependem disso; se não vierem, nem é preciso escondê-los).

### 5.6 Emparelhamento por código (endpoint público, endurecido)
- **Dono (painel):** `POST /tenants/me/kitchen/pair-code` (OWNER) gera um código no
  formato **`<id>.<segredo>`** (como o refresh token — lookup indexado por `id`, sem
  varrer tenants), guarda **hash do segredo + validade curta (~10 min)** na unidade e
  devolve-o. Entropia do segredo **≥ 40 bits**.
- **App cozinha:** ecrã `/pair` → introduz o código → `POST /auth/kitchen/pair { code }`
  (`@Public`). Valida (fetch por `id` + verificação de hash), **contador de tentativas +
  lockout** (à imagem do `MAX_ATTEMPTS`=5 da verificação de email), **uso-único**
  (invalida no 1.º sucesso, marca `pairedAt`), erro **neutro** para código
  gasto/expirado/inválido. **Rate-limit dedicado** nesta rota (e confirmar `trust proxy`
  no reverse-proxy, senão o throttle por IP não vê o IP real).
- Sucesso → garante o utilizador KITCHEN da unidade e **emite access + refresh tokens**
  (reutiliza a infra de refresh de `matheus-sessao-refresh-tokens`). A app guarda os
  tokens em armazenamento nativo e entra na Receção.
- **QR:** fora do MVP (ver nota na §3).

### 5.7 Sessão e revogação KITCHEN
- **Preso à unidade (imposto):** `resolveTenantId` no `refresh()` **ignora** o `tenantId`
  do cliente quando `role===KITCHEN` e usa sempre a unidade emparelhada; **`/auth/switch`
  passa a `@Roles(OWNER, STAFF)`** (exclui KITCHEN). Sem isto, um tablet lê encomendas
  (PII) de lojas irmãs da conta — furo confirmado na revisão.
- **TTLs curtos para KITCHEN** (access ~2–5 min; refresh mais curto que 7 d), porque o
  `JwtStrategy` confia no payload e não revalida o utilizador — logo "desemparelhar"
  (`refreshToken.deleteMany`) e ban só fazem efeito no próximo refresh.
- **Deteção de reutilização de refresh:** se um refresh já revogado for apresentado,
  revogar toda a família do utilizador e forçar novo emparelhamento (tablet partilhado =
  superfície de roubo real).
- **Desemparelhar:** o dono vê as sessões de cozinha ativas e revoga num clique
  (`refreshToken.deleteMany`) **e força o disconnect dos sockets** dessa unidade no
  `OrdersGateway` (que hoje só valida o JWT no handshake e nunca revalida).

## 6. Fluxo de impressão

`printOrder` ([print.ts](../../../apps/dashboard/src/lib/print.ts)) ganha um 3.º caminho:

```
se (isNativePlatform && printerIp) → KitchenPrinter.print({ip, port, dataBase64})   ← NOVO
senão se (printerName)             → QZ Tray (desktop)                               (hoje)
senão                              → impressão do browser (fallback)                 (hoje)
```
- **Tipo de retorno** alarga para `'qz' | 'browser' | 'native'`; atualizar o consumidor
  em [PrinterConfig](../../../apps/dashboard/src/components/PrinterConfig.tsx) (senão um
  print TCP bem-sucedido mostra o toast errado "aberto no browser").
- **Sem IP configurado** (isNativePlatform mas `printerIp` null): **não** rejeitar em
  silêncio — mostrar estado "configura a impressora". Os bytes vêm do
  [escpos.ts](../../../apps/dashboard/src/lib/escpos.ts) (testado 11/11).
- **Um só dispositivo a imprimir por unidade:** hoje todos os dispositivos na sala
  socket auto-imprimem (PC com QZ **+** tablet = **2 talões**). MVP: `autoPrint` por
  dispositivo com aviso claro ("só um dispositivo deve ter auto-impressão"); o
  emparelhamento da cozinha **propõe tornar-se o dispositivo de impressão**. *(Designação
  no servidor = melhoria futura.)*
- **Encomendas agendadas (`scheduledFor`):** hoje `emitNewOrder` dispara na criação →
  uma pré-encomenda para amanhã **auto-imprime já**. MVP: **suprimir a auto-impressão**
  de agendadas futuras, separá-las visualmente no quadro, permitir impressão manual.
  *(Auto-impressão perto da hora = follow-up, precisa de job no backend.)*

## 7. Fiabilidade (correções a código partilhado, exigidas pela cozinha)

- **Re-sincronizar ao reconectar:** [orders-hooks.ts](../../../apps/dashboard/src/lib/orders-hooks.ts)
  só faz `GET /orders` uma vez; o socket.io não repõe eventos do gap. Em cada
  `socket.on('connect')` (inclui reconexões) voltar a buscar `/orders` (idealmente com
  cursor `since`/`updatedAfter`). Sem isto, encomendas criadas durante um blip de WiFi
  **perdem-se em silêncio** e nunca imprimem.
- **Token fresco antes de (re)ligar o socket:** o gateway valida o JWT só no handshake; o
  socket liga com o token capturado na closure e só reabre num 401 HTTP. Um quadro
  inativo não faz HTTP → depois de dormir >15 min tenta reconectar com token expirado →
  **loop de disconnect eterno**. Usar `auth` como função com token renovado e, em
  `connect_error`, disparar o refresh do [api.ts](../../../apps/dashboard/src/lib/api.ts).
- **Indicador de ligação** persistente na Receção (ligado/desligado) e reconexão
  agressiva ao voltar a foreground.
- **Alarme sonoro:** `playAlarm()` cria `AudioContext` sem resume por gesto → a política
  de autoplay do Android deixa-o *suspended* e o beep de nova encomenda **não toca**.
  Retomar o `AudioContext` no 1.º gesto (ecrã de emparelhamento / Testar impressão).
- **Foreground/keep-awake (MVP):** assumir e **documentar** que a app imprime com o ecrã
  ligado e em foreground; keep-awake + indicador de ligação. *(Foreground service com som
  nativo = follow-up se a fiabilidade exigir.)*
- **Reimpressão + fila "por imprimir":** o botão imprimir só existe nos cards ativos
  ([orders/page.tsx](../../../apps/dashboard/src/app/orders/page.tsx):281). Adicionar
  reimpressão no histórico e um filtro/fila **"por imprimir"** com os talões cuja
  (auto)impressão falhou — independentemente do estado da encomenda.
- **IP em DHCP:** impressoras em DHCP mudam de IP no reboot do router → todos os prints
  dão timeout. **Banner persistente** de "impressora inacessível" + badge "por imprimir"
  + retry; documentar/recomendar **reserva DHCP** (ou suportar hostname/mDNS no futuro).

## 8. Erros e resiliência

Falha de impressão → **banner persistente** (não só toast) + badge "por imprimir" no card
+ **reimprimir**. O pedido nunca se perde (chegou pela receção, re-sincronizada). App sem
sessão / refresh revogado → ecrã de emparelhamento.

## 9. Segurança (resumo do modelo)

- Fronteira real = **`@Roles` no servidor** (não esconder nav no cliente). KITCHEN por
  método, mínimo necessário.
- Token **preso à unidade** imposto em refresh/switch (não confiar no cliente).
- Código de emparelhamento: `id.segredo`, uso-único, tentativas limitadas, TTL curto,
  entropia ≥40 bits, rate-limit dedicado, erros neutros.
- Sessão de cozinha: TTLs curtos, deteção de reutilização de refresh, revogação por
  dispositivo + disconnect do socket.

## 10. Testes

- `escpos` — testes puros (já existem).
- **Permissões (e2e):** token KITCHEN → 200 em `GET /orders`, `PATCH /orders/:id/status`;
  **403** em `/orders/summary`, `/tenants/mine`, catálogo, uploads, promoções, faturação,
  escritas de tenant.
- **Pin de unidade (e2e):** KITCHEN em `/auth/switch` ou `refresh` com outro `tenantId` →
  mantém/recusa a unidade original.
- **Emparelhamento (e2e):** gerar código → parear (tokens) → reusar código → recusado;
  N tentativas erradas → lockout; código expirado → neutro; revogar → refresh falha.
- **Modo cozinha (browser/emulador):** nav só Receção; sem TenantSwitcher/banners/login;
  3.º caminho do `printOrder` com plugin mockado; sem IP → estado "configura".
- **Fiabilidade:** simular reconexão do socket → re-sync; token expirado → refresh antes
  de religar.
- **Ponte TCP real:** não simulável aqui — validada com "Testar impressão" na impressora
  do balcão (passo do utilizador), incluindo 58 mm sem auto-cutter.

## 11. Fora de âmbito (YAGNI, para depois)

iOS · **QR** de emparelhamento (câmara/barcode nativos) · config da impressora no servidor
· designação de "dispositivo de impressão" no servidor · auto-impressão de agendadas perto
da hora (job no backend) · foreground service com som nativo · descoberta HTTP/ePOS/mDNS.

## 12. Riscos e gatilhos de rebuild da app

- **Skew web↔APK:** o web atualiza a quente, o APK não. Nunca introduzir no web uma
  chamada/argumento novo do plugin sem **feature-detect** (`Capacitor.isPluginAvailable` +
  `getVersion`) e fallback para APKs antigos; opcionalmente um `minVersion` que o web
  verifica e pede atualização da app.
- **Precisam de rebuild + nova submissão à Play:** qualquer linha do plugin nativo,
  câmara/QR, ícone/splash/keep-awake, bumps de Capacitor/target SDK (a Play exige target
  novo anualmente) e mudança de `server.url`/`allowNavigation`.
- **Política da Play:** um wrapper de site pode cair em "minimum functionality"; mitigado
  por funcionalidade nativa genuína (impressão TCP) e listagem honesta.
- **Dependência do site ao vivo:** um deploy web com regressão parte **todos** os tablets
  ao mesmo tempo → fasear (staging/canário) as mudanças que tocam o modo cozinha.
- **A validar no arranque:** que a WebView remota expõe o bridge do `KitchenPrinter`;
  import de `@capacitor/core` SSR-safe (lazy no ramo nativo) para não onerar/partir o
  build desktop.
