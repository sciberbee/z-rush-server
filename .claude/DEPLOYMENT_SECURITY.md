# Z-Rush 배포, 연동 및 보안 가이드

## 목차
1. [시스템 아키텍처](#1-시스템-아키텍처)
2. [백엔드 배포](#2-백엔드-배포)
3. [프론트엔드 연동](#3-프론트엔드-연동)
4. [Google OAuth 로그인 플로우](#4-google-oauth-로그인-플로우)
5. [HTTPS 설정](#5-https-설정)
6. [보안 설정](#6-보안-설정)
7. [유저 정보 관리](#7-유저-정보-관리)

---

## 1. 시스템 아키텍처

### 1.1 전체 시스템 구성

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              사용자 브라우저                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Cloudflare CDN                                 │
│                    (프론트엔드 정적 파일 호스팅)                           │
│                         https://z-rush.com                               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                         API 요청 (fetch)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        OCI Compute Instance                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Nginx (Reverse Proxy)                         │   │
│  │                 - SSL Termination (Let's Encrypt)                │   │
│  │                 - Rate Limiting                                  │   │
│  │                 - Security Headers                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    NestJS Backend API                            │   │
│  │                 https://api.z-rush.com                           │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │   │
│  │  │   Auth   │  │  Users   │  │ GameData │  │ Leaderboard  │    │   │
│  │  │ Module   │  │  Module  │  │  Module  │  │    Module    │    │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      PostgreSQL Database                         │   │
│  │                    (Docker Container)                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                          OAuth 인증 요청
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Google OAuth Server                              │
│                    (accounts.google.com)                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 데이터 흐름

```
1. 게임 시작
   Browser → Cloudflare → 정적 파일 로드 (index.html, JS, CSS)

2. 로그인 요청
   Browser → api.z-rush.com/auth/google → Google OAuth → Callback → JWT 발급

3. API 요청 (인증 필요)
   Browser → Authorization: Bearer {JWT} → API → Database → Response

4. 점수 제출
   Browser → POST /leaderboard/submit → Validate JWT → Save to DB → Return rank
```

---

## 2. 백엔드 배포

### 2.1 사전 요구사항

- OCI Compute Instance (설정 완료)
- Docker & Docker Compose 설치
- 도메인 (api.z-rush.com) DNS 설정
- Google OAuth 자격 증명

### 2.2 배포 단계

#### Step 1: 서버 접속 및 코드 배포

```bash
# SSH 접속
ssh -i ~/.ssh/oci_z_rush opc@<SERVER_IP>

# 디렉토리 생성
sudo mkdir -p /opt/z-rush && sudo chown $USER:$USER /opt/z-rush
cd /opt/z-rush

# 코드 클론
git clone https://github.com/your-repo/z-rush-server.git
```

#### Step 2: 환경 변수 설정

```bash
cat > .env << 'EOF'
# Database
POSTGRES_USER=zrush
POSTGRES_PASSWORD=<STRONG_PASSWORD_HERE>
POSTGRES_DB=zrush

# JWT Configuration
JWT_SECRET=<GENERATE_WITH: openssl rand -base64 64>
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_CALLBACK_URL=https://api.z-rush.com/auth/google/callback

# Frontend URL (for CORS and OAuth redirect)
FRONTEND_URL=https://z-rush.com

# Server
PORT=3000
NODE_ENV=production
EOF

chmod 600 .env
```

#### Step 3: Docker Compose 실행

```bash
# 빌드 및 실행
docker compose up -d --build

# 마이그레이션 실행
docker compose exec api npx prisma migrate deploy

# 로그 확인
docker compose logs -f api
```

#### Step 4: Nginx SSL 설정

```bash
# Certbot으로 인증서 발급
docker run -it --rm \
  -v /opt/z-rush/certbot/conf:/etc/letsencrypt \
  -v /opt/z-rush/certbot/www:/var/www/certbot \
  certbot/certbot certonly \
  --webroot -w /var/www/certbot \
  -d api.z-rush.com \
  --email your@email.com \
  --agree-tos

# Nginx 재시작
docker compose restart nginx
```

### 2.3 배포 확인

```bash
# Health check
curl https://api.z-rush.com/health

# Expected response:
# {"status":"ok","timestamp":"2024-01-15T10:30:00.000Z"}
```

### 2.4 업데이트 배포

```bash
cd /opt/z-rush/z-rush-server

# 코드 업데이트
git pull origin main

# 재빌드 및 배포
cd .. && docker compose up -d --build api

# 마이그레이션 (스키마 변경 시)
docker compose exec api npx prisma migrate deploy
```

---

## 3. 프론트엔드 연동

### 3.1 환경 변수 설정

프론트엔드 `.env` 파일:

```bash
# Development
VITE_API_URL=http://localhost:3000

# Production (.env.production)
VITE_API_URL=https://api.z-rush.com
```

### 3.2 API 클라이언트 구조

```typescript
// src/services/ApiClient.ts
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

class ApiClient {
  private accessToken: string | null = null;

  // JWT 토큰을 Authorization 헤더에 포함
  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      if (response.status === 401) {
        // 토큰 만료 시 갱신 시도
        await authService.tryRefreshToken();
      }
      throw new Error(`API Error: ${response.status}`);
    }

    return response.json();
  }
}
```

### 3.3 CORS 설정

백엔드 `main.ts`:

```typescript
app.enableCors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:5173',  // Vite dev server
    'http://localhost:4173',  // Vite preview
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
```

### 3.4 API 엔드포인트 매핑

| 프론트엔드 함수 | HTTP Method | 백엔드 엔드포인트 | 인증 |
|---------------|-------------|-----------------|------|
| `authService.getLoginUrl()` | GET | `/auth/google` | - |
| `apiClient.refreshToken()` | POST | `/auth/refresh` | - |
| `apiClient.getProfile()` | GET | `/users/profile` | JWT |
| `apiClient.updateProfile()` | PUT | `/users/profile` | JWT |
| `apiClient.getProgress()` | GET | `/game-data/progress` | JWT |
| `apiClient.saveProgress()` | POST | `/game-data/progress` | JWT |
| `apiClient.getSettings()` | GET | `/game-data/settings` | JWT |
| `apiClient.updateSettings()` | PUT | `/game-data/settings` | JWT |
| `apiClient.getLeaderboard()` | GET | `/leaderboard/:level` | - |
| `apiClient.submitScore()` | POST | `/leaderboard/submit` | JWT |

---

## 4. Google OAuth 로그인 플로우

### 4.1 전체 플로우 다이어그램

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Browser │     │ Frontend │     │ Backend  │     │  Google  │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │                │
     │ 1. 로그인 클릭  │                │                │
     │───────────────>│                │                │
     │                │                │                │
     │ 2. Redirect to /auth/google     │                │
     │────────────────────────────────>│                │
     │                │                │                │
     │                │ 3. Redirect to Google OAuth     │
     │<───────────────────────────────────────────────>│
     │                │                │                │
     │ 4. Google 로그인 페이지          │                │
     │<───────────────────────────────────────────────>│
     │                │                │                │
     │ 5. 사용자 인증 후 Callback       │                │
     │───────────────────────────────────────────────>│
     │                │                │                │
     │                │                │ 6. User info   │
     │                │                │<───────────────│
     │                │                │                │
     │                │ 7. Create/Update User          │
     │                │                │ (Database)     │
     │                │                │                │
     │                │ 8. Generate JWT tokens         │
     │                │                │                │
     │ 9. Redirect to Frontend with tokens             │
     │<────────────────────────────────│                │
     │                │                │                │
     │ 10. Parse tokens, store in localStorage         │
     │───────────────>│                │                │
     │                │                │                │
     │ 11. 로그인 완료 │                │                │
     │<───────────────│                │                │
     │                │                │                │
```

### 4.2 상세 단계 설명

#### Step 1-2: 로그인 시작
```typescript
// Frontend: MainMenu.ts
this.authButton.addEventListener('click', () => {
  // API 서버의 Google OAuth 엔드포인트로 리다이렉트
  window.location.href = authService.getLoginUrl();
  // → https://api.z-rush.com/auth/google
});
```

#### Step 3-5: Google OAuth 처리
```typescript
// Backend: auth.controller.ts
@Get('google')
@UseGuards(GoogleAuthGuard)
async googleAuth() {
  // Passport가 Google OAuth 페이지로 리다이렉트
}

@Get('google/callback')
@UseGuards(GoogleAuthGuard)
async googleAuthCallback(@Req() req, @Res() res) {
  // Google에서 사용자 정보를 받음
  const user = await this.authService.validateGoogleUser(req.user);
  const tokens = await this.authService.generateTokens(user);

  // 프론트엔드로 토큰과 함께 리다이렉트
  const params = new URLSearchParams({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user: JSON.stringify(tokens.user),
  });

  res.redirect(`${FRONTEND_URL}/auth/callback?${params}`);
}
```

#### Step 6-8: 사용자 생성/업데이트 및 JWT 발급
```typescript
// Backend: auth.service.ts
async validateGoogleUser(googleUser: GoogleUser): Promise<User> {
  let user = await this.prisma.user.findUnique({
    where: { googleId: googleUser.googleId },
  });

  if (!user) {
    // 신규 사용자: User + Profile + Settings 생성
    user = await this.prisma.user.create({
      data: {
        googleId: googleUser.googleId,
        email: googleUser.email,
        displayName: googleUser.displayName,
        avatarUrl: googleUser.avatarUrl,
        profile: {
          create: {
            playerName: googleUser.displayName,
            playerColor: '#4a90d9',
          },
        },
        settings: {
          create: {},  // 기본값 사용
        },
      },
    });
  }

  return user;
}

async generateTokens(user: User): Promise<AuthResponse> {
  const payload = { sub: user.id, email: user.email };

  return {
    accessToken: this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: this.configService.get('JWT_ACCESS_EXPIRATION'),
    }),
    refreshToken: this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRATION'),
    }),
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    },
  };
}
```

#### Step 9-11: 프론트엔드 토큰 처리
```typescript
// Frontend: main.ts
function handleOAuthCallback(): boolean {
  const params = new URLSearchParams(window.location.search);

  if (params.has('accessToken')) {
    const success = authService.handleOAuthCallback(params);
    // URL에서 토큰 파라미터 제거 (보안)
    window.history.replaceState({}, '', '/');
    return success;
  }
  return false;
}

// Frontend: AuthService.ts
handleOAuthCallback(params: URLSearchParams): boolean {
  const accessToken = params.get('accessToken');
  const refreshToken = params.get('refreshToken');
  const userJson = params.get('user');

  if (accessToken && refreshToken && userJson) {
    // localStorage에 저장
    localStorage.setItem('zrush_access_token', accessToken);
    localStorage.setItem('zrush_refresh_token', refreshToken);
    localStorage.setItem('zrush_user', userJson);

    // API 클라이언트에 토큰 설정
    apiClient.setToken(accessToken);

    return true;
  }
  return false;
}
```

### 4.3 토큰 갱신 플로우

```typescript
// Frontend: AuthService.ts
async tryRefreshToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem('zrush_refresh_token');
  if (!refreshToken) return false;

  try {
    // 새 토큰 요청
    const response = await apiClient.refreshToken(refreshToken);

    // 새 토큰 저장
    localStorage.setItem('zrush_access_token', response.accessToken);
    localStorage.setItem('zrush_refresh_token', response.refreshToken);
    apiClient.setToken(response.accessToken);

    return true;
  } catch {
    // 갱신 실패 시 로그아웃
    this.logout();
    return false;
  }
}
```

### 4.4 JWT 토큰 구조

```
Header: { "alg": "HS256", "typ": "JWT" }
Payload: {
  "sub": "user-uuid-here",      // 사용자 ID
  "email": "user@gmail.com",    // 이메일
  "iat": 1705312200,            // 발급 시간
  "exp": 1705313100             // 만료 시간 (15분 후)
}
Signature: HMACSHA256(base64UrlEncode(header) + "." + base64UrlEncode(payload), secret)
```

---

## 5. HTTPS 설정

### 5.1 인증서 발급 (Let's Encrypt)

```bash
# Certbot Docker 이미지로 인증서 발급
docker run -it --rm \
  -v /opt/z-rush/certbot/conf:/etc/letsencrypt \
  -v /opt/z-rush/certbot/www:/var/www/certbot \
  certbot/certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  -d api.z-rush.com \
  --email admin@z-rush.com \
  --agree-tos \
  --no-eff-email
```

### 5.2 Nginx SSL 설정

```nginx
# /opt/z-rush/nginx.conf
server {
    listen 443 ssl http2;
    server_name api.z-rush.com;

    # SSL 인증서
    ssl_certificate /etc/letsencrypt/live/api.z-rush.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.z-rush.com/privkey.pem;

    # SSL 프로토콜 및 암호화
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # SSL 세션 캐싱
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 8.8.4.4 valid=300s;

    # API 프록시
    location / {
        proxy_pass http://api:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 5.3 인증서 자동 갱신

```bash
# Crontab 설정
crontab -e

# 매일 새벽 3시에 갱신 시도
0 3 * * * docker run --rm -v /opt/z-rush/certbot/conf:/etc/letsencrypt certbot/certbot renew --quiet && docker exec z-rush-nginx nginx -s reload
```

### 5.4 보안 헤더

```nginx
# Nginx 보안 헤더
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

---

## 6. 보안 설정

### 6.1 환경 변수 보안

```bash
# .env 파일 권한 설정
chmod 600 /opt/z-rush/.env

# 민감 정보 암호화 저장 (선택)
# OCI Vault 또는 HashiCorp Vault 사용 권장
```

### 6.2 Rate Limiting

```nginx
# Nginx rate limiting
http {
    # IP당 요청 제한
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=2r/s;

    server {
        # 일반 API
        location / {
            limit_req zone=api_limit burst=20 nodelay;
            proxy_pass http://api:3000;
        }

        # 인증 API (더 엄격하게)
        location /auth {
            limit_req zone=auth_limit burst=5 nodelay;
            proxy_pass http://api:3000;
        }
    }
}
```

### 6.3 NestJS 보안 설정

```typescript
// main.ts
import helmet from 'helmet';
import * as compression from 'compression';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 보안 헤더
  app.use(helmet());

  // 응답 압축
  app.use(compression());

  // 요청 크기 제한
  app.use(express.json({ limit: '1mb' }));

  // CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  });

  // 전역 유효성 검사
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,        // 알 수 없는 속성 제거
      forbidNonWhitelisted: true,  // 알 수 없는 속성 시 에러
      transform: true,        // 타입 변환
    }),
  );

  await app.listen(3000);
}
```

### 6.4 입력 검증 (DTO)

```typescript
// dto/update-profile.dto.ts
import { IsString, IsOptional, Matches, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  playerName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'playerColor must be a valid hex color (e.g., #FF5533)',
  })
  playerColor?: string;
}
```

### 6.5 SQL Injection 방지

Prisma ORM을 사용하면 자동으로 SQL Injection이 방지됩니다:

```typescript
// Prisma는 매개변수화된 쿼리를 사용
const user = await this.prisma.user.findUnique({
  where: { id: userId },  // userId가 자동으로 이스케이프됨
});

