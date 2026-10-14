import type { ContactCandidate } from "@packages/types";
import {
  candidateProblems,
  isValidEmail,
  toCreatePayload
} from "../contactCandidates";

function candidate(
  overrides: Partial<ContactCandidate> = {}
): ContactCandidate {
  return {
    id: "c1",
    email: "marie.dupont@gmail.com",
    groupIds: [],
    newGroupNames: [],
    confidence: "high",
    issues: [],
    existing: false,
    ...overrides
  };
}

describe("isValidEmail", () => {
  it("accepts an ordinary address", () => {
    expect(isValidEmail("marie.dupont@gmail.com")).toBe(true);
    expect(isValidEmail("  jan@voorbeeld.be ")).toBe(true);
  });

  it("rejects what an OCR pass typically produces", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("marie.dupont")).toBe(false);
    expect(isValidEmail("marie dupont@gmail.com")).toBe(false);
    expect(isValidEmail("@gmail.com")).toBe(false);
    expect(isValidEmail("marie@gmail")).toBe(false);
    expect(isValidEmail("marie@.com")).toBe(false);
    expect(isValidEmail("marie@gmail.")).toBe(false);
    expect(isValidEmail("marie@@gmail.com")).toBe(false);
  });
});

describe("candidateProblems", () => {
  it("is empty for a clean candidate", () => {
    expect(candidateProblems(candidate(), [])).toEqual([]);
  });

  it("reports a missing email", () => {
    expect(candidateProblems(candidate({ email: "" }), [])).toEqual([
      "missingEmail"
    ]);
    expect(candidateProblems(candidate({ email: "   " }), [])).toEqual([
      "missingEmail"
    ]);
  });

  it("reports an invalid email", () => {
    expect(
      candidateProblems(candidate({ email: "marie at gmail" }), [])
    ).toEqual(["invalidEmail"]);
  });

  it("reports a duplicate against the other selected candidates, case-insensitively", () => {
    expect(
      candidateProblems(candidate({ email: "Marie.Dupont@Gmail.com" }), [
        "jan@voorbeeld.be",
        "marie.dupont@gmail.com"
      ])
    ).toEqual(["duplicateInBatch"]);
    expect(candidateProblems(candidate(), ["jan@voorbeeld.be"])).toEqual([]);
  });

  it("does not stack the email problems", () => {
    expect(candidateProblems(candidate({ email: "" }), [""])).toEqual([
      "missingEmail"
    ]);
  });

  it("adds existing after the email problems", () => {
    expect(candidateProblems(candidate({ existing: true }), [])).toEqual([
      "existing"
    ]);
    expect(
      candidateProblems(candidate({ existing: true }), [
        "marie.dupont@gmail.com"
      ])
    ).toEqual(["duplicateInBatch", "existing"]);
  });
});

describe("toCreatePayload", () => {
  it("keeps the email and the non-empty fields, trimmed", () => {
    const payload = toCreatePayload(
      candidate({
        email: " marie.dupont@gmail.com ",
        firstName: " Marie ",
        lastName: "Dupont",
        mobilePhone: "",
        organization: "   ",
        notes: "Rencontrée au marché"
      }),
      []
    );
    expect(payload).toEqual({
      email: "marie.dupont@gmail.com",
      firstName: "Marie",
      lastName: "Dupont",
      notes: "Rencontrée au marché"
    });
    expect(payload).not.toHaveProperty("mobilePhone");
    expect(payload).not.toHaveProperty("organization");
  });

  it("sends the group ids it is given, not the candidate's own lists", () => {
    const payload = toCreatePayload(
      candidate({ groupIds: ["g-server"], newGroupNames: ["Thermomix"] }),
      ["g1", "g2"]
    );
    expect(payload.groups).toEqual(["g1", "g2"]);
    expect(payload).not.toHaveProperty("groupIds");
    expect(payload).not.toHaveProperty("newGroupNames");
  });

  it("leaves groups undefined when there are none", () => {
    expect(toCreatePayload(candidate(), []).groups).toBeUndefined();
  });

  it("never sends the review-only fields", () => {
    const payload = toCreatePayload(
      candidate({
        confidence: "low",
        issues: ["chiffre illisible"],
        existing: true
      }),
      []
    );
    for (const key of ["id", "confidence", "issues", "existing"])
      expect(payload).not.toHaveProperty(key);
  });
});
