import type { ContactFormData } from "./types";

export {
  CSV_COLUMNS,
  downloadTemplate,
  parseCsv,
  parseCsvLine
} from "@/lib/contactCsv";

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
  groups: []
};

export const SOURCE_LABELS: Record<string, string> = {
  landing: "Newsletter",
  import: "Import",
  admin: "Admin"
};

export const SOURCE_CLASSES: Record<string, string> = {
  landing: "bg-blue-50 text-blue-600 border-blue-200",
  import: "bg-amber-50 text-amber-600 border-amber-200",
  admin: "bg-purple-50 text-purple-600 border-purple-200"
};

const groupColorMap: Record<string, string> = {
  red: "bg-red-100 text-red-700 border-red-200",
  blue: "bg-blue-100 text-blue-700 border-blue-200",
  green: "bg-green-100 text-green-700 border-green-200",
  amber: "bg-amber-100 text-amber-700 border-amber-200",
  purple: "bg-purple-100 text-purple-700 border-purple-200",
  pink: "bg-pink-100 text-pink-700 border-pink-200",
  teal: "bg-teal-100 text-teal-700 border-teal-200",
  orange: "bg-orange-100 text-orange-700 border-orange-200"
};

export function getGroupClasses(color: string): string {
  return groupColorMap[color] ?? "bg-gray-100 text-gray-700 border-gray-200";
}

export const AUTO_COLORS = [
  "red",
  "blue",
  "green",
  "amber",
  "purple",
  "pink",
  "teal",
  "orange"
];
