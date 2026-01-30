#!/bin/bash
set -e

echo "=== Z-Rush Pulumi Setup ==="

cd "$(dirname "$0")"

# Check if pulumi is installed
if ! command -v pulumi &> /dev/null; then
    echo "Installing Pulumi..."
    curl -fsSL https://get.pulumi.com | sh
    export PATH="$HOME/.pulumi/bin:$PATH"
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "Error: npm is required. Please install Node.js first."
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Login to Pulumi (local state)
echo "Setting up Pulumi local state..."
pulumi login --local

# Create or select stack
STACK_NAME="dev"
if pulumi stack ls 2>/dev/null | grep -q "$STACK_NAME"; then
    pulumi stack select "$STACK_NAME"
else
    pulumi stack init "$STACK_NAME"
fi

# OCI Configuration
echo "Configuring OCI provider..."
pulumi config set oci:region ap-chuncheon-1
pulumi config set oci:tenancyOcid ocid1.tenancy.oc1..aaaaaaaa2hp4qizwmt3l567lknehds5v7537fudihfdrmnexo5lx6usr222q
pulumi config set oci:userOcid ocid1.user.oc1..aaaaaaaa47qgg223nrwvybcylz53joechdrvnlllq5mivhdgjn3uwxpskdta
pulumi config set oci:fingerprint a4:fa:20:03:fe:46:9d:a7:23:ea:73:53:b7:0e:28:2f

# Set private key
echo "Setting OCI private key..."
pulumi config set oci:privateKey --secret < /Users/sciberbee/Documents/z-rush-server/.secure/yby0907200@gmail.com-2026-01-30T10_44_23.033Z.pem

# SSH Public Key
echo "Setting SSH public key..."
pulumi config set z-rush-infra:sshPublicKey "$(cat ~/.ssh/oci_z_rush.pub)"

# Generate secure passwords
echo "Generating secure secrets..."
pulumi config set z-rush-infra:dbPassword --secret "$(openssl rand -base64 32)"
pulumi config set z-rush-infra:jwtSecret --secret "$(openssl rand -base64 64)"

# Application settings (defaults)
pulumi config set z-rush-infra:domainName api.z-rush.com
pulumi config set z-rush-infra:frontendUrl https://z-rush.com

echo ""
echo "=== Setup almost complete! ==="
echo ""
echo "You still need to set Google OAuth credentials:"
echo ""
echo "  pulumi config set z-rush-infra:googleClientId YOUR_CLIENT_ID"
echo "  pulumi config set z-rush-infra:googleClientSecret --secret YOUR_CLIENT_SECRET"
echo ""
echo "Then run:"
echo "  pulumi up"
echo ""
