import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const ociConfig = new pulumi.Config("oci");

export interface AppConfig {
  // OCI Configuration
  compartmentId: string;
  region: string;

  // Instance Configuration
  instanceShape: string;
  instanceOcpus: number;
  instanceMemoryGb: number;
  instanceDisplayName: string;

  // Network Configuration
  vcnCidr: string;
  subnetCidr: string;

  // Application Configuration
  domainName: string;
  frontendUrl: string;

  // Database Configuration
  dbUser: string;
  dbPassword: pulumi.Output<string>;
  dbName: string;

  // JWT Configuration
  jwtSecret: pulumi.Output<string>;

  // Google OAuth
  googleClientId: string;
  googleClientSecret: pulumi.Output<string>;

  // SSH Key
  sshPublicKey: string;
}

export const appConfig: AppConfig = {
  // OCI - compartmentId는 tenancyOcid를 기본값으로 사용 (root compartment)
  compartmentId: config.get("compartmentId") || ociConfig.require("tenancyOcid"),
  region: ociConfig.require("region"),

  // Instance - ARM 기반 Free Tier
  instanceShape: config.get("instanceShape") || "VM.Standard.A1.Flex",
  instanceOcpus: config.getNumber("instanceOcpus") || 2,
  instanceMemoryGb: config.getNumber("instanceMemoryGb") || 12,
  instanceDisplayName: config.get("instanceDisplayName") || "z-rush-server",

  // Network
  vcnCidr: config.get("vcnCidr") || "10.0.0.0/16",
  subnetCidr: config.get("subnetCidr") || "10.0.1.0/24",

  // Application
  domainName: config.get("domainName") || "api.z-rush.com",
  frontendUrl: config.get("frontendUrl") || "https://z-rush.com",

  // Database
  dbUser: config.get("dbUser") || "zrush",
  dbPassword: config.requireSecret("dbPassword"),
  dbName: config.get("dbName") || "zrush",

  // JWT
  jwtSecret: config.requireSecret("jwtSecret"),

  // Google OAuth
  googleClientId: config.require("googleClientId"),
  googleClientSecret: config.requireSecret("googleClientSecret"),

  // SSH
  sshPublicKey: config.require("sshPublicKey"),
};
