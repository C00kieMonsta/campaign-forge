import { z } from "zod";

export const Email = z.string().email();
export type Email = z.infer<typeof Email>;
