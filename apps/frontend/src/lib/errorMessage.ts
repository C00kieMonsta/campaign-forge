/**
 * The message to show a user for a thrown value.
 *
 * Exists because every Lex catch block used `String(err)`, which renders an Error as
 * "Error: Artifact is not exportable for filing…" — the word "Error:" glued to the front of a
 * sentence the server wrote to be read. The api layer already parses the server's `message` out of
 * the JSON body (see api.ts), so the useful text is there; it was only the stringification
 * defacing it.
 *
 * Not a translation layer: the server's messages are English and this does not change that. It just
 * stops adding noise to them.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Une erreur est survenue";
}