// 절대 하지 말 것: Raw SQL with string concatenation
// const user = await this.prisma.$queryRaw`SELECT * FROM users WHERE id = '${userId}'`;
```

### 6.6 JWT 보안

```typescript
// JWT 토큰 검증
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService, configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,  // 만료된 토큰 거부
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    return user;
  }
}
```

### 6.7 데이터베이스 보안

```bash
# PostgreSQL 접근 제한
# docker-compose.yml에서 포트를 localhost로만 바인딩
ports:
  - "127.0.0.1:5432:5432"  # 외부 접근 불가

# 강력한 비밀번호 사용
POSTGRES_PASSWORD=$(openssl rand -base64 32)
```

---

## 7. 유저 정보 관리

### 7.1 데이터베이스 스키마

```prisma
// prisma/schema.prisma
model User {
  id          String   @id @default(uuid())
  googleId    String   @unique    // Google OAuth ID
  email       String   @unique    // 이메일 (고유)
  displayName String              // 표시 이름
  avatarUrl   String?             // 프로필 이미지 URL
  createdAt   DateTime @default(now())

  profile      Profile?           // 1:1 게임 프로필
  gameProgress GameProgress[]     // 1:N 레벨별 진행
  settings     Settings?          // 1:1 설정
  scores       Score[]            // 1:N 점수 기록
}

