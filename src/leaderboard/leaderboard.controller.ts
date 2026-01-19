import { Controller, Get, Post, Body, Param, UseGuards, Req, ParseIntPipe } from '@nestjs/common';
import { User } from '@prisma/client';
import { LeaderboardService } from './leaderboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubmitScoreDto } from './dto/submit-score.dto';

interface AuthRequest {
  user: User;
}

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private leaderboardService: LeaderboardService) {}

  @Get(':levelIndex')
  async getLeaderboard(@Param('levelIndex', ParseIntPipe) levelIndex: number) {
    return this.leaderboardService.getLeaderboard(levelIndex);
  }

  @Post('submit')
  @UseGuards(JwtAuthGuard)
  async submitScore(@Req() req: AuthRequest, @Body() dto: SubmitScoreDto) {
    return this.leaderboardService.submitScore(req.user.id, dto);
  }

  @Get('user/best')
  @UseGuards(JwtAuthGuard)
  async getUserBestScores(@Req() req: AuthRequest) {
    return this.leaderboardService.getUserBestScores(req.user.id);
  }
}
