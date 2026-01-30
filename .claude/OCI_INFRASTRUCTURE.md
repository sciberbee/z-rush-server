# Z-Rush Server OCI Infrastructure Setup

## Overview

This document describes the Oracle Cloud Infrastructure (OCI) setup for deploying the Z-Rush backend server with PostgreSQL database.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         OCI VCN                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   Public Subnet                          │    │
│  │  ┌─────────────────────────────────────────────────┐    │    │
│  │  │           Compute Instance (VM)                  │    │    │
│  │  │  ┌─────────────────┐  ┌─────────────────────┐   │    │    │
│  │  │  │   Docker        │  │   Docker            │   │    │    │
│  │  │  │   z-rush-api    │  │   PostgreSQL        │   │    │    │
│  │  │  │   :3000         │  │   :5432             │   │    │    │
│  │  │  └────────┬────────┘  └──────────┬──────────┘   │    │    │
│  │  │           │                      │              │    │    │
│  │  │           └──────────────────────┘              │    │    │
│  │  │                    (internal)                   │    │    │
│  │  └─────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                         Security List                            │
│                    (Ingress: 443, 80, 22)                       │
└─────────────────────────────────────────────────────────────────┘
                               │
                          Internet
                               │
                    ┌──────────┴──────────┐
                    │   Cloudflare CDN    │
                    │   (Frontend SPA)    │
                    └─────────────────────┘
```

---

## 1. OCI Account Setup

### 1.1 Create OCI Account
1. Go to https://www.oracle.com/cloud/free/
2. Sign up for Free Tier (includes Always Free resources)
3. Complete identity verification

### 1.2 Generate API Keys
```bash
# Generate RSA key pair for OCI API
mkdir -p ~/.oci
openssl genrsa -out ~/.oci/oci_api_key.pem 2048
chmod 600 ~/.oci/oci_api_key.pem
openssl rsa -pubout -in ~/.oci/oci_api_key.pem -out ~/.oci/oci_api_key_public.pem

# Get the fingerprint
openssl rsa -pubout -outform DER -in ~/.oci/oci_api_key.pem | openssl md5 -c
```

### 1.3 Upload Public Key to OCI Console
1. Go to Identity > Users > Your User
2. Click "API Keys" > "Add API Key"
3. Upload `~/.oci/oci_api_key_public.pem`
4. Save the configuration file snippet

---

## 2. Network Setup (VCN)

### 2.1 Create Virtual Cloud Network

**OCI Console Path:** Networking > Virtual Cloud Networks > Create VCN

| Setting | Value |
|---------|-------|
| Name | `z-rush-vcn` |
| CIDR Block | `10.0.0.0/16` |
| DNS Label | `zrush` |

### 2.2 Create Internet Gateway

**Path:** VCN > Internet Gateways > Create

| Setting | Value |
|---------|-------|
| Name | `z-rush-igw` |

### 2.3 Create Route Table

**Path:** VCN > Route Tables > Default Route Table

Add Route Rule:
| Destination | Target Type | Target |
|-------------|-------------|--------|
| `0.0.0.0/0` | Internet Gateway | `z-rush-igw` |

### 2.4 Create Public Subnet

**Path:** VCN > Subnets > Create Subnet

| Setting | Value |
|---------|-------|
| Name | `z-rush-public-subnet` |
| CIDR Block | `10.0.1.0/24` |
| Route Table | Default Route Table |
| Subnet Access | Public |

### 2.5 Security List Rules

**Path:** VCN > Security Lists > Default Security List

#### Ingress Rules:
| Source | Protocol | Dest Port | Description |
|--------|----------|-----------|-------------|
| `0.0.0.0/0` | TCP | 22 | SSH |
| `0.0.0.0/0` | TCP | 80 | HTTP |
| `0.0.0.0/0` | TCP | 443 | HTTPS |
| `0.0.0.0/0` | TCP | 3000 | API (dev only) |

#### Egress Rules:
| Destination | Protocol | Description |
|-------------|----------|-------------|
| `0.0.0.0/0` | All | Allow all outbound |

---

## 3. Compute Instance Setup

### 3.1 Create Compute Instance

**Path:** Compute > Instances > Create Instance

| Setting | Value |
|---------|-------|
| Name | `z-rush-server` |
| Image | Oracle Linux 8 or Ubuntu 22.04 |
| Shape | VM.Standard.A1.Flex (ARM) - Always Free |
| OCPU | 2 (Free Tier: up to 4) |
| Memory | 12 GB (Free Tier: up to 24 GB) |
| VCN | `z-rush-vcn` |
| Subnet | `z-rush-public-subnet` |
| Public IP | Assign |

### 3.2 SSH Key Setup
```bash
# Generate SSH key if not exists
ssh-keygen -t ed25519 -f ~/.ssh/oci_z_rush -C "z-rush-server"

