import * as pulumi from "@pulumi/pulumi";

interface CloudInitParams {
  dbUser: string;
  dbPassword: pulumi.Output<string>;
  dbName: string;
  jwtSecret: pulumi.Output<string>;
  googleClientId: string;
  googleClientSecret: pulumi.Output<string>;
  domainName: string;
  frontendUrl: string;
}

export function generateCloudInit(params: CloudInitParams): pulumi.Output<string> {
  return pulumi.all([
    params.dbPassword,
    params.jwtSecret,
    params.googleClientSecret,
  ]).apply(([dbPassword, jwtSecret, googleClientSecret]) => `#!/bin/bash
set -e

echo "=== Z-Rush Server Setup Starting ==="

# Update system
dnf update -y

# Install Docker
dnf config-manager --add-repo=https://download.docker.com/linux/centos/docker-ce.repo
dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin git

# Start Docker
systemctl enable docker
systemctl start docker

# Add opc user to docker group
usermod -aG docker opc

# Create application directory
mkdir -p /opt/z-rush
cd /opt/z-rush

# Create environment file
cat > .env << 'ENVEOF'
# Database
POSTGRES_USER=${params.dbUser}
POSTGRES_PASSWORD=${dbPassword}
POSTGRES_DB=${params.dbName}

# JWT
JWT_SECRET=${jwtSecret}
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# Google OAuth
GOOGLE_CLIENT_ID=${params.googleClientId}
GOOGLE_CLIENT_SECRET=${googleClientSecret}
GOOGLE_CALLBACK_URL=https://${params.domainName}/auth/google/callback

# Frontend
FRONTEND_URL=${params.frontendUrl}

# Server
PORT=3000
NODE_ENV=production
ENVEOF

chmod 600 .env

# Create docker-compose.yml
cat > docker-compose.yml << 'COMPOSEEOF'
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: z-rush-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: \${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - z-rush-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    image: ghcr.io/your-org/z-rush-server:latest
    container_name: z-rush-api
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB}
      JWT_SECRET: \${JWT_SECRET}
      JWT_ACCESS_EXPIRATION: \${JWT_ACCESS_EXPIRATION}
      JWT_REFRESH_EXPIRATION: \${JWT_REFRESH_EXPIRATION}
      GOOGLE_CLIENT_ID: \${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: \${GOOGLE_CLIENT_SECRET}
      GOOGLE_CALLBACK_URL: \${GOOGLE_CALLBACK_URL}
      FRONTEND_URL: \${FRONTEND_URL}
      PORT: \${PORT}
      NODE_ENV: \${NODE_ENV}
    ports:
      - "3000:3000"
    networks:
      - z-rush-network
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

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
      - ./certbot/conf:/etc/letsencrypt:ro
      - ./certbot/www:/var/www/certbot:ro
    networks:
      - z-rush-network

networks:
  z-rush-network:
    driver: bridge

volumes:
  postgres_data:
COMPOSEEOF

# Create nginx configuration
cat > nginx.conf << 'NGINXEOF'
events {
    worker_connections 1024;
}

http {
    upstream api {
        server api:3000;
    }

    # Rate limiting
    limit_req_zone \$binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req_zone \$binary_remote_addr zone=auth_limit:10m rate=2r/s;

    # HTTP - redirect to HTTPS and handle ACME challenges
    server {
        listen 80;
        server_name ${params.domainName};

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 301 https://\$host\$request_uri;
        }
    }

    # HTTPS
    server {
        listen 443 ssl http2;
        server_name ${params.domainName};

        ssl_certificate /etc/letsencrypt/live/${params.domainName}/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/${params.domainName}/privkey.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
        ssl_prefer_server_ciphers off;
        ssl_session_cache shared:SSL:10m;

        # Security headers
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;

        # Auth endpoints - stricter rate limit
        location /auth {
            limit_req zone=auth_limit burst=5 nodelay;
            proxy_pass http://api;
            proxy_http_version 1.1;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }

        # API endpoints
        location / {
            limit_req zone=api_limit burst=20 nodelay;
            proxy_pass http://api;
            proxy_http_version 1.1;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }
    }
}
NGINXEOF

# Create certbot directories
mkdir -p certbot/conf certbot/www

# Create SSL setup script
cat > setup-ssl.sh << 'SSLEOF'
#!/bin/bash
# Run this after DNS is configured

DOMAIN="${params.domainName}"
EMAIL="admin@\${DOMAIN}"

# Get certificate
docker run -it --rm \\
  -v /opt/z-rush/certbot/conf:/etc/letsencrypt \\
  -v /opt/z-rush/certbot/www:/var/www/certbot \\
  certbot/certbot certonly \\
  --webroot \\
  --webroot-path=/var/www/certbot \\
  -d \$DOMAIN \\
  --email \$EMAIL \\
  --agree-tos \\
  --no-eff-email

# Restart nginx
docker compose restart nginx
echo "SSL certificate installed successfully!"
SSLEOF
chmod +x setup-ssl.sh

# Create deploy script
cat > deploy.sh << 'DEPLOYEOF'
#!/bin/bash
set -e
cd /opt/z-rush

# Pull latest images
docker compose pull

# Restart services
docker compose up -d

# Run migrations (if using local build)
# docker compose exec -T api npx prisma migrate deploy

echo "Deployment complete!"
docker compose ps
DEPLOYEOF
chmod +x deploy.sh

# Create certbot renewal cron
cat > /etc/cron.d/certbot-renewal << 'CRONEOF'
0 3 * * * root docker run --rm -v /opt/z-rush/certbot/conf:/etc/letsencrypt -v /opt/z-rush/certbot/www:/var/www/certbot certbot/certbot renew --quiet && docker exec z-rush-nginx nginx -s reload 2>/dev/null || true
CRONEOF

# Open firewall ports
firewall-cmd --permanent --add-port=80/tcp
firewall-cmd --permanent --add-port=443/tcp
firewall-cmd --permanent --add-port=3000/tcp
firewall-cmd --reload

# Start PostgreSQL first (API container will be pulled when ready)
docker compose up -d postgres

echo "=== Z-Rush Server Setup Complete ==="
echo "Next steps:"
echo "1. Configure DNS: Point ${params.domainName} to this server's IP"
echo "2. Run: /opt/z-rush/setup-ssl.sh"
echo "3. Build and push your API image, then run: /opt/z-rush/deploy.sh"
`);
}
