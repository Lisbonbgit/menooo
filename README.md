# Menoo 🍔

Plataforma **SaaS multi-tenant de encomendas online para restaurantes** — substituto self-hosted do GloriaFood.

- Cada restaurante tem a sua **loja pública** (`/loja/{slug}`) com menu, carrinho e checkout.
- O restaurante recebe e gere encomendas num **painel web em tempo real** (tablet no balcão).
- Receção com **impressão local** (talão térmico), pagamento **online (MB WAY/cartão)** ou **à porta**.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Monorepo | pnpm workspaces + Turborepo |
| API | NestJS 10 + Prisma 6 + PostgreSQL |
| Auth | JWT (access) + Argon2 |
| Frontends | Next.js 15 + React 18 + TanStack Query + Zustand + Tailwind |

## Apps (planeadas)

| App | Porta | Descrição |
|-----|-------|-----------|
| `apps/api` | 3001 | Backend NestJS multi-tenant |
| `apps/storefront` | 3000 | Loja pública do cliente (menu + checkout) |
| `apps/dashboard` | 3002 | Painel do restaurante (receção, menu, definições, horários) |
| `apps/admin` | 3003 | Super-admin da plataforma (ativar/suspender restaurantes) |

## Arranque rápido

```bash
# Pré-requisitos: Node 20+, pnpm 9+
cp .env.example .env
pnpm install

# Opção A — com Docker:
pnpm docker:up          # PostgreSQL em localhost:5433
pnpm db:migrate && pnpm db:seed

# Opção B — sem Docker (Postgres embebido, recomendado nesta máquina):
pnpm --filter @comanda/api db:serve   # arranca DB + migra + semeia e fica vivo

# Noutro terminal: arrancar as apps
pnpm --filter @comanda/api dev         # API     → http://localhost:3001/api
pnpm --filter @comanda/dashboard dev   # Painel  → http://localhost:3002
pnpm --filter @comanda/storefront dev  # Loja    → http://localhost:3000/pizzaria-demo
pnpm --filter @comanda/admin dev       # Admin   → http://localhost:3003 (admin@menoo.pt / admin1234)
```

API em http://localhost:3001/api · Swagger em http://localhost:3001/api/docs

### Credenciais demo (após seed)

- **Super admin:** `admin@menoo.pt` / `admin1234`
- **Restaurante:** `dono@pizzaria-demo.pt` / `demo1234` (loja: `pizzaria-demo`)

## Impressão do talão (balcão)

Dois modos, configuráveis no painel em **Receção → Impressão**:

- **Impressora térmica (recomendado):** instalar o **[QZ Tray](https://qz.io/)** no PC/tablet do balcão. O painel deteta as impressoras, envia o talão em **ESC/POS** e pode **imprimir automaticamente** cada nova encomenda. Para funcionar offline, servir o `qz-tray.js` localmente e definir `NEXT_PUBLIC_QZ_SCRIPT_URL=/qz-tray.js`.
- **Sem QZ Tray:** o talão abre numa janela e usa a **impressão normal do browser** (qualquer impressora).

## Deploy (produção)

Imagem Docker única do monorepo, usada pelos 4 serviços, isolada por portas
(`8080-8083`). Acesso por IP enquanto não há domínio.

| Serviço | URL |
|---------|-----|
| Loja (cliente) | `http://<IP>:8080/<slug>` |
| Painel do restaurante | `http://<IP>:8081` |
| Admin da plataforma | `http://<IP>:8082` |
| API | `http://<IP>:8083/api` |

```bash
# no servidor, dentro do repositório clonado:
cp .env.production.example .env   # preencher segredos + IP
docker compose -f docker-compose.prod.yml up -d --build
```

A API corre as migrações (`prisma migrate deploy`) e o seed automaticamente no
arranque. Se mudar o `NEXT_PUBLIC_API_URL` (IP/porta/domínio), é preciso
reconstruir as apps (`--build`), pois é embebido no cliente.

## Roadmap (por fases)

- [x] **Fase 0** — Fundação: monorepo, modelo multi-tenant, auth, registo de restaurante
- [x] **Fase 1** — Gestão de menu: catálogo CRUD (backend) + painel `dashboard` (login + gestão de menu)
- [x] **Fase 2** — Storefront público + carrinho + checkout (pagar à porta); encomendas com preços recalculados no servidor
- [x] **Fase 3** — Painel de receção em tempo real (WebSocket + alarme + máquina de estados da encomenda)
- [x] **Fase 4** — Impressão do talão: ESC/POS via QZ Tray (térmica) + fallback de impressão pelo browser; auto-impressão
- [ ] **Fase 5** — Pagamento online (IfThenPay/Stripe — MB WAY/cartão)
- [x] **Fase 6** — Admin da plataforma (ativar/suspender restaurantes) + definições da loja + horários de funcionamento
- [x] **Fase 6b** — Zonas de entrega (taxa/mínimo por código postal) + cupões de desconto (% ou fixo)
