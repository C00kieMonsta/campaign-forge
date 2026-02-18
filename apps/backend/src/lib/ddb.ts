import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { getEnv } from "./env";

let client: DynamoDBDocumentClient | null = null;

export function ddb(): DynamoDBDocumentClient {
  if (client) return client;
  client = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: getEnv().AWS_REGION }),
    { marshallOptions: { removeUndefinedValues: true } },
  );
  return client;
}

export function tables() {
  const env = getEnv();
  return { contacts: env.CONTACTS_TABLE, campaigns: env.CAMPAIGNS_TABLE };
}

export function buildUpdate(fields: Record<string, unknown>) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  return {
    UpdateExpression: "SET " + entries.map((_, i) => `#k${i} = :v${i}`).join(", "),
    ExpressionAttributeNames: Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k])),
    ExpressionAttributeValues: Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
  };
}

export function encodeCursor(key?: Record<string, unknown>): string | null {
  return key ? Buffer.from(JSON.stringify(key)).toString("base64url") : null;
}

export function decodeCursor(cursor?: string): Record<string, unknown> | undefined {
  return cursor ? JSON.parse(Buffer.from(cursor, "base64url").toString()) : undefined;
}
