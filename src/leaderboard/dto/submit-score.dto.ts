import { IsInt, Min } from 'class-validator';

export class SubmitScoreDto {
  @IsInt()
  @Min(0)
  levelIndex: number;

  @IsInt()
  @Min(0)
  score: number;

  @IsInt()
  @Min(0)
  soldierCount: number;
}
