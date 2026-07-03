# ============================================================================
# Imagem única do monorepo Comanda — construída uma vez, usada pelos 4 serviços
# (api, storefront, dashboard, admin). Cada serviço corre um comando diferente.
# ============================================================================
FROM node:20-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production

# dependências de sistema: módulos nativos (argon2), prisma (openssl), healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

# manifests primeiro (camada de cache de instalação)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY apps/api/package.json ./apps/api/
COPY apps/storefront/package.json ./apps/storefront/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY apps/admin/package.json ./apps/admin/

# instala TUDO (inclui devDeps necessárias ao build); NODE_ENV=development força-o
RUN NODE_ENV=development pnpm install --frozen-lockfile

# código-fonte
COPY . .

# Prisma client + build da API (NestJS)
RUN pnpm --filter @comanda/api prisma:generate \
 && pnpm --filter @comanda/api build

# build das apps Next — a URL pública da API é embebida no bundle do cliente
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_STORE_URL
ARG NEXT_PUBLIC_DASHBOARD_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_STORE_URL=$NEXT_PUBLIC_STORE_URL
ENV NEXT_PUBLIC_DASHBOARD_URL=$NEXT_PUBLIC_DASHBOARD_URL
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN pnpm --filter @comanda/storefront build \
 && pnpm --filter @comanda/dashboard build \
 && pnpm --filter @comanda/admin build
ENV NODE_OPTIONS=

# entrypoint da API (migrações + seed antes de arrancar)
RUN chmod +x apps/api/docker-entrypoint.sh

EXPOSE 3000 3001 3002 3003
