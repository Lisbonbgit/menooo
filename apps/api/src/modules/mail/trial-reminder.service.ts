import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from './mail.service';

const REMIND_DAYS_BEFORE = 2; // avisar quando faltam <= 2 dias de teste

/**
 * Verificação diária: restaurantes cujo teste gratuito está a terminar
 * recebem um aviso por email (uma única vez, marcada em trialReminderSentAt).
 */
@Injectable()
export class TrialReminderService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TrialReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Todos os dias às 09:00 (Lisboa). */
  @Cron('0 9 * * *', { timeZone: 'Europe/Lisbon' })
  async checkTrials() {
    if (!this.mail.isEnabled()) return;

    const now = new Date();
    const windowEnd = new Date(now.getTime() + REMIND_DAYS_BEFORE * 86_400_000);

    const tenants = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        trialReminderSentAt: null,
        trialEndsAt: { gt: now, lte: windowEnd },
        // sem subscrição paga em dia (senão o aviso não faz sentido)
        OR: [{ paidUntil: null }, { paidUntil: { lt: now } }],
      },
    });

    for (const t of tenants) {
      const to = t.email;
      if (!to || !t.trialEndsAt) continue;
      const daysLeft = Math.max(
        1,
        Math.ceil((t.trialEndsAt.getTime() - now.getTime()) / 86_400_000),
      );
      await this.mail.sendTrialEnding(to, t.name, daysLeft, t.trialEndsAt);
      await this.prisma.tenant.update({
        where: { id: t.id },
        data: { trialReminderSentAt: new Date() },
      });
    }

    if (tenants.length > 0) {
      this.logger.log(`avisos de fim de teste enviados: ${tenants.length}`);
    }
  }

  /** Em testes (MAIL_REMINDER_ON_BOOT=1) corre a verificação logo no arranque. */
  async onApplicationBootstrap() {
    if (process.env.MAIL_REMINDER_ON_BOOT === '1') {
      await this.checkTrials();
    }
  }
}
