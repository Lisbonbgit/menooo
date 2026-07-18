import { Body, Controller, Get, Headers, Ip, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ReservationsService } from './reservations.service';
import {
  CancelByEmailDto,
  CancelReservationDto,
  CreatePublicReservationDto,
  LookupReservationDto,
} from './dto/public-reservation.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('public')
@Controller('public')
export class PublicReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  /** Slots de um dia — throttle dedicado: é o passo de reconhecimento e um amplificador de queries. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('stores/:slug/reservation-slots')
  slots(@Param('slug') slug: string, @Query('date') date: string, @Query('party') party: string) {
    return this.reservations.publicSlots(slug, date, Number(party));
  }

  /** Disponibilidade de um intervalo — 1 pedido em vez de 30 (ver spec §4). */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('stores/:slug/reservation-days')
  days(
    @Param('slug') slug: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('party') party: string,
  ) {
    return this.reservations.publicDays(slug, from, to, Number(party));
  }

  /** Cria a reserva a partir da loja pública (auto-confirma; throttle dedicado). */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('stores/:slug/reservations')
  create(@Param('slug') slug: string, @Body() dto: CreatePublicReservationDto, @Ip() ip: string) {
    return this.reservations.createPublic(slug, dto, ip);
  }

  /**
   * Consulta por número + email (caminho paralelo ao token, para quem perdeu o email de gestão).
   * Declarada ANTES das rotas `reservations/:code`: hoje o `GET reservations/:code` é outro método,
   * mas se algum dia surgir um `POST reservations/:code`, o Nest resolveria `lookup` como `:code`.
   * A ordem protege contra isso.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reservations/lookup')
  lookup(@Body() dto: LookupReservationDto) {
    return this.reservations.publicByEmail(dto.code, dto.email);
  }

  /** Cancela por número + email — mesma prova de identidade do lookup, revalidada a cada pedido. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reservations/:code/cancel-by-email')
  cancelByEmail(@Param('code') code: string, @Body() dto: CancelByEmailDto) {
    return this.reservations.cancelByEmail(code, dto.email);
  }

  /** Consulta uma reserva pelo código — token SEMPRE por header, nunca em query. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('reservations/:code')
  view(@Param('code') code: string, @Headers('x-reservation-token') token?: string) {
    return this.reservations.publicByCode(code, token);
  }

  /** Cancela a reserva pelo cliente (token no body). */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reservations/:code/cancel')
  cancel(@Param('code') code: string, @Body() dto: CancelReservationDto) {
    return this.reservations.cancelByToken(code, dto.token);
  }
}
