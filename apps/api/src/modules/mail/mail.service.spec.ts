import { Logger } from '@nestjs/common';
import { MailService, type ReservationMailInfo } from './mail.service';

const DIA_MS = 86_400_000;

const info: ReservationMailInfo = {
  restaurantName: 'Pizzaria Demo',
  code: 'ABC123',
  dateText: '20 de julho de 2026',
  timeText: '20:00',
  partySize: 2,
  tableNames: ['3'],
};

describe('MailService — teto por destinatário', () => {
  let svc: MailService;
  let sendMail: jest.SpyInstance;

  beforeEach(() => {
    // jsonTransport do nodemailer: não sai nada para a rede.
    process.env.SMTP_HOST = 'json';
    // silenciar o Logger para o output dos testes ficar legível
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    svc = new MailService();
    sendMail = jest
      .spyOn((svc as unknown as { transporter: { sendMail: () => Promise<unknown> } }).transporter, 'sendMail')
      .mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    delete process.env.SMTP_HOST;
  });

  it('o 6.º email de reserva para o MESMO destinatário em 24h é descartado', async () => {
    for (let i = 0; i < 6; i++) {
      await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    }
    // 5 passam, o 6.º cai
    expect(sendMail).toHaveBeenCalledTimes(5);
  });

  it('um destinatário DIFERENTE passa mesmo com o primeiro no teto', async () => {
    for (let i = 0; i < 6; i++) {
      await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    }
    expect(sendMail).toHaveBeenCalledTimes(5);

    await svc.sendReservationConfirmed('bruno@x.pt', 'Bruno', info);
    expect(sendMail).toHaveBeenCalledTimes(6);
    expect(sendMail).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'bruno@x.pt' }));
  });

  it('o teto é por caixa NORMALIZADA (trim + lowercase), não por string crua', async () => {
    await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    await svc.sendReservationConfirmed(' Ana@X.pt ', 'Ana', info);
    await svc.sendReservationConfirmed('ANA@X.PT', 'Ana', info);
    await svc.sendReservationConfirmed('ana@x.pt ', 'Ana', info);
    await svc.sendReservationConfirmed(' ana@x.pt', 'Ana', info);
    expect(sendMail).toHaveBeenCalledTimes(5);

    // 6.ª variante da MESMA caixa → descartada
    await svc.sendReservationConfirmed('Ana@x.PT', 'Ana', info);
    expect(sendMail).toHaveBeenCalledTimes(5);
  });

  it('os 4 emails de reserva partilham o mesmo balde', async () => {
    await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    await svc.sendReservationCancelled('ana@x.pt', 'Ana', info, false);
    await svc.sendNewReservationAlert('ana@x.pt', { ...info, customerName: 'Ana', customerPhone: '912345678' });
    await svc.sendReservationCancelledAlert('ana@x.pt', { ...info, customerName: 'Ana' });
    await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    expect(sendMail).toHaveBeenCalledTimes(5);

    // o 6.º, seja qual for o método, cai
    await svc.sendReservationCancelledAlert('ana@x.pt', { ...info, customerName: 'Ana' });
    expect(sendMail).toHaveBeenCalledTimes(5);
  });

  it('a janela DESLIZA: passadas 24h o destinatário volta a poder receber', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-17T10:00:00Z'));

    for (let i = 0; i < 6; i++) {
      await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    }
    expect(sendMail).toHaveBeenCalledTimes(5);

    // ainda dentro das 24h → continua a cair
    jest.setSystemTime(new Date(Date.now() + DIA_MS - 60_000));
    await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    expect(sendMail).toHaveBeenCalledTimes(5);

    // passadas as 24h dos primeiros → volta a passar
    jest.setSystemTime(new Date(Date.now() + 2 * 60_000));
    await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    expect(sendMail).toHaveBeenCalledTimes(6);
  });

  it('CRÍTICO: emails de CONTA nunca são silenciados pelo teto de reservas', async () => {
    // esgotar o balde de reservas deste destinatário
    for (let i = 0; i < 6; i++) {
      await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    }
    expect(sendMail).toHaveBeenCalledTimes(5);

    // verificação de email e reposição de password TÊM de sair na mesma
    await svc.sendVerificationCode('ana@x.pt', 'Ana', '123456');
    await svc.sendPasswordReset('ana@x.pt', 'Ana', '654321');
    await svc.sendVerificationCode('ana@x.pt', 'Ana', '111111');
    await svc.sendPasswordReset('ana@x.pt', 'Ana', '222222');
    expect(sendMail).toHaveBeenCalledTimes(9);
  });

  it('o send() genérico não consome o balde das reservas', async () => {
    // 10 envios genéricos não podem gastar o teto
    for (let i = 0; i < 10; i++) {
      await svc.send('ana@x.pt', 'assunto', '<p>corpo</p>');
    }
    expect(sendMail).toHaveBeenCalledTimes(10);

    // as 5 de reserva continuam disponíveis
    for (let i = 0; i < 6; i++) {
      await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    }
    expect(sendMail).toHaveBeenCalledTimes(15);
  });
});
