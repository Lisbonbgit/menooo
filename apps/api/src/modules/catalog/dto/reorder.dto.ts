import { ArrayNotEmpty, IsArray, IsNotEmpty, IsString } from 'class-validator';

/** Reordenar categorias: a lista COMPLETA de ids do tenant, na nova ordem. */
export class ReorderCategoriesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids!: string[];
}

/** Reordenar produtos DENTRO de uma categoria: a lista COMPLETA de ids dessa categoria. */
export class ReorderProductsDto {
  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids!: string[];
}
