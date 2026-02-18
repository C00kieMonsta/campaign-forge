/**
 * Contact entity for newsletter subscribers
 */

export type ContactStatus = "subscribed" | "unsubscribed";
export type ContactSource = "landing" | "import" | "admin";

export interface Contact {
  /** Primary key - lowercase email */
  emailLower: string;
  /** Original case-preserved email */
  email: string;
  /** Optional first name */
  firstName?: string;
  /** Optional last name */
  lastName?: string;
  /** Subscription status */
  status: ContactStatus;
  /** How the contact was added */
  source: ContactSource;
  /** ISO8601 timestamp */
  createdAt: string;
  /** ISO8601 timestamp */
  updatedAt: string;
  /** ISO8601 timestamp - set when unsubscribed */
  unsubscribedAt?: string;
}

/**
 * DynamoDB key structure for Contacts table
 */
export interface ContactKey {
  emailLower: string;
}

/**
 * DynamoDB GSI structure for querying by status
 */
export interface ContactGSI {
  gsi1pk: ContactStatus; // status
  gsi1sk: string; // emailLower
}