model Profile {
  id          String @id @default(uuid())
  userId      String @unique
  playerName  String              // 게임 내 닉네임
  playerColor String @default("#4a90d9")  // 캐릭터 색상
  weaponType  String @default("pistol")   // 무기 종류
  user        User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Settings {
  id               String  @id @default(uuid())
  userId           String  @unique
  musicVolume      Float   @default(0.7)
  sfxVolume        Float   @default(1.0)
  vibrationEnabled Boolean @default(true)
  user             User    @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model GameProgress {
  id          String   @id @default(uuid())
  userId      String
  levelIndex  Int
  completed   Boolean  @default(false)
  highestWave Int      @default(0)
  stars       Int      @default(0)
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, levelIndex])  // 유저당 레벨별 하나의 진행 기록
}

model Score {
  id           String   @id @default(uuid())
  userId       String
  levelIndex   Int
  score        Int
  soldierCount Int
  createdAt    DateTime @default(now())
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([levelIndex, score(sort: Desc)])  // 리더보드 쿼리 최적화
}
```

### 7.2 유저 생성 플로우

```typescript
// auth.service.ts
async validateGoogleUser(googleUser: GoogleUserDto): Promise<User> {
  // 기존 유저 확인
  let user = await this.prisma.user.findUnique({
    where: { googleId: googleUser.googleId },
    include: { profile: true, settings: true },
  });

  if (user) {
    // 기존 유저: Google 정보 업데이트
    user = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        email: googleUser.email,
        displayName: googleUser.displayName,
        avatarUrl: googleUser.avatarUrl,
      },
      include: { profile: true, settings: true },
    });
  } else {
    // 신규 유저: User + Profile + Settings 생성
    user = await this.prisma.user.create({
      data: {
        googleId: googleUser.googleId,
        email: googleUser.email,
        displayName: googleUser.displayName,
        avatarUrl: googleUser.avatarUrl,
        profile: {
          create: {
            playerName: googleUser.displayName.slice(0, 20),
            playerColor: '#4a90d9',
            weaponType: 'pistol',
          },
        },
        settings: {
          create: {
            musicVolume: 0.7,
            sfxVolume: 1.0,
            vibrationEnabled: true,
          },
        },
      },
      include: { profile: true, settings: true },
    });
  }

  return user;
}
```

### 7.3 유저 프로필 조회/수정

```typescript
// users.service.ts
async getProfile(userId: string): Promise<UserWithProfile> {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });

  if (!user) {
    throw new NotFoundException('User not found');
  }

  return user;
}

