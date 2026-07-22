import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { OrderItemInputDto } from '../../orders/dto/create-order.dto';

/** Pedido feito à mesa (dine-in): sem dados de cliente — vêm da mesa/sessão, não de um formulário. */
export class CreateDineOrderDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];

  @IsOptional()
  @IsString()
  @MaxLength(280)
  notes?: string;
}
