import type { Contact, ContactFormData } from "./types";

export const emptyForm: ContactFormData = {
  firstName: "",
  lastName: "",
  email: "",
  displayName: "",
  email2: "",
  homePhone: "",
  businessPhone: "",
  mobilePhone: "",
  homeStreet: "",
  homeAddress2: "",
  homeCity: "",
  homePostalCode: "",
  homeCountry: "",
  businessAddress: "",
  businessAddress2: "",
  businessCity: "",
  businessState: "",
  businessPostalCode: "",
  businessCountry: "",
  organization: "",
  notes: "",
  birthday: "",
  groups: [],
};

export const SOURCE_LABELS: Record<string, string> = {
  landing: "Newsletter",
  import: "Import",
  admin: "Admin",
};

export const SOURCE_CLASSES: Record<string, string> = {
  landing: "bg-blue-50 text-blue-600 border-blue-200",
  import: "bg-amber-50 text-amber-600 border-amber-200",
  admin: "bg-purple-50 text-purple-600 border-purple-200",
};

const groupColorMap: Record<string, string> = {
  red: "bg-red-100 text-red-700 border-red-200",
  blue: "bg-blue-100 text-blue-700 border-blue-200",
  green: "bg-green-100 text-green-700 border-green-200",
  amber: "bg-amber-100 text-amber-700 border-amber-200",
  purple: "bg-purple-100 text-purple-700 border-purple-200",
  pink: "bg-pink-100 text-pink-700 border-pink-200",
  teal: "bg-teal-100 text-teal-700 border-teal-200",
  orange: "bg-orange-100 text-orange-700 border-orange-200",
};

export function getGroupClasses(color: string): string {
  return groupColorMap[color] ?? "bg-gray-100 text-gray-700 border-gray-200";
}

export const CSV_COLUMNS: { header: string; field: keyof Contact | "group" }[] = [
  { header: "First Name", field: "firstName" },
  { header: "Last Name", field: "lastName" },
  { header: "Display Name", field: "displayName" },
  { header: "E-mail Address", field: "email" },
  { header: "E-mail 2 Address", field: "email2" },
  { header: "Home Phone", field: "homePhone" },
  { header: "Business Phone", field: "businessPhone" },
  { header: "Mobile Phone", field: "mobilePhone" },
  { header: "Home Street", field: "homeStreet" },
  { header: "Home Address 2", field: "homeAddress2" },
  { header: "Home City", field: "homeCity" },
  { header: "Home Postal Code", field: "homePostalCode" },
  { header: "Home Country", field: "homeCountry" },
  { header: "Business Address", field: "businessAddress" },
  { header: "Business Address 2", field: "businessAddress2" },
  { header: "Business City", field: "businessCity" },
  { header: "Business State", field: "businessState" },
  { header: "Business Postal Code", field: "businessPostalCode" },
  { header: "Business Country", field: "businessCountry" },
  { header: "Organization", field: "organization" },
  { header: "Notes", field: "notes" },
  { header: "Birthday", field: "birthday" },
  { header: "Group", field: "group" },
];

export const AUTO_COLORS = ["red", "blue", "green", "amber", "purple", "pink", "teal", "orange"];

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h.trim()] = (values[i] ?? "").trim(); });
    return row;
  });
}

export function downloadTemplate(): void {
  const headers = CSV_COLUMNS.map((c) => c.header).join(",");
  const blob = new Blob([headers + "\n"], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "contacts-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}