async updateProfile(userId: string, dto: UpdateProfileDto): Promise<Profile> {
  // Profile이 없으면 생성
  const profile = await this.prisma.profile.upsert({
    where: { userId },
    update: {
      ...(dto.playerName && { playerName: dto.playerName }),
      ...(dto.playerColor && { playerColor: dto.playerColor }),
      ...(dto.weaponType && { weaponType: dto.weaponType }),
    },
    create: {
      userId,
      playerName: dto.playerName || 'Player',
      playerColor: dto.playerColor || '#4a90d9',
      weaponType: dto.weaponType || 'pistol',
    },
  });

  return profile;
}
```

### 7.4 유저 데이터 삭제 (GDPR 준수)

```typescript
// users.service.ts
async deleteUser(userId: string): Promise<void> {
  // Cascade delete가 설정되어 있으므로
  // User 삭제 시 관련 데이터 모두 삭제됨
  await this.prisma.user.delete({
    where: { id: userId },
  });
}
```

### 7.5 데이터 백업 및 복구

```bash
# 전체 백업
docker exec z-rush-db pg_dump -U zrush zrush > backup_$(date +%Y%m%d).sql

# 특정 테이블 백업
docker exec z-rush-db pg_dump -U zrush -t users -t profiles zrush > users_backup.sql

