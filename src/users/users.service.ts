import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      profile: user.profile,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.profile) {
      const profile = await this.prisma.profile.create({
        data: {
          userId,
          playerName: dto.playerName || user.displayName,
          playerColor: dto.playerColor || '#4a90d9',
          weaponType: dto.weaponType || 'pistol',
        },
      });
      return profile;
    }

    const profile = await this.prisma.profile.update({
      where: { userId },
      data: {
        ...(dto.playerName && { playerName: dto.playerName }),
        ...(dto.playerColor && { playerColor: dto.playerColor }),
        ...(dto.weaponType && { weaponType: dto.weaponType }),
      },
    });

    return profile;
  }
}