# Upload public key during instance creation
cat ~/.ssh/oci_z_rush.pub
```

### 3.3 Connect to Instance
```bash
ssh -i ~/.ssh/oci_z_rush opc@<PUBLIC_IP>
# or for Ubuntu:
ssh -i ~/.ssh/oci_z_rush ubuntu@<PUBLIC_IP>
```

---

## 4. Server Configuration

### 4.1 Install Docker

```bash
# Oracle Linux 8
sudo dnf config-manager --add-repo=https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER

# Ubuntu 22.04
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Log out and back in for group changes
exit
```

### 4.2 Install Additional Tools

```bash
# Git
sudo dnf install -y git  # Oracle Linux
# or
sudo apt install -y git  # Ubuntu

# Node.js (optional, for local development)
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 20
```

### 4.3 Configure Firewall

```bash
# Oracle Linux (firewalld)
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload

# Ubuntu (ufw)
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3000/tcp
sudo ufw enable
```

---

## 5. Database Setup (PostgreSQL)

### 5.1 Docker Compose for PostgreSQL

Create `/opt/z-rush/docker-compose.db.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: z-rush-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-zrush}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB:-zrush}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-zrush}"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
    driver: local
```

### 5.2 Database Initialization Script

Create `/opt/z-rush/init.sql`:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create database if not exists (handled by POSTGRES_DB env var)
-- Additional initialization can go here
```

### 5.3 Start Database

```bash
cd /opt/z-rush

# Create .env file for database
cat > .env.db << EOF
POSTGRES_USER=zrush
POSTGRES_PASSWORD=$(openssl rand -base64 32)
POSTGRES_DB=zrush
EOF

# Start PostgreSQL
docker compose -f docker-compose.db.yml --env-file .env.db up -d

# Verify
docker logs z-rush-db
```

---

## 6. Application Deployment

### 6.1 Dockerfile

Create `Dockerfile` in z-rush-server root:

```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

# Set environment
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Run migrations and start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
```

### 6.2 Docker Compose for Full Stack

Create `/opt/z-rush/docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: z-rush-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - z-rush-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build:
      context: ./z-rush-server
      dockerfile: Dockerfile
    container_name: z-rush-api
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      JWT_SECRET: ${JWT_SECRET}
      JWT_ACCESS_EXPIRATION: ${JWT_ACCESS_EXPIRATION:-15m}
      JWT_REFRESH_EXPIRATION: ${JWT_REFRESH_EXPIRATION:-7d}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      GOOGLE_CALLBACK_URL: ${GOOGLE_CALLBACK_URL}
      FRONTEND_URL: ${FRONTEND_URL}
      PORT: 3000
    ports:
      - "3000:3000"
    networks:
      - z-rush-network
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Optional: Nginx reverse proxy for SSL
  nginx:
    image: nginx:alpine
    container_name: z-rush-nginx
    restart: unless-stopped
    depends_on:
      - api
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
      - ./certbot/www:/var/www/certbot:ro
    networks:
      - z-rush-network

networks:
  z-rush-network:
    driver: bridge

volumes:
  postgres_data:
```

### 6.3 Nginx Configuration

Create `/opt/z-rush/nginx.conf`:

```nginx
events {
    worker_connections 1024;
}

http {
    upstream api {
        server api:3000;
    }

    # Redirect HTTP to HTTPS
    server {
        listen 80;
        server_name api.z-rush.com;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 301 https://$host$request_uri;
        }
    }

    # HTTPS server
    server {
        listen 443 ssl http2;
        server_name api.z-rush.com;

        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
        ssl_prefer_server_ciphers off;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;

        location / {
            proxy_pass http://api;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
    }
}
```

### 6.4 Environment Variables

Create `/opt/z-rush/.env`:

```bash
# Database
POSTGRES_USER=zrush
POSTGRES_PASSWORD=<generate-strong-password>
POSTGRES_DB=zrush

# JWT
JWT_SECRET=<generate-strong-secret>
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# Google OAuth
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
GOOGLE_CALLBACK_URL=https://api.z-rush.com/auth/google/callback

# Frontend
FRONTEND_URL=https://z-rush.com
```

Generate secure values:
```bash
# Generate JWT secret
openssl rand -base64 64

# Generate database password
openssl rand -base64 32
```

---

## 7. SSL Certificate Setup (Let's Encrypt)

### 7.1 Install Certbot

```bash
# Using Docker
docker run -it --rm \
  -v /opt/z-rush/certbot/conf:/etc/letsencrypt \
  -v /opt/z-rush/certbot/www:/var/www/certbot \
  certbot/certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  -d api.z-rush.com \
  --email your-email@example.com \
  --agree-tos \
  --no-eff-email
```

### 7.2 Certificate Renewal Cron

```bash
# Add to crontab
crontab -e

# Add this line (renew twice daily)
0 0,12 * * * docker run --rm -v /opt/z-rush/certbot/conf:/etc/letsencrypt -v /opt/z-rush/certbot/www:/var/www/certbot certbot/certbot renew --quiet && docker exec z-rush-nginx nginx -s reload
```