# 복구
cat backup.sql | docker exec -i z-rush-db psql -U zrush zrush
```

---

## 부록: 체크리스트

### 배포 전 체크리스트

- [ ] 환경 변수 모두 설정됨 (.env)
- [ ] JWT_SECRET은 강력한 랜덤 값
- [ ] POSTGRES_PASSWORD는 강력한 랜덤 값
- [ ] Google OAuth 자격 증명 설정됨
- [ ] FRONTEND_URL이 실제 도메인으로 설정됨
- [ ] SSL 인증서 발급됨
- [ ] 방화벽 규칙 설정됨 (80, 443만 허용)
- [ ] 데이터베이스 포트는 외부 노출되지 않음

### 보안 체크리스트

- [ ] HTTPS 강제 적용
- [ ] 보안 헤더 설정됨 (HSTS, X-Frame-Options 등)
- [ ] Rate limiting 설정됨
- [ ] 입력 검증 (DTO validation) 적용됨
- [ ] SQL Injection 방지 (Prisma 사용)
- [ ] JWT 토큰 만료 시간 적절함 (15분/7일)
- [ ] 민감 정보 로깅하지 않음
- [ ] 에러 메시지에 상세 정보 노출하지 않음

### 모니터링 체크리스트

- [ ] Health check 엔드포인트 작동
- [ ] 로그 수집 설정됨
- [ ] 디스크 사용량 모니터링
- [ ] 인증서 만료 알림 설정
