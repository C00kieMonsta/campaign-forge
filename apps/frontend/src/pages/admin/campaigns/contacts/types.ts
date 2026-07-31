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
  status: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContactGroup {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface ContactFormData {
  firstName: string;
  lastName: string;
  email: string;
  displayName: string;
  email2: string;
  homePhone: string;
  businessPhone: string;
  mobilePhone: string;
  homeStreet: string;
  homeAddress2: string;
  homeCity: string;
  homePostalCode: string;
  homeCountry: string;
  businessAddress: string;
  businessAddress2: string;
  businessCity: string;
  businessState: string;
  businessPostalCode: string;
  businessCountry: string;
  organization: string;
  notes: string;
  birthday: string;
  groups: string[];
}

export interface ContactFormErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
}

export interface ImportPreview {
  toImport: { contact: Partial<Contact>; groupNames: string[] }[];
  skipped: number;
  duplicates: number;
  newGroupNames: string[];
}
