import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { TrialReminderService } from './trial-reminder.service';

@Global()
@Module({
  providers: [MailService, TrialReminderService],
  exports: [MailService],
})
export class MailModule {}
