import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitScoreDto } from './dto/submit-score.dto';

@Injectable()
export class LeaderboardService {
  constructor(private prisma: PrismaService) {}

  async getLeaderboard(levelIndex: number, limit = 100) {
    const scores = await this.prisma.score.findMany({
      where: { levelIndex },
      orderBy: { score: 'desc' },
      take: limit,
      include: {
        user: {
          select: {
            displayName: true,
            avatarUrl: true,
            profile: {
              select: {
                playerName: true,
                playerColor: true,
              },
            },
          },
        },
      },
    });

    return scores.map((score, index) => ({
      rank: index + 1,
      score: score.score,
      soldierCount: score.soldierCount,
      createdAt: score.createdAt,
      player: {
        displayName: score.user.profile?.playerName || score.user.displayName,
        playerColor: score.user.profile?.playerColor || '#4a90d9',
        avatarUrl: score.user.avatarUrl,
      },
    }));
  }

  async submitScore(userId: string, dto: SubmitScoreDto) {
    const score = await this.prisma.score.create({
      data: {
        userId,
        levelIndex: dto.levelIndex,
        score: dto.score,
        soldierCount: dto.soldierCount,
      },
    });

    // Get the user's rank for this level
    const betterScores = await this.prisma.score.count({
      where: {
        levelIndex: dto.levelIndex,
        score: { gt: dto.score },
      },
    });

    return {
      id: score.id,
      rank: betterScores + 1,
      score: score.score,
    };
  }

  async getUserBestScores(userId: string) {
    const scores = await this.prisma.score.groupBy({
      by: ['levelIndex'],
      where: { userId },
      _max: { score: true },
    });

    return scores.map((s) => ({
      levelIndex: s.levelIndex,
      bestScore: s._max.score,
    }));
  }
}
