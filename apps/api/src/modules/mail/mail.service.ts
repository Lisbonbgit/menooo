import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

// URLs públicas (mesmas envs do billing)
const DASHBOARD_URL = () => process.env.DASHBOARD_URL ?? 'https://painel.menooo.com';
const STORE_URL = () => process.env.STORE_URL ?? 'https://menooo.com';
const ADMIN_URL = () => process.env.ADMIN_URL ?? 'https://admin.menooo.com';

// caixa da equipa que recebe os avisos internos da plataforma
const NOTIFY_EMAIL = () => process.env.PLATFORM_NOTIFY_EMAIL ?? 'geral@lisbonb.com';

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });

/** Dados de uma reserva usados nos templates de email (Fase R1). */
export interface ReservationMailInfo {
  restaurantName: string;
  code: string;
  dateText: string;
  timeText: string;
  partySize: number;
  tableNames: string[];
  manageUrl?: string;
}

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

  private readonly recentByRecipient = new Map<string, number[]>();
  private static readonly MAX_PER_DAY = 5;

  /** Teto por destinatário: o Turnstile PREÇA o abuso, não o limita. Protege terceiros e a
   *  reputação do MAIL_FROM, que é partilhado por TODOS os tenants. */
  private overRecipientLimit(to: string): boolean {
    const key = to.trim().toLowerCase();
    const now = Date.now();
    const win = (this.recentByRecipient.get(key) ?? []).filter((t) => now - t < 86_400_000);
    if (win.length >= MailService.MAX_PER_DAY) {
      this.recentByRecipient.set(key, win);
      return true;
    }
    win.push(now);
    this.recentByRecipient.set(key, win);
    if (this.recentByRecipient.size > 5_000) {
      for (const [k, v] of this.recentByRecipient) if (v.every((t) => now - t >= 86_400_000)) this.recentByRecipient.delete(k);
    }
    return false;
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

  /** Escapa input do cliente para HTML e remove quebras (anti-injeção em templates/headers). */
  private esc(s: string): string {
    return s
      .replace(/[\r\n]+/g, ' ')
      .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  }

  private pax(n: number): string {
    return n === 1 ? '1 pessoa' : `${n} pessoas`;
  }

  private tableLabel(names: string[]): string {
    if (names.length === 0) return '—';
    return names.length > 1 ? `Mesas ${names.join(', ')}` : `Mesa ${names[0]}`;
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

  /** 0b. Código de reposição de password ("esqueci-me"). */
  async sendPasswordReset(to: string, name: string, code: string) {
    await this.send(
      to,
      `Repor a tua password Menooo: ${code}`,
      this.h('Repor a password') +
        this.p(`Olá ${name}, usa este código para definires uma password nova:`) +
        `<p style="margin:22px 0;text-align:center;"><span style="display:inline-block;background:#FAF6F0;border:1px solid #EBE1D3;border-radius:10px;padding:14px 26px;font-size:30px;font-weight:bold;letter-spacing:8px;color:#2B211A;font-family:Arial,Helvetica,sans-serif;">${code}</span></p>` +
        this.p(
          'O código é válido durante 20 minutos. Se não pediste esta reposição, ignora este email — a tua password mantém-se.',
        ),
    );
  }

  /** 1. Boas-vindas, logo após o registo — com os próximos passos. */
  async sendWelcome(to: string, ownerName: string, restaurantName: string) {
    const steps = [
      'Monta o menu — categorias, produtos, tamanhos e extras.',
      'Define os horários e a zona de entrega.',
      'Liga a impressora térmica (opcional — também imprime pelo browser).',
      'Faz uma encomenda de teste assim que a loja for aprovada.',
    ];
    const ol =
      `<ol style="margin:0 0 14px;padding-left:20px;color:#6E6156;font-size:15px;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">` +
      steps.map((s) => `<li style="margin-bottom:6px;">${s}</li>`).join('') +
      `</ol>`;
    await this.send(
      to,
      `Bem-vindo ao Menooo — a ${restaurantName} foi criada`,
      this.h(`Bem-vindo, ${ownerName}.`) +
        this.p(
          `A tua loja <strong>${restaurantName}</strong> foi criada e está em análise pela nossa equipa — normalmente aprovamos no próprio dia útil.`,
        ) +
        this.p('Entretanto já podes adiantar trabalho no painel. Os próximos passos:') +
        ol +
        this.cta('Abrir o painel', `${DASHBOARD_URL()}/overview`),
    );
  }

  /** 1b. Aviso interno à equipa: restaurante novo à espera de ativação no admin. */
  async sendNewRegistrationAlert(info: {
    restaurantName: string;
    slug: string;
    ownerName: string;
    ownerEmail: string;
    referralSource?: string | null;
  }) {
    await this.send(
      NOTIFY_EMAIL(),
      `Novo registo: ${info.restaurantName} — pendente de ativação`,
      this.h('Restaurante novo à espera de ativação') +
        this.p(
          `<strong>${info.restaurantName}</strong> (/${info.slug}) acabou de confirmar o registo no Menooo.`,
        ) +
        this.p(
          `Dono: <strong>${info.ownerName}</strong> · ${info.ownerEmail}` +
            (info.referralSource ? `<br>Como nos conheceu: ${info.referralSource}` : ''),
        ) +
        this.cta('Abrir o admin e ativar', ADMIN_URL()) +
        this.p('A loja fica invisível ao público até ser ativada.'),
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

  // ==========================================================================
  // Reservas
  // ==========================================================================

  /** 6. Reserva confirmada — enviado ao cliente. */
  async sendReservationConfirmed(to: string, customerName: string, info: ReservationMailInfo) {
    if (this.overRecipientLimit(to)) {
      this.logger.warn(`mail_rate_limited: destinatário atingiu o teto diário de emails de reserva`);
      return;
    }
    await this.send(
      to,
      `Reserva confirmada — ${info.restaurantName} (${info.code})`,
      this.h('Reserva confirmada.') +
        this.p(
          `Olá ${this.esc(customerName)}, a tua reserva na <strong>${info.restaurantName}</strong> está confirmada.`,
        ) +
        this.p(
          `<strong>${info.dateText}</strong>, às <strong>${info.timeText}</strong> · ${this.pax(info.partySize)} · ${this.tableLabel(info.tableNames)}<br>Código da reserva: <strong>${info.code}</strong>`,
        ) +
        (info.manageUrl ? this.cta('Gerir reserva', info.manageUrl) : ''),
    );
  }

  /** 7. Reserva cancelada — enviado ao cliente (pelo restaurante ou por ele próprio). */
  async sendReservationCancelled(
    to: string,
    customerName: string,
    info: ReservationMailInfo,
    byRestaurant: boolean,
  ) {
    if (this.overRecipientLimit(to)) {
      this.logger.warn(`mail_rate_limited: destinatário atingiu o teto diário de emails de reserva`);
      return;
    }
    await this.send(
      to,
      `Reserva cancelada — ${info.restaurantName} (${info.code})`,
      this.h('Reserva cancelada.') +
        this.p(
          byRestaurant
            ? `Olá ${this.esc(customerName)}, a tua reserva na <strong>${info.restaurantName}</strong> foi cancelada pelo restaurante.`
            : `Olá ${this.esc(customerName)}, confirmamos o cancelamento da tua reserva na <strong>${info.restaurantName}</strong>.`,
        ) +
        this.p(
          `<strong>${info.dateText}</strong>, às <strong>${info.timeText}</strong> · ${this.pax(info.partySize)} · ${this.tableLabel(info.tableNames)}<br>Código da reserva: <strong>${info.code}</strong>`,
        ),
    );
  }

  /** 8. Aviso ao restaurante: nova reserva recebida. */
  async sendNewReservationAlert(
    to: string,
    info: ReservationMailInfo & { customerName: string; customerPhone: string; notes?: string | null },
  ) {
    if (this.overRecipientLimit(to)) {
      this.logger.warn(`mail_rate_limited: destinatário atingiu o teto diário de emails de reserva`);
      return;
    }
    await this.send(
      to,
      `Nova reserva — ${info.restaurantName} (${info.code})`,
      this.h('Nova reserva.') +
        this.p(
          `Uma nova reserva foi criada na <strong>${info.restaurantName}</strong> — código <strong>${info.code}</strong>.`,
        ) +
        this.p(
          `<strong>${this.esc(info.customerName)}</strong> · ${this.esc(info.customerPhone)}<br>${this.pax(info.partySize)} · ${info.dateText} às ${info.timeText} · ${this.tableLabel(info.tableNames)}`,
        ) +
        (info.notes ? this.p(`Notas: ${this.esc(info.notes)}`) : ''),
    );
  }

  /** 9. Aviso ao restaurante: reserva cancelada. */
  async sendReservationCancelledAlert(to: string, info: ReservationMailInfo & { customerName: string }) {
    if (this.overRecipientLimit(to)) {
      this.logger.warn(`mail_rate_limited: destinatário atingiu o teto diário de emails de reserva`);
      return;
    }
    await this.send(
      to,
      `Reserva cancelada — ${info.restaurantName} (${info.code})`,
      this.h('Reserva cancelada.') +
        this.p(
          `A reserva <strong>${info.code}</strong> de <strong>${this.esc(info.customerName)}</strong> na <strong>${info.restaurantName}</strong> foi cancelada.`,
        ) +
        this.p(
          `${this.pax(info.partySize)} · ${info.dateText} às ${info.timeText} · ${this.tableLabel(info.tableNames)}`,
        ),
    );
  }
}