---

## 8. Deployment Commands

### 8.1 Initial Deployment

```bash
# Clone repository
cd /opt
sudo mkdir z-rush && sudo chown $USER:$USER z-rush
cd z-rush
git clone <your-repo-url> z-rush-server

# Create environment file
cp .env.example .env
# Edit .env with your values
nano .env

# Build and start
docker compose build
docker compose up -d

# Check logs
docker compose logs -f api
```

### 8.2 Update Deployment

```bash
cd /opt/z-rush

# Pull latest changes
cd z-rush-server && git pull && cd ..

# Rebuild and restart
docker compose build api
docker compose up -d api

# Run migrations if needed
docker compose exec api npx prisma migrate deploy
```

### 8.3 Database Backup

```bash
# Create backup
docker exec z-rush-db pg_dump -U zrush zrush > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore backup
cat backup.sql | docker exec -i z-rush-db psql -U zrush zrush
```

### 8.4 Useful Commands

```bash
# View logs
docker compose logs -f

# Restart services
docker compose restart

# Stop all
docker compose down

# Clean up (WARNING: removes volumes too)
docker compose down -v

# Access database CLI
docker exec -it z-rush-db psql -U zrush zrush

# Access API container shell
docker exec -it z-rush-api sh
```

---

## 9. Monitoring & Maintenance

### 9.1 Health Check Endpoint

Add to `src/app.controller.ts`:

```typescript
@Get('health')
health() {
  return { status: 'ok', timestamp: new Date().toISOString() };
}
```

### 9.2 Log Management

```bash
# Configure Docker logging (in docker-compose.yml)
services:
  api:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 9.3 Resource Monitoring

```bash
# Watch container resources
docker stats

# Check disk usage
df -h
docker system df
```

---

## 10. Google OAuth Configuration

### 10.1 Create Google Cloud Project

1. Go to https://console.cloud.google.com/
2. Create new project: "Z-Rush Game"
3. Enable Google+ API

### 10.2 Create OAuth Credentials

**Path:** APIs & Services > Credentials > Create Credentials > OAuth client ID

| Setting | Value |
|---------|-------|
| Application type | Web application |
| Name | Z-Rush Server |
| Authorized redirect URIs | `https://api.z-rush.com/auth/google/callback` |
| (dev) Authorized redirect URIs | `http://localhost:3000/auth/google/callback` |

### 10.3 Configure Consent Screen

1. Go to OAuth consent screen
2. Select "External" user type
3. Fill in required fields:
   - App name: Z-Rush
   - User support email: your-email
   - Developer contact: your-email
4. Add scopes: `email`, `profile`

---

## 11. Cost Estimation (OCI Free Tier)

| Resource | Free Tier Limit | Our Usage |
|----------|-----------------|-----------|
| Compute (ARM) | 4 OCPU, 24 GB RAM | 2 OCPU, 12 GB |
| Block Volume | 200 GB total | ~50 GB |
| Outbound Data | 10 TB/month | Varies |
| Object Storage | 20 GB | 0 (not used) |
| Load Balancer | 1 (always free) | Optional |

**Estimated Monthly Cost: $0** (within Free Tier)

---

## 12. Troubleshooting

### Common Issues

**1. Cannot connect to database**
```bash
# Check if PostgreSQL is running
docker ps | grep postgres
docker logs z-rush-db

# Test connection
docker exec -it z-rush-db psql -U zrush -d zrush -c "SELECT 1"
```

**2. API not starting**
```bash
# Check logs
docker logs z-rush-api

# Common issues:
# - Missing environment variables
# - Database connection failed
# - Port already in use
```

**3. OAuth redirect issues**
- Verify GOOGLE_CALLBACK_URL matches Google Console
- Verify FRONTEND_URL is correct
- Check browser console for CORS errors

**4. SSL certificate issues**
```bash
# Check certificate validity
openssl s_client -connect api.z-rush.com:443 -servername api.z-rush.com

# Force renewal
docker run --rm -v /opt/z-rush/certbot/conf:/etc/letsencrypt certbot/certbot renew --force-renewal
```

---

## Appendix: Quick Start Script

```bash
#!/bin/bash
# deploy.sh - Quick deployment script

set -e

cd /opt/z-rush

# Pull latest code
if [ -d "z-rush-server" ]; then
    cd z-rush-server && git pull && cd ..
else
    git clone <your-repo-url> z-rush-server
fi

# Check for .env file
if [ ! -f ".env" ]; then
    echo "ERROR: .env file not found. Please create it first."
    exit 1
fi

# Build and deploy
docker compose build
docker compose up -d

# Wait for services
echo "Waiting for services to start..."
sleep 10

# Run migrations
docker compose exec -T api npx prisma migrate deploy

# Health check
curl -f http://localhost:3000/health || echo "Health check failed"

echo "Deployment complete!"
docker compose ps
```
