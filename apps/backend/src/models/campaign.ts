import { GetCommand, PutCommand, UpdateCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { Campaign } from "@packages/types";
import { ddb, tables, buildUpdate, encodeCursor, decodeCursor } from "../lib/ddb";

const table = () => tables().campaigns;

export async function get(id: string): Promise<Campaign | null> {
  const { Item } = await ddb().send(new GetCommand({ TableName: table(), Key: { campaignId: id } }));
  return (Item as Campaign) ?? null;
}

export async function put(campaign: Campaign): Promise<void> {
  await ddb().send(new PutCommand({ TableName: table(), Item: campaign }));
}

export async function update(id: string, fields: Record<string, unknown>): Promise<void> {
  await ddb().send(new UpdateCommand({
    TableName: table(),
    Key: { campaignId: id },
    ...buildUpdate({ ...fields, updatedAt: new Date().toISOString() }),
  }));
}

export async function list(
  limit: number, cursor?: string,
): Promise<{ items: Campaign[]; cursor: string | null; count: number }> {
  const result = await ddb().send(new ScanCommand({
    TableName: table(),
    Limit: limit,
    ExclusiveStartKey: decodeCursor(cursor),
  }));
  const items = (result.Items || []) as Campaign[];
  return { items, cursor: encodeCursor(result.LastEvaluatedKey), count: items.length };
}
