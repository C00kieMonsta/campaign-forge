export const TABLE_NAMES = {
  CONTACTS: "contacts",
  CAMPAIGNS: "campaigns",
} as const;

export type TableName = (typeof TABLE_NAMES)[keyof typeof TABLE_NAMES];
