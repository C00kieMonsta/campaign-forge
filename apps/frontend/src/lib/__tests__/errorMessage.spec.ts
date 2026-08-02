import { errorMessage } from "../errorMessage";

/**
 * Every Lex catch block used to render `String(err)`, so the server's carefully-worded refusal —
 * "Artifact is not exportable for filing: it must be machine-verified AND human-signed-off." —
 * reached the user with "Error: " welded to the front.
 */
describe("errorMessage", () => {
  it("uses the message the server actually wrote", () => {
    const err = new Error(
      "Artifact is not exportable for filing: it must be machine-verified AND human-signed-off."
    );
    expect(errorMessage(err)).toBe(
      "Artifact is not exportable for filing: it must be machine-verified AND human-signed-off."
    );
    expect(errorMessage(err)).not.toMatch(/^Error:/);
  });

  it("passes a thrown string through unchanged", () => {
    expect(errorMessage("Unauthorized")).toBe("Unauthorized");
  });

  it("never shows a lawyer [object Object]", () => {
    // A rejected fetch or a thrown plain object used to stringify to exactly that.
    for (const thrown of [{ code: 500 }, null, undefined, 42])
      expect(errorMessage(thrown)).toBe("Une erreur est survenue");
  });
});
