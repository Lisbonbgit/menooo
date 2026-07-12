import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

// URLs públicas (mesmas envs do billing)
const DASHBOARD_URL = () => process.env.DASHBOARD_URL ?? 'https://painel.menooo.com';
const STORE_URL = () => process.env.STORE_URL ?? 'https://menooo.com';

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Emails transacionais via SMTP (qualquer fornecedor; produção usa Resend).
 * Sem SMTP_HOST fica desativado (regista no log e segue sem falhar).
 * SMTP_HOST=json usa o transporte de teste do nodemailer (para e2e).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    this.from = process.env.MAIL_FROM ?? 'Menooo <noreply@menooo.com>';

    if (!host) {
      this.transporter = null;
    } else if (host === 'json') {
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
    } else {
      const port = Number(process.env.SMTP_PORT ?? 587);
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
    }
  }

  isEnabled(): boolean {
    return !!this.transporter;
  }

  /** Envio "fire-and-forget": nunca rebenta o fluxo que o chamou. */
  async send(to: string, subject: string, bodyHtml: string) {
    if (!this.transporter) {
      this.logger.log(`email desativado — não enviado: "${subject}" para ${to}`);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html: this.layout(bodyHtml),
      });
      this.logger.log(`email enviado: "${subject}" para ${to}`);
    } catch (err) {
      this.logger.error(`falha a enviar "${subject}" para ${to}: ${(err as Error).message}`);
    }
  }

  /** Molde da marca (HTML de email: tudo inline, sem fontes externas). */
  private layout(body: string): string {
    return `<!doctype html><html lang="pt"><body style="margin:0;padding:0;background:#FAF6F0;font-family:Georgia,'Times New Roman',serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6F0;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="background:#231A13;border-radius:12px 12px 0 0;padding:20px 28px;">
    <span style="color:#E05A1E;font-size:20px;font-weight:bold;">&#9679;</span>
    <span style="color:#F3EBDF;font-size:20px;font-weight:bold;letter-spacing:-0.02em;">&nbsp;Menooo</span>
  </td></tr>
  <tr><td style="background:#FFFFFF;border:1px solid #EBE1D3;border-top:none;border-radius:0 0 12px 12px;padding:28px;">
    ${body}
    <p style="margin:28px 0 0;padding-top:16px;border-top:1px dashed #EBE1D3;color:#A2937F;font-size:12px;font-family:Arial,Helvetica,sans-serif;">
      Menooo — encomendas online para restaurantes, sem comissões.<br>
      Este email foi enviado automaticamente; se precisares de ajuda, responde a esta mensagem.
    </p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
  }

  private h(text: string) {
    return `<h1 style="margin:0 0 14px;color:#2B211A;font-size:24px;letter-spacing:-0.02em;">${text}</h1>`;
  }

  private p(text: string) {
    return `<p style="margin:0 0 14px;color:#6E6156;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${text}</p>`;
  }

  private cta(label: string, url: string) {
    return `<p style="margin:22px 0 6px;"><a href="${url}" style="background:#E05A1E;color:#FFFFFF;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;display:inline-block;">${label}</a></p>`;
  }

  // ==========================================================================
  // Emails do ciclo de vida
  // ==========================================================================

  /** 0. Código de verificação de email (6 dígitos), no registo. */
  async sendVerificationCode(to: string, name: string, code: string) {
    await this.send(
      to,
      `O teu código Menooo: ${code}`,
      this.h('Confirma o teu email') +
        this.p(`Olá ${name}, usa este código para confirmares a tua conta Menooo:`) +
        `<p style="margin:22px 0;text-align:center;"><span style="display:inline-block;background:#FAF6F0;border:1px solid #EBE1D3;border-radius:10px;padding:14px 26px;font-size:30px;font-weight:bold;letter-spacing:8px;color:#2B211A;font-family:Arial,Helvetica,sans-serif;">${code}</span></p>` +
        this.p('O código é válido durante 20 minutos. Se não foste tu a criar a conta, ignora este email.'),
    );
  }

  /** 1. Boas-vindas, logo após o registo. */
  async sendWelcome(to: string, ownerName: string, restaurantName: string) {
    await this.send(
      to,
      `Bem-vindo ao Menooo — a ${restaurantName} foi criada`,
      this.h(`Bem-vindo, ${ownerName}.`) +
        this.p(
          `A tua loja <strong>${restaurantName}</strong> foi criada e está em análise pela nossa equipa — normalmente aprovamos no próprio dia.`,
        ) +
        this.p(
          `Entretanto já podes entrar no painel e adiantar trabalho: montar o menu com tamanhos e extras, definir horários e configurar a impressão de talões.`,
        ) +
        this.cta('Abrir o painel', `${DASHBOARD_URL()}/menu`),
    );
  }

  /** 2. Loja aprovada — começa o teste de 7 dias. */
  async sendActivated(to: string, restaurantName: string, slug: string, trialEndsAt: Date) {
    await this.send(
      to,
      `A ${restaurantName} está no ar — 7 dias grátis começaram`,
      this.h('A tua loja está no ar.') +
        this.p(
          `A <strong>${restaurantName}</strong> foi aprovada e já está visível aos clientes. O teu período de teste gratuito termina a <strong>${fmtDate(trialEndsAt)}</strong>.`,
        ) +
        this.p(
          `O link da tua loja: <a href="${STORE_URL()}/${slug}" style="color:#C24812;">${STORE_URL().replace('https://', '')}/${slug}</a> — partilha-o nas redes sociais ou num código QR na montra.`,
        ) +
        this.cta('Abrir a receção de pedidos', `${DASHBOARD_URL()}/orders`),
    );
  }

  /** 3. Aviso: o teste termina em breve. */
  async sendTrialEnding(to: string, restaurantName: string, daysLeft: number, trialEndsAt: Date) {
    const dias = daysLeft === 1 ? '1 dia' : `${daysLeft} dias`;
    await this.send(
      to,
      `O teste gratuito da ${restaurantName} termina em ${dias}`,
      this.h(`Faltam ${dias} de teste gratuito.`) +
        this.p(
          `O período de teste da <strong>${restaurantName}</strong> termina a <strong>${fmtDate(trialEndsAt)}</strong>. Depois dessa data, a loja fica offline para os clientes até ativares a subscrição.`,
        ) +
        this.p(
          `A subscrição custa <strong>€9,90/mês</strong>, sem comissões sobre as vendas e sem fidelização — ativa-se com cartão em menos de um minuto, diretamente no painel.`,
        ) +
        this.cta('Ativar a subscrição', `${DASHBOARD_URL()}/settings`),
    );
  }

  /** 4. Subscrição ativa (primeiro pagamento). */
  async sendSubscriptionActive(to: string, restaurantName: string, paidUntil: Date) {
    await this.send(
      to,
      `Subscrição ativa — a ${restaurantName} está garantida`,
      this.h('Subscrição ativa. Obrigado.') +
        this.p(
          `O pagamento foi recebido e a <strong>${restaurantName}</strong> tem a subscrição ativa até <strong>${fmtDate(paidUntil)}</strong>. A renovação é automática todos os meses.`,
        ) +
        this.p(
          `Podes gerir o cartão, ver faturas ou cancelar a qualquer momento no painel, em Definições → Subscrição.`,
        ) +
        this.cta('Abrir o painel', `${DASHBOARD_URL()}/overview`),
    );
  }

  /** 5. Subscrição cancelada. */
  async sendSubscriptionCancelled(to: string, restaurantName: string, paidUntil: Date | null) {
    await this.send(
      to,
      `Subscrição da ${restaurantName} cancelada`,
      this.h('A tua subscrição foi cancelada.') +
        this.p(
          paidUntil
            ? `A <strong>${restaurantName}</strong> mantém acesso completo até <strong>${fmtDate(paidUntil)}</strong>. Depois dessa data, a loja fica offline para os clientes — o teu menu e histórico ficam guardados.`
            : `A <strong>${restaurantName}</strong> deixará de renovar automaticamente.`,
        ) +
        this.p(`Mudaste de ideias? Podes reativar em segundos no painel.`) +
        this.cta('Reativar a subscrição', `${DASHBOARD_URL()}/settings`),
    );
  }
}
