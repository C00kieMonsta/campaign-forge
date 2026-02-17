import { createGlobalLogger } from "@/logger/winston";

export class Loggable {
  protected logger = createGlobalLogger();
  protected context = { context: "Master Service" };
}
