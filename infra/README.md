# Z-Rush Infrastructure (Pulumi + OCI)

OCI(Oracle Cloud Infrastructure)에 Z-Rush 서버를 자동 배포하는 Pulumi 프로젝트입니다.

## 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                    OCI VCN (10.0.0.0/16)                │
│  ┌───────────────────────────────────────────────────┐  │
│  │           Public Subnet (10.0.1.0/24)             │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │     Compute Instance (VM.Standard.A1.Flex)  │  │  │
│  │  │     - 2 OCPU (ARM)                          │  │  │
│  │  │     - 12GB RAM                              │  │  │
│  │  │     - Oracle Linux 8                        │  │  │
│  │  │                                             │  │  │
│  │  │     Docker Containers:                      │  │  │
│  │  │     ├── Nginx (80, 443)                     │  │  │
│  │  │     ├── z-rush-api (3000)                   │  │  │
│  │  │     └── PostgreSQL (5432, internal)         │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                              │
│                   Internet Gateway                      │
└─────────────────────────────────────────────────────────┘
```

## 사전 요구사항

### 1. Pulumi CLI 설치

```bash
# macOS
brew install pulumi

# Linux
curl -fsSL https://get.pulumi.com | sh

# Windows
choco install pulumi
```

### 2. Node.js 설치

```bash
# fnm 사용 (권장)
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 20
fnm use 20
```

### 3. OCI 계정 및 API Key 설정

1. [OCI Console](https://cloud.oracle.com)에 로그인
2. 우측 상단 프로필 → "My profile" → "API keys" → "Add API key"
3. "Generate API key pair" 선택 후 Private key 다운로드
4. 다음 정보 확보:
   - Tenancy OCID
   - User OCID
   - API Key Fingerprint
   - Private Key (PEM 파일 내용)
   - Region (예: ap-seoul-1)

### 4. Google OAuth 설정

1. [Google Cloud Console](https://console.cloud.google.com)
2. APIs & Services → Credentials → Create Credentials → OAuth client ID
3. Application type: Web application
4. Authorized redirect URIs 추가:
   - `https://api.z-rush.com/auth/google/callback`
   - `http://localhost:3000/auth/google/callback` (개발용)

### 5. SSH Key 생성

```bash
ssh-keygen -t ed25519 -f ~/.ssh/oci_z_rush -C "z-rush-server"
cat ~/.ssh/oci_z_rush.pub  # 이 값을 sshPublicKey에 사용
```

## 설치 및 배포

### 1. 의존성 설치

```bash
cd infra
npm install
```

### 2. Pulumi 로그인

```bash
# Pulumi Cloud 사용 (권장)
pulumi login

# 또는 로컬 상태 사용
pulumi login --local
```

### 3. 스택 생성 및 설정

```bash
# 새 스택 생성
pulumi stack init dev

# OCI Provider 설정
pulumi config set oci:region ap-seoul-1
pulumi config set oci:tenancyOcid ocid1.tenancy.oc1..xxxxx
pulumi config set oci:userOcid ocid1.user.oc1..xxxxx
pulumi config set oci:fingerprint aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99

# Private Key 설정 (파일에서 읽어서 설정)
pulumi config set oci:privateKey --secret < ~/.oci/oci_api_key.pem

# 애플리케이션 설정
pulumi config set z-rush-infra:domainName api.z-rush.com
pulumi config set z-rush-infra:frontendUrl https://z-rush.com

# 비밀 값 설정
pulumi config set z-rush-infra:dbPassword --secret $(openssl rand -base64 32)
pulumi config set z-rush-infra:jwtSecret --secret $(openssl rand -base64 64)
pulumi config set z-rush-infra:googleClientId xxxxx.apps.googleusercontent.com
pulumi config set z-rush-infra:googleClientSecret --secret GOCSPX-xxxxx

# SSH 공개키 설정
pulumi config set z-rush-infra:sshPublicKey "$(cat ~/.ssh/oci_z_rush.pub)"
```

### 4. 배포 미리보기

```bash
pulumi preview
```

### 5. 배포 실행

```bash
pulumi up
```

### 6. 배포 확인

```bash
# 출력 확인
pulumi stack output connectionInfo

# SSH 접속
$(pulumi stack output sshCommand)
```

## 배포 후 설정

### 1. Cloud-init 완료 확인

```bash
ssh -i ~/.ssh/oci_z_rush opc@<PUBLIC_IP>
sudo tail -f /var/log/cloud-init-output.log
```

### 2. DNS 설정

도메인 DNS에서 A 레코드 추가:
```
api.z-rush.com -> <PUBLIC_IP>
```

### 3. SSL 인증서 설정

```bash
cd /opt/z-rush
./setup-ssl.sh
```

### 4. 애플리케이션 배포

```bash
# Docker 이미지 빌드 및 푸시 (로컬에서)
docker build -t ghcr.io/your-org/z-rush-server:latest .
docker push ghcr.io/your-org/z-rush-server:latest

# 서버에서 배포
cd /opt/z-rush
./deploy.sh
```

## 관리 명령어

```bash
# 인프라 상태 확인
pulumi stack

# 출력값 확인
pulumi stack output

# 리소스 새로고침
pulumi refresh

# 인프라 삭제
pulumi destroy

# 스택 제거
pulumi stack rm dev
```

## 비용

OCI Free Tier 내에서 운영:

| 리소스 | Free Tier | 사용량 |
|--------|-----------|--------|
| ARM Compute | 4 OCPU, 24GB RAM | 2 OCPU, 12GB |
| Boot Volume | 200GB | 50GB |
| Outbound Data | 10TB/month | Variable |

**예상 월 비용: $0** (Free Tier 내)

## 트러블슈팅

### Pulumi 배포 실패

```bash
# 상세 로그 확인
pulumi up --debug --logtostderr

# 상태 새로고침
pulumi refresh
```

### OCI API 인증 오류

```bash
# API Key 확인
cat ~/.oci/config

# Fingerprint 재확인
openssl rsa -pubout -outform DER -in ~/.oci/oci_api_key.pem | openssl md5 -c
```

### SSH 접속 불가

1. Security List에서 22번 포트 열림 확인
2. 인스턴스 상태가 RUNNING인지 확인
3. Public IP가 할당되었는지 확인

```bash
# OCI CLI로 확인
oci compute instance list --compartment-id <COMPARTMENT_ID>
```

## 파일 구조

```
infra/
├── Pulumi.yaml              # Pulumi 프로젝트 설정
├── Pulumi.dev.yaml.example  # 스택 설정 예시
├── package.json             # Node.js 의존성
├── tsconfig.json            # TypeScript 설정
├── index.ts                 # 메인 인프라 코드
├── config.ts                # 설정 관리
├── cloud-init.ts            # 서버 초기화 스크립트
└── README.md                # 이 문서
```

## 참고 자료

- [Pulumi OCI Provider](https://www.pulumi.com/registry/packages/oci/)
- [OCI Documentation](https://docs.oracle.com/en-us/iaas/Content/home.htm)
- [OCI Free Tier](https://www.oracle.com/cloud/free/)
