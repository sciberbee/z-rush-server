import * as pulumi from "@pulumi/pulumi";
import * as oci from "@pulumi/oci";
import { appConfig } from "./config";
import { generateCloudInit } from "./cloud-init";

// ============================================================================
// Data Sources
// ============================================================================

// Get availability domains
const availabilityDomains = oci.identity.getAvailabilityDomains({
  compartmentId: appConfig.compartmentId,
});

// Get latest Oracle Linux 8 image (AMD x86)
// Using AMD shape for better availability
const instanceShape = "VM.Standard.E2.1.Micro"; // Free tier AMD shape
const images = oci.core.getImages({
  compartmentId: appConfig.compartmentId,
  operatingSystem: "Oracle Linux",
  operatingSystemVersion: "8",
  shape: instanceShape,
  sortBy: "TIMECREATED",
  sortOrder: "DESC",
});

// ============================================================================
// Network Resources
// ============================================================================

// Virtual Cloud Network (VCN)
const vcn = new oci.core.Vcn("z-rush-vcn", {
  compartmentId: appConfig.compartmentId,
  cidrBlocks: [appConfig.vcnCidr],
  displayName: "z-rush-vcn",
  dnsLabel: "zrush",
});

// Internet Gateway
const internetGateway = new oci.core.InternetGateway("z-rush-igw", {
  compartmentId: appConfig.compartmentId,
  vcnId: vcn.id,
  displayName: "z-rush-internet-gateway",
  enabled: true,
});

// Route Table
const routeTable = new oci.core.RouteTable("z-rush-rt", {
  compartmentId: appConfig.compartmentId,
  vcnId: vcn.id,
  displayName: "z-rush-route-table",
  routeRules: [{
    networkEntityId: internetGateway.id,
    destination: "0.0.0.0/0",
    destinationType: "CIDR_BLOCK",
  }],
});

// Security List
const securityList = new oci.core.SecurityList("z-rush-sl", {
  compartmentId: appConfig.compartmentId,
  vcnId: vcn.id,
  displayName: "z-rush-security-list",

  // Egress: Allow all outbound
  egressSecurityRules: [{
    protocol: "all",
    destination: "0.0.0.0/0",
    destinationType: "CIDR_BLOCK",
  }],

  // Ingress rules
  ingressSecurityRules: [
    // SSH
    {
      protocol: "6", // TCP
      source: "0.0.0.0/0",
      sourceType: "CIDR_BLOCK",
      tcpOptions: {
        min: 22,
        max: 22,
      },
    },
    // HTTP
    {
      protocol: "6",
      source: "0.0.0.0/0",
      sourceType: "CIDR_BLOCK",
      tcpOptions: {
        min: 80,
        max: 80,
      },
    },
    // HTTPS
    {
      protocol: "6",
      source: "0.0.0.0/0",
      sourceType: "CIDR_BLOCK",
      tcpOptions: {
        min: 443,
        max: 443,
      },
    },
    // API port (for direct access during development)
    {
      protocol: "6",
      source: "0.0.0.0/0",
      sourceType: "CIDR_BLOCK",
      tcpOptions: {
        min: 3000,
        max: 3000,
      },
    },
    // ICMP (ping)
    {
      protocol: "1", // ICMP
      source: "0.0.0.0/0",
      sourceType: "CIDR_BLOCK",
      icmpOptions: {
        type: 3,
        code: 4,
      },
    },
  ],
});

// Public Subnet
const publicSubnet = new oci.core.Subnet("z-rush-public-subnet", {
  compartmentId: appConfig.compartmentId,
  vcnId: vcn.id,
  cidrBlock: appConfig.subnetCidr,
  displayName: "z-rush-public-subnet",
  dnsLabel: "public",
  routeTableId: routeTable.id,
  securityListIds: [securityList.id],
  prohibitPublicIpOnVnic: false,
});

// ============================================================================
// Compute Instance
// ============================================================================

// Generate cloud-init script
const cloudInitScript = generateCloudInit({
  dbUser: appConfig.dbUser,
  dbPassword: appConfig.dbPassword,
  dbName: appConfig.dbName,
  jwtSecret: appConfig.jwtSecret,
  googleClientId: appConfig.googleClientId,
  googleClientSecret: appConfig.googleClientSecret,
  domainName: appConfig.domainName,
  frontendUrl: appConfig.frontendUrl,
});

// Get availability domain with capacity (try each one)
// Using AD index from config to allow manual override
const adIndex = parseInt(process.env.OCI_AD_INDEX || "0");

// Compute Instance - using AMD micro shape for better availability
const instance = new oci.core.Instance("z-rush-server", {
  compartmentId: appConfig.compartmentId,
  availabilityDomain: availabilityDomains.then(ads => {
    const idx = Math.min(adIndex, ads.availabilityDomains.length - 1);
    console.log(`Using AD: ${ads.availabilityDomains[idx].name}`);
    return ads.availabilityDomains[idx].name;
  }),
  displayName: appConfig.instanceDisplayName,

  // Shape configuration (AMD x86 - Always Free)
  // VM.Standard.E2.1.Micro: 1 OCPU, 1GB RAM (fixed shape, no shapeConfig)
  shape: instanceShape,

  // Source image
  sourceDetails: {
    sourceType: "image",
    sourceId: images.then(imgs => imgs.images[0].id),
    bootVolumeSizeInGbs: "50",
  },

  // Network configuration
  createVnicDetails: {
    subnetId: publicSubnet.id,
    assignPublicIp: "true",
    displayName: "z-rush-vnic",
  },

  // Metadata (cloud-init and SSH key)
  metadata: {
    ssh_authorized_keys: appConfig.sshPublicKey,
    user_data: cloudInitScript.apply(script =>
      Buffer.from(script).toString("base64")
    ),
  },

  // Preserve boot volume on termination
  preserveBootVolume: false,
});

// ============================================================================
// Outputs
// ============================================================================

export const vcnId = vcn.id;
export const subnetId = publicSubnet.id;
export const instanceId = instance.id;
export const instancePublicIp = instance.publicIp;
export const instancePrivateIp = instance.privateIp;

// SSH command
export const sshCommand = pulumi.interpolate`ssh -i ~/.ssh/oci_z_rush opc@${instance.publicIp}`;

// Connection info
export const connectionInfo = pulumi.interpolate`
================================================================================
Z-Rush Server Deployment Complete!
================================================================================

Instance ID: ${instance.id}
Public IP: ${instance.publicIp}
Private IP: ${instance.privateIp}

SSH Connection:
  ssh -i ~/.ssh/oci_z_rush opc@${instance.publicIp}

Next Steps:
1. Wait 2-3 minutes for cloud-init to complete
2. SSH into the server and check setup:
   sudo tail -f /var/log/cloud-init-output.log

3. Configure DNS:
   Point ${appConfig.domainName} -> ${instance.publicIp}

4. Setup SSL certificate:
   cd /opt/z-rush && ./setup-ssl.sh

5. Deploy your application:
   cd /opt/z-rush && ./deploy.sh

Health Check:
  curl http://${instance.publicIp}:3000/health

================================================================================
`;
