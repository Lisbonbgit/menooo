# App de cozinha — publicação e distribuição

Estado em 2026-07-17: **a app está provada ponta a ponta** (o talão saiu de uma
térmica real) e a **release 1.0.0 está assinada e no ar**. Este documento é o
processo para publicar versões novas e o que ainda falta.

## Como o APK é servido (o que está no ar)

O APK **não** é servido por um bloco próprio do Caddy. Reaproveita o `/uploads`
da API, que já serve as fotos das lojas:

- `apps/api/src/main.ts:25` — `useStaticAssets(uploadsDir, { prefix: '/uploads', maxAge: '7d', immutable: true })`, sobre o volume `comanda-uploads`.
- O APK vive em `comanda-api:/app/uploads/menooo-cozinha-<versão>.apk`.
- Servido em `https://api.menooo.com/uploads/menooo-cozinha-<versão>.apk`
  (Content-Type `application/vnd.android.package-archive`).
- O botão da página `/cozinha` aponta para lá
  (`apps/storefront/src/app/cozinha/page.tsx`, constante `APK_URL`).

> **Porque não um bloco Caddy `/downloads`:** o Caddy do menooo é o contentor
> **partilhado** `rh-caddy-1` (Caddyfile em `/root/RH/Caddyfile`), comum ao RH e
> ao olacai. Editá-lo obriga a `docker restart rh-caddy-1` e pisca os três
> projetos. O `/uploads` evita isso por completo.

> **Nome versionado, obrigatório:** o `/uploads` tem `immutable, maxAge 7d`.
> Substituir o APK no **mesmo** nome não é apanhado pelos caches durante 7 dias.
> Cada versão nova tem de ter **nome novo** (`-1.0.1.apk`, …) e o `APK_VERSION`
> na página muda em conjunto.

## Publicar uma versão nova

Pré-requisitos: `keystore.properties` + `menooo-cozinha.keystore` em
`apps/cozinha/android/` (gitignored; ver "Keystore" abaixo).

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
export ANDROID_HOME="$HOME/Library/Android/sdk"

# 1. subir a versão em apps/cozinha/android/app/build.gradle (versionCode E versionName)
#    e o APK_VERSION em apps/storefront/src/app/cozinha/page.tsx (têm de bater certo)

# 2. build assinado
cd apps/cozinha/android && ./gradlew clean assembleRelease

# 3. confirmar a assinatura (tem de ser CN=Fordaimon Foods, não androiddebugkey)
APKSIGNER=$(ls ~/Library/Android/sdk/build-tools/*/apksigner | sort -V | tail -1)
"$APKSIGNER" verify --print-certs app/build/outputs/apk/release/app-release.apk | grep -i "signer.*DN"

# 4. publicar no volume /uploads (nome versionado!)
V=1.0.1
scp app/build/outputs/apk/release/app-release.apk root@187.124.4.163:/tmp/menooo-cozinha-$V.apk
ssh root@187.124.4.163 "docker cp /tmp/menooo-cozinha-$V.apk comanda-api:/app/uploads/menooo-cozinha-$V.apk && rm /tmp/menooo-cozinha-$V.apk"

# 5. deployar a web (o botão da página passa a apontar para a versão nova)
#    rsync + docker compose up -d --build  — ver o deploy geral do projeto
```

## Keystore (crítico)

Vive em `apps/cozinha/android/menooo-cozinha.keystore` (+ `keystore.properties`
com as passwords), ambos **gitignored**. `CN=Fordaimon Foods`, alias
`menooo-cozinha`, RSA 2048, validade 10000 dias.

**Se a keystore se perder, perde-se a capacidade de atualizar a app nos tablets
para sempre** — um APK assinado por outra chave não atualiza o anterior, obriga a
desinstalar+reinstalar em todos. **Fazer backup dela fora deste Mac** (a keystore
E a password, em sítios separados). Ela não existe em mais lado nenhum.

## Ainda por fazer

- [ ] **Fechar as portas 8080-8082 ao público** (dívida antiga, não é desta
  fase). Estão abertas: quem lhes bate direto contorna o Caddy. Passar os
  `ports:` do `docker-compose.prod.yml` para `127.0.0.1:PORTA:INTERNA`. Fechar no
  `ufw` **não chega** — o docker-proxy escreve iptables à frente do firewall.
- [ ] **Play Store** — se algum dia se quiser publicar lá, é `bundleRelease` (AAB)
  em vez de APK, e o wrapper de WebView arrisca a regra de "minimum functionality"
  (mitigado pela impressão TCP nativa).
