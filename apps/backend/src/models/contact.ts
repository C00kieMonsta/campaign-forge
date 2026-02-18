import {
  GetCommand, PutCommand, UpdateCommand,
  QueryCommand, ScanCommand, BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Contact } from "@packages/types";
import { ddb, tables, buildUpdate, encodeCursor, decodeCursor } from "../lib/ddb";

const table = () => tables().contacts;

export async function get(emailLower: string): Promise<Contact | null> {
  const { Item } = await ddb().send(new GetCommand({ TableName: table(), Key: { emailLower } }));
  return (Item as Contact) ?? null;
}

export async function put(contact: Contact): Promise<void> {
  await ddb().send(new PutCommand({
    TableName: table(),
    Item: { ...contact, gsi1pk: contact.status, gsi1sk: contact.emailLower },
  }));
}

// Conditional create — fails if contact already exists
export async function create(contact: Contact): Promise<void> {
  await ddb().send(new PutCommand({
    TableName: table(),
    Item: { ...contact, gsi1pk: contact.status, gsi1sk: contact.emailLower },
    ConditionExpression: "attribute_not_exists(emailLower)",
  }));
}

export async function update(emailLower: string, fields: Record<string, unknown>): Promise<void> {
  const updates: Record<string, unknown> = { ...fields, updatedAt: new Date().toISOString() };
  if (updates.status) updates.gsi1pk = updates.status;

  await ddb().send(new UpdateCommand({
    TableName: table(),
    Key: { emailLower },
    ...buildUpdate(updates),
  }));
}

type Page<T> = { items: T[]; cursor: string | null; count: number };

export async function listByStatus(status: string, limit: number, cursor?: string): Promise<Page<Contact>> {
  const result = await ddb().send(new QueryCommand({
    TableName: table(),
    IndexName: "byStatus",
    KeyConditionExpression: "gsi1pk = :s",
    ExpressionAttributeValues: { ":s": status },
    Limit: limit,
    ExclusiveStartKey: decodeCursor(cursor),
  }));
  const items = (result.Items || []) as Contact[];
  return { items, cursor: encodeCursor(result.LastEvaluatedKey), count: items.length };
}

export async function listAll(limit: number, cursor?: string): Promise<Page<Contact>> {
  const result = await ddb().send(new ScanCommand({
    TableName: table(),
    Limit: limit,
    ExclusiveStartKey: decodeCursor(cursor),
  }));
  const items = (result.Items || []) as Contact[];
  return { items, cursor: encodeCursor(result.LastEvaluatedKey), count: items.length };
}

// Case-insensitive on email, case-sensitive on names (MVP trade-off)
export async function search(q: string, limit: number, cursor?: string): Promise<Page<Contact>> {
  const result = await ddb().send(new ScanCommand({
    TableName: table(),
    FilterExpression: "contains(emailLower, :qLower) OR contains(firstName, :q) OR contains(lastName, :q)",
    ExpressionAttributeValues: { ":qLower": q.toLowerCase(), ":q": q },
    Limit: limit * 3,
    ExclusiveStartKey: decodeCursor(cursor),
  }));
  const items = (result.Items || []).slice(0, limit) as Contact[];
  return { items, cursor: encodeCursor(result.LastEvaluatedKey), count: items.length };
}

export async function queryAllSubscribed(): Promise<Contact[]> {
  const items: Contact[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const result = await ddb().send(new QueryCommand({
      TableName: table(),
      IndexName: "byStatus",
      KeyConditionExpression: "gsi1pk = :s",
      ExpressionAttributeValues: { ":s": "subscribed" },
      ExclusiveStartKey: cursor,
    }));
    items.push(...(result.Items || []) as Contact[]);
    cursor = result.LastEvaluatedKey;
  } while (cursor);
  return items;
}

export async function scanAll(): Promise<Contact[]> {
  const items: Contact[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const result = await ddb().send(new ScanCommand({ TableName: table(), ExclusiveStartKey: cursor }));
    items.push(...(result.Items || []) as Contact[]);
    cursor = result.LastEvaluatedKey;
  } while (cursor);
  return items;
}

export async function batchPut(contacts: Contact[]): Promise<void> {
  const tableName = table();
  for (let i = 0; i < contacts.length; i += 25) {
    const batch = contacts.slice(i, i + 25);
    await ddb().send(new BatchWriteCommand({
      RequestItems: {
        [tableName]: batch.map(c => ({
          PutRequest: { Item: { ...c, gsi1pk: c.status, gsi1sk: c.emailLower } },
        })),
      },
    }));
  }
}
