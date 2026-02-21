import { Injectable } from "@nestjs/common";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConfigService } from "../config/config.service";

@Injectable()
export class DdbService {
  readonly client: DynamoDBDocumentClient;
  readonly tables: { contacts: string; campaigns: string; groups: string };

  constructor(private config: ConfigService) {
    const endpoint = config.get("DDB_ENDPOINT");
    const raw = new DynamoDBClient({
      region: config.get("AWS_REGION"),
      ...(endpoint && { endpoint }),
    });
    this.client = DynamoDBDocumentClient.from(raw, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.tables = config.tables;
  }

  async get(table: string, key: Record<string, string>) {
    const { Item } = await this.client.send(new GetCommand({ TableName: table, Key: key }));
    return Item ?? null;
  }

  async put(table: string, item: Record<string, unknown>) {
    await this.client.send(new PutCommand({ TableName: table, Item: item }));
  }

  async putConditional(table: string, item: Record<string, unknown>, condition: string) {
    await this.client.send(new PutCommand({ TableName: table, Item: item, ConditionExpression: condition }));
  }

  async update(table: string, key: Record<string, string>, fields: Record<string, unknown>) {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    await this.client.send(new UpdateCommand({
      TableName: table,
      Key: key,
      UpdateExpression: "SET " + entries.map((_, i) => `#k${i} = :v${i}`).join(", "),
      ExpressionAttributeNames: Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k])),
      ExpressionAttributeValues: Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
    }));
  }

  async query(table: string, indexName: string, keyExpr: string, values: Record<string, unknown>, opts?: { limit?: number; cursor?: string }) {
    const result = await this.client.send(new QueryCommand({
      TableName: table,
      IndexName: indexName,
      KeyConditionExpression: keyExpr,
      ExpressionAttributeValues: values,
      Limit: opts?.limit,
      ExclusiveStartKey: decodeCursor(opts?.cursor),
    }));
    return { items: result.Items || [], cursor: encodeCursor(result.LastEvaluatedKey) };
  }

  async queryCount(table: string, indexName: string, keyExpr: string, values: Record<string, unknown>): Promise<number> {
    let count = 0;
    let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new QueryCommand({
        TableName: table, IndexName: indexName,
        KeyConditionExpression: keyExpr,
        ExpressionAttributeValues: values,
        Select: "COUNT",
        ExclusiveStartKey: cursor,
      }));
      count += result.Count || 0;
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    return count;
  }

  async scanCount(table: string): Promise<number> {
    let count = 0;
    let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new ScanCommand({ TableName: table, Select: "COUNT", ExclusiveStartKey: cursor }));
      count += result.Count || 0;
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    return count;
  }

  async queryAll(table: string, indexName: string, keyExpr: string, values: Record<string, unknown>) {
    const items: Record<string, unknown>[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new QueryCommand({
        TableName: table, IndexName: indexName,
        KeyConditionExpression: keyExpr,
        ExpressionAttributeValues: values,
        ExclusiveStartKey: cursor,
      }));
      items.push(...(result.Items || []));
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    return items;
  }

  async scan(table: string, opts?: { limit?: number; cursor?: string; filter?: string; values?: Record<string, unknown> }) {
    const result = await this.client.send(new ScanCommand({
      TableName: table,
      Limit: opts?.limit,
      ExclusiveStartKey: decodeCursor(opts?.cursor),
      ...(opts?.filter && { FilterExpression: opts.filter, ExpressionAttributeValues: opts.values }),
    }));
    return { items: result.Items || [], cursor: encodeCursor(result.LastEvaluatedKey) };
  }

  async scanAll(table: string) {
    const items: Record<string, unknown>[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new ScanCommand({ TableName: table, ExclusiveStartKey: cursor }));
      items.push(...(result.Items || []));
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    return items;
  }

  async delete(table: string, key: Record<string, string>) {
    await this.client.send(new DeleteCommand({ TableName: table, Key: key }));
  }

  async batchWrite(table: string, items: Record<string, unknown>[]) {
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      await this.client.send(new BatchWriteCommand({
        RequestItems: { [table]: batch.map((item) => ({ PutRequest: { Item: item } })) },
      }));
    }
  }
}

function encodeCursor(key?: Record<string, unknown>): string | null {
  return key ? Buffer.from(JSON.stringify(key)).toString("base64url") : null;
}

function decodeCursor(cursor?: string): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  return JSON.parse(Buffer.from(cursor, "base64url").toString());
}
