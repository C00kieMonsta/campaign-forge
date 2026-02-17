import { SESClient } from "@aws-sdk/client-ses";
import { ConfigService } from "@/config/config.service";

// Create a function to initialize SES client with proper credentials
function createSESClient(): SESClient {
  const configService = new ConfigService();
  const awsConfig = configService.getAWSConfig();

  return new SESClient({
    region: awsConfig.region || "eu-north-1",
    credentials:
      awsConfig.accessKeyId && awsConfig.secretAccessKey
        ? {
            accessKeyId: awsConfig.accessKeyId,
            secretAccessKey: awsConfig.secretAccessKey
          }
        : undefined
  });
}

export const sesClient = createSESClient();
