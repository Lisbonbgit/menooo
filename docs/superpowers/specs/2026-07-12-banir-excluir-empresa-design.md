# Banir e excluir empresa (backoffice)

**Data:** 2026-07-12 · **Estado:** aprovado pelo Matheus

## Objetivo

O super-admin precisa de expulsar clientes da plataforma: um passo **reversível**
(banir a empresa — bloqueia tudo, guarda os dados) e um **definitivo** (excluir —
apaga a conta e os dados das lojas), mantendo a receita da plataforma intacta
para estatísticas e contabilidade.

## Decisões do utilizador

1. **Âmbito: a conta toda (Account)** — banir/excluir apanha o dono e todas as
   suas unidades de uma vez (a subscrição vive na conta).
2. **Dois níveis:** banir reversível; excluir definitivo só disponível com a
   conta banida; pagamentos (`SubscriptionPayment`) sobrevivem à exclusão.

## Modelo (migração aditiva `20260712_account_ban_delete`)

- `enum AccountStatus { ACTIVE BANNED }`
- `Account.status AccountStatus @default(ACTIVE)` + `Account.bannedAt DateTime?`
- `SubscriptionPayment.accountId` passa a **opcional** com `onDelete: SetNull`;
  novo campo `accountName String?` (snapshot). Backfill no SQL da migração:
  `UPDATE "SubscriptionPayment" sp SET "accountName" = a."name" FROM "Account" a WHERE a."id" = sp."accountId";`
- Ao registar novos pagamentos (admin manual e webhook Stripe), gravar também
  `accountName`.

## API (módulo admin, SUPER_ADMIN)

- `PATCH /admin/accounts/:id/ban` body `{ banned: boolean }`
  - banned=true: `status=BANNED`, `bannedAt=now()`, apaga os `RefreshToken` de
    todos os users da conta (corta sessões; o access token residual expira em
    ≤15 min e nunca dá acesso à loja pública).
  - banned=false: `status=ACTIVE`, `bannedAt=null`.
- `DELETE /admin/accounts/:id`
  - 409 `"Banir a empresa primeiro."` se `status !== BANNED`.
  - Caso contrário apaga a `Account` (cascade: users, tenants e todo o conteúdo
    das lojas — categorias, produtos, encomendas, zonas, cupões, horários,
    grupos de personalização). `SubscriptionPayment` fica com `accountId=null`
    e `accountName` preenchido. Ficheiros de imagens no volume `uploads` ficam
    órfãos (aceitável; sem limpeza nesta fase).
- Respostas de listagem/ficha (`GET /admin/tenants`, `GET /admin/tenants/:id`)
  passam a incluir `account: { id, name, status }`.

## Efeitos do ban fora do admin

- **Gating público** (loja/menu/encomendas/quote/cupão): no mesmo ponto onde se
  valida a subscrição (`isSubscriptionUsable`, que já carrega a conta), conta
  `BANNED` → loja invisível (404), independentemente do estado da subscrição.
- **Login** (`auth.service.login`): user cuja conta está `BANNED` → 403
  `"Conta banida. Contacta o suporte."` (super-admin sem conta não é afetado).
- **Refresh**: os tokens foram apagados no ban; qualquer refresh falha.

## Backoffice (apps/admin)

- **Ficha do restaurante**: nova secção "Empresa" com o nome da conta, estado
  (`ativa` / chip vermelho `banida` + data), e ações:
  - `Banir empresa` (status ACTIVE) / `Reativar empresa` (status BANNED);
  - `Excluir definitivamente` — visível apenas quando banida; abre modal que
    obriga a **escrever o nome da empresa** para ativar o botão; explica que
    apaga lojas, menús, encomendas e utilizadores e que não há volta atrás.
- **Lista de restaurantes**: chip `banida` junto ao nome das lojas cuja conta
  está banida.
- Após excluir, o modal fecha e a lista atualiza (as lojas desaparecem).

## Testes (e2e, embedded postgres)

1. Banir → login do dono 403; loja pública 404; refresh inválido.
2. Reativar → login e loja voltam.
3. Excluir sem ban → 409.
4. Banir + excluir → conta/lojas/users desaparecem; `SubscriptionPayment`
   mantém-se com `accountName` e `accountId=null`; stats de receita inalteradas.
5. Não-super-admin → 403 em ban e delete.

## Fora de âmbito

- Limpeza de ficheiros órfãos no volume de uploads; anonimização RGPD de
  encomendas históricas (apagadas em cascata com as lojas); notificação por
  email ao dono banido/excluído.
