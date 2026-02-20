export type ContactStatus = "subscribed" | "unsubscribed";
export type ContactSource = "landing" | "import" | "admin";

export interface Contact {
  emailLower: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email2?: string;
  homePhone?: string;
  businessPhone?: string;
  mobilePhone?: string;
  homeStreet?: string;
  homeAddress2?: string;
  homeCity?: string;
  homePostalCode?: string;
  homeCountry?: string;
  businessAddress?: string;
  businessAddress2?: string;
  businessCity?: string;
  businessState?: string;
  businessPostalCode?: string;
  businessCountry?: string;
  organization?: string;
  notes?: string;
  birthday?: string;
  groups?: string[];
  status: ContactStatus;
  source: ContactSource;
  createdAt: string;
  updatedAt: string;
  unsubscribedAt?: string;
}

export interface ContactKey {
  emailLower: string;
}

export interface ContactGSI {
  gsi1pk: ContactStatus;
  gsi1sk: string;
}

export interface ContactGroup {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}
