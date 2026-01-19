import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';

interface GoogleUser {
  googleId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}

function parseExpiration(value: string | undefined, defaultSeconds: number): number {
  if (!value) return defaultSeconds;
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) return defaultSeconds;
  const num = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return num;
    case 'm': return num * 60;
    case 'h': return num * 60 * 60;
    case 'd': return num * 60 * 60 * 24;
    default: return defaultSeconds;
  }
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async validateGoogleUser(googleUser: GoogleUser): Promise<User> {
    let user = await this.prisma.user.findUnique({
      where: { googleId: googleUser.googleId },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          googleId: googleUser.googleId,
          email: googleUser.email,
          displayName: googleUser.displayName,
          avatarUrl: googleUser.avatarUrl,
          profile: {
            create: {
              playerName: googleUser.displayName,
            },
          },
          settings: {
            create: {},
          },
        },
      });
    } else {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          email: googleUser.email,
          displayName: googleUser.displayName,
          avatarUrl: googleUser.avatarUrl,
        },
      });
    }

    return user;
  }

  async generateTokens(user: User) {
    const payload = { sub: user.id, email: user.email };

    const accessExpiration = parseExpiration(
      this.configService.get<string>('JWT_ACCESS_EXPIRATION'),
      15 * 60, // 15 minutes default
    );

    const refreshExpiration = parseExpiration(
      this.configService.get<string>('JWT_REFRESH_EXPIRATION'),
      7 * 24 * 60 * 60, // 7 days default
    );

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: accessExpiration,
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: refreshExpiration,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  async refreshTokens(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new Error('User not found');
      }

      return this.generateTokens(user);
    } catch {
      throw new Error('Invalid refresh token');
    }
  }
}
