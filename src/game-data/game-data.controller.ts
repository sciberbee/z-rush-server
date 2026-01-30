import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { GameDataService } from './game-data.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SaveProgressDto } from './dto/game-progress.dto';
import { UpdateSettingsDto } from './dto/settings.dto';

interface AuthRequest {
  user: User;
}

@Controller('game-data')
@UseGuards(JwtAuthGuard)
export class GameDataController {
  constructor(private gameDataService: GameDataService) {}

  @Get('progress')
  async getProgress(@Req() req: AuthRequest) {
    return this.gameDataService.getProgress(req.user.id);
  }

  @Post('progress')
  async saveProgress(@Req() req: AuthRequest, @Body() dto: SaveProgressDto) {
    return this.gameDataService.saveProgress(req.user.id, dto);
  }

  @Get('settings')
  async getSettings(@Req() req: AuthRequest) {
    return this.gameDataService.getSettings(req.user.id);
  }

  @Put('settings')
  async updateSettings(
    @Req() req: AuthRequest,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.gameDataService.updateSettings(req.user.id, dto);
  }
}
