# Publicar a app de cozinha — passos que são teus

> **Nada disto foi executado.** Esta sessão não tem acesso SSH ao VPS (foi
> bloqueado pelo classificador de permissões), não tem a keystore, e não tem
> impressora. O que está aqui é o que falta, escrito para não se perder.

## 1. Assinar o APK (só tu)

O ramo produz um APK de **debug** (`pnpm --filter @comanda/cozinha apk:debug`),
que instala e serve para testar tudo. Para distribuir a restaurantes, precisa de
ser assinado com uma keystore.

A keystore **não está neste repositório e não deve estar** — o `.gitignore` já
recusa `*.keystore`/`*.jks`. Guarda-a com o mesmo cuidado de uma password de
produção: **se a perderes, perdes o caminho de atualização da app para sempre**
(um APK assinado por outra keystore não atualiza o anterior, tem de ser
desinstalado e reinstalado em todos os tablets).

O precedente está em `~/Developer/RH/frontend/android` — mesma abordagem.

## 2. Testar com hardware a sério (só tu)

O que **está** provado (5 testes JVM, `pnpm --filter @comanda/cozinha test:printer`):
os bytes saem tal e qual pelo socket; ligações concorrentes são serializadas
(nunca dois sockets na mesma térmica); *timeout* e *ligação recusada* são
distinguidos. Provado a sério — a fila estragada de propósito põe o teste
vermelho.

O que **não** está provado, e nenhum teste aqui pode provar:

- [ ] A térmica real interpreta os bytes e o talão sai bem (58 mm e 80 mm).
- [ ] `Capacitor.isPluginAvailable('KitchenPrinter')` dá `true` no APK instalado.
      O registo antes do `super.onCreate()` está escrito conforme a fonte do
      Capacitor 6.2.1, mas nunca correu num dispositivo.
- [ ] Cold-start com LAN mas **sem** WAN mostra o ecrã de erro (e não branco).
- [ ] Emparelhamento ponta a ponta a partir do APK.
- [ ] Uma encomenda real cai no tablet e imprime.

## 3. Publicar o APK no VPS

```bash
mkdir -p /srv/menooo/downloads
# do Mac:
scp menooo-cozinha-1.0.0.apk root@187.124.4.163:/srv/menooo/downloads/
# link fixo que a página /cozinha aponta; por baixo muda a versão
ln -sf /srv/menooo/downloads/menooo-cozinha-1.0.0.apk /srv/menooo/downloads/menooo-cozinha.apk
```

Acrescenta o bloco de `Caddyfile.cozinha.snippet` ao Caddyfile e **valida antes
de recarregar** — o Caddy é um processo só e serve o `menooo.com` que está no ar;
um reload falhado derruba a loja:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
curl -sI https://menooo.com/downloads/menooo-cozinha.apk | head -3   # 200
```

## 4. Confirmar o que eu só pude observar de fora

O `.env.production.example` deste ramo foi alinhado com o que a produção
**responde** publicamente (`api.menooo.com` → 200, Let's Encrypt, CORS a aceitar
o apex). Sem SSH, não pude ler o `.env` real. Confirma que batem certo,
sobretudo o `CORS_ORIGINS` e o `PUBLIC_API_URL`.

## 5. Fechar as portas 8080-8082 (dívida antiga, não é deste ramo)

Verificado em 17/07 às 01:25: `http://187.124.4.163:8080|8081|8082` respondem
`200` ao público. Quem lhes bate direto **contorna o Caddy**.

Passar os `ports:` do `docker-compose.prod.yml` de `"8081:3002"` para
`"127.0.0.1:18081:3002"` (e equivalentes), e apontar o Caddy para as portas de
loopback.

**Fechar no `ufw` não chega**: o docker-proxy escreve regras iptables que passam
à frente do firewall.

> A metade do problema que era o `trust proxy` já foi corrigida noutro ramo
> (`matheus-reservas-fase3`, commit `2053fc8`, "trust proxy só com proxy real"),
> encontrada de forma independente por outra revisão adversarial. Isto aqui é a
> outra metade: enquanto as portas estiverem abertas, há um caminho de entrada
> que não passa pelo Caddy.
