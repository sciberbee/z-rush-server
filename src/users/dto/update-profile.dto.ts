import { IsOptional, IsString, Matches, IsIn } from 'class-validator';

export const WEAPON_TYPES = ['pistol', 'rifle', 'shotgun', 'smg'] as const;
export type WeaponType = typeof WEAPON_TYPES[number];

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  playerName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'playerColor must be a valid hex color' })
  playerColor?: string;

  @IsOptional()
  @IsString()
  @IsIn(WEAPON_TYPES, { message: 'weaponType must be one of: pistol, rifle, shotgun, smg' })
  weaponType?: WeaponType;
}
