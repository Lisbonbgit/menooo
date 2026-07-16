import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ReservationsService } from './reservations.service';
import { CancelReservationDto, CreatePublicReservationDto } from './dto/public-reservation.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('public')
@Controller('public')
export class PublicReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  /** Slots disponíveis de um dia (throttle global). */
  @Public()
  @Get('stores/:slug/reservation-slots')
  slots(@Param('slug') slug: string, @Query('date') date: string, @Query('party') party: string) {
    return this.reservations.publicSlots(slug, date, Number(party));
  }

  /** Cria a reserva a partir da loja pública (auto-confirma; throttle dedicado). */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('stores/:slug/reservations')
  create(@Param('slug') slug: string, @Body() dto: CreatePublicReservationDto) {
    return this.reservations.createPublic(slug, dto);
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
