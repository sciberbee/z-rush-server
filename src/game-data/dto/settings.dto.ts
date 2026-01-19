import { IsBoolean, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  musicVolume?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  sfxVolume?: number;

  @IsOptional()
  @IsBoolean()
  vibrationEnabled?: boolean;
}
