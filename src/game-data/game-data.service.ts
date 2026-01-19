import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SaveProgressDto } from './dto/game-progress.dto';
import { UpdateSettingsDto } from './dto/settings.dto';

@Injectable()
export class GameDataService {
  constructor(private prisma: PrismaService) {}

  async getProgress(userId: string) {
    const progress = await this.prisma.gameProgress.findMany({
      where: { userId },
      orderBy: { levelIndex: 'asc' },
    });
    return progress;
  }

  async saveProgress(userId: string, dto: SaveProgressDto) {
    const existing = await this.prisma.gameProgress.findUnique({
      where: {
        userId_levelIndex: {
          userId,
          levelIndex: dto.levelIndex,
        },
      },
    });

    if (existing) {
      return this.prisma.gameProgress.update({
        where: { id: existing.id },
        data: {
          completed: dto.completed ?? existing.completed,
          highestWave: dto.highestWave !== undefined
            ? Math.max(dto.highestWave, existing.highestWave)
            : existing.highestWave,
          stars: dto.stars !== undefined
            ? Math.max(dto.stars, existing.stars)
            : existing.stars,
        },
      });
    }

    return this.prisma.gameProgress.create({
      data: {
        userId,
        levelIndex: dto.levelIndex,
        completed: dto.completed ?? false,
        highestWave: dto.highestWave ?? 0,
        stars: dto.stars ?? 0,
      },
    });
  }

  async getSettings(userId: string) {
    let settings = await this.prisma.settings.findUnique({
      where: { userId },
    });

    if (!settings) {
      settings = await this.prisma.settings.create({
        data: { userId },
      });
    }

    return settings;
  }

  async updateSettings(userId: string, dto: UpdateSettingsDto) {
    const existing = await this.prisma.settings.findUnique({
      where: { userId },
    });

    if (!existing) {
      return this.prisma.settings.create({
        data: {
          userId,
          ...dto,
        },
      });
    }

    return this.prisma.settings.update({
      where: { userId },
      data: dto,
    });
  }
}
