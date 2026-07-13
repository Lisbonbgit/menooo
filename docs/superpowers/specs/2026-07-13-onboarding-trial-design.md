# Onboarding do trial (Item 4)

**Data:** 2026-07-13 · **Estado:** aprovado pelo Matheus

## Objetivo

Levar o dono do restaurante do registo à loja a funcionar. Trials que montam
menu + horários + fazem um pedido de teste convertem; trials com a loja vazia
morrem. Três peças: expectativa de aprovação no registo, email de próximos
passos, e um checklist de onboarding no painel que deteta o que já está feito.

## ① Registo — expectativa de aprovação
Linha no `/register` (dashboard): *"Aprovamos a tua loja normalmente no próprio
dia útil."* Alinhado com a FAQ e o email de boas-vindas. Copy só.

## ② Email de próximos passos
Enriquecer o email de boas-vindas existente (`mail.service.sendWelcome`, dispara
no `verify-email`) para listar os 4 passos numerados (menu → horários/zonas →
impressora → encomenda de teste) + botão para o painel. Sem novo email/gatilho.

## ③ Checklist de onboarding no painel (`/overview`)
Componente **client-side** (`OnboardingChecklist.tsx`), cartão no topo do
overview, visível só enquanto houver passos por fazer e não dispensado. Lê
endpoints existentes (sem backend novo):

| Passo | Feito quando | Deteção | Link |
|---|---|---|---|
| 1. Monta o menu | ≥1 produto | `GET /catalog/products` | `/menu` |
| 2. Horários e zona de entrega | ≥1 horário OU ≥1 zona | `GET /tenants/me/hours` + `GET /delivery-zones` | `/settings` |
| 3. Liga a impressora | toggle manual "Já liguei" | localStorage | `/orders` (Receção) |
| 4. Faz uma encomenda de teste | ≥1 pedido | `GET /orders` | loja pública `/{slug}` |

- Cada passo: círculo (vazio/check), título, uma linha de ajuda, e ação (link
  para a página ou, no passo 3, botão "Já liguei a impressora").
- Barra de progresso "X de 4".
- Botão "Dispensar" (localStorage `menoo-onboarding-dismissed`), e auto-esconde
  quando os 4 passos estão feitos.
- O passo 4 (encomenda de teste) requer a loja aprovada; se estiver PENDING,
  mostra nota "disponível assim que a loja for aprovada" e link desativado.

**Técnica:** só frontend (dashboard). Estado da impressora e "dispensar" em
localStorage. Reutiliza os hooks existentes (useProducts, useHours, useZones,
useOrders). O slug da loja vem de `GET /tenants/me`.

## Fora de âmbito
- Deteção automática da impressora (impossível server-side — é manual).
- "Montamos o menu por ti" (decisão do utilizador: fora por agora).
- WhatsApp (email apenas).
- Alterações ao backend além do texto do email de boas-vindas.

## Critérios de sucesso
- Um dono novo vê o checklist no primeiro login; cada passo feito passa a check
  automaticamente (menu, horários, pedido) sem recarregar à mão.
- O checklist desaparece quando completo ou dispensado.
- Registo mostra a expectativa de aprovação; email de boas-vindas lista os passos.
