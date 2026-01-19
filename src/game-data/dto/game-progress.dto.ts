import { IsInt, IsBoolean, IsOptional, Min, Max } from 'class-validator';

export class SaveProgressDto {
  @IsInt()
  @Min(0)
  levelIndex: number;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  highestWave?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  stars?: number;
}
