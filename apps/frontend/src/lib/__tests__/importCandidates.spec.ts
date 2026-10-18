import {
  autofillNames,
  buildBatch,
  cleanEmail,
  csvToRawCandidates,
  isComplete,
  nameFromEmail,
  toCreateRequest,
  type ImportCandidate,
  type RawCandidate
} from "../importCandidates";

const SALUTATION = "Madame, Monsieur";

function raw(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    id: "r1",
    emails: [],
    fields: {},
    groupNames: [],
    isCompany: false,
    ...overrides
  };
}

function candidate(overrides: Partial<ImportCandidate> = {}): ImportCandidate {
  return {
    id: "c1",
    email: "jean.dupont@x.be",
    fields: {},
    groupNames: [],
    isCompany: false,
    needsName: true,
    ...overrides
  };
}

function batch(
  records: RawCandidate[],
  existing: string[] = [],
  groups: string[] = []
) {
  return buildBatch(records, new Set(existing), new Set(groups));
}

describe("cleanEmail", () => {
  it("unwraps the shapes Apple exports", () => {
    expect(cleanEmail("mailto:x@example.com")).toBe("x@example.com");
    expect(cleanEmail("MAILTO:x@example.com")).toBe("x@example.com");
    expect(cleanEmail("Name <a@example.com>")).toBe("a@example.com");
    expect(cleanEmail('"b@example.com"')).toBe("b@example.com");
    expect(cleanEmail("c @example.com")).toBe("c@example.com");
    expect(cleanEmail("  d@example.com  ")).toBe("d@example.com");
  });

  it("refuses what the server would refuse", () => {
    expect(cleanEmail("x@example.com>")).toBeNull();
    expect(cleanEmail("a&b@example.com")).toBeNull();
    expect(cleanEmail("élodie@example.com")).toBeNull();
    expect(cleanEmail("")).toBeNull();
    expect(cleanEmail("   ")).toBeNull();
    expect(cleanEmail("not an email")).toBeNull();
  });
});

describe("buildBatch", () => {
  it("skips a record whose email or second email already exists", () => {
    const result = batch(
      [
        raw({ id: "a", emails: ["A@X.BE"] }),
        raw({ id: "b", emails: ["new@x.be", "a@x.be"] }),
        raw({ id: "c", emails: ["fresh@x.be"] })
      ],
      ["a@x.be"]
    );
    expect(result.alreadyPresent).toBe(2);
    expect(result.candidates.map((c) => c.id)).toEqual(["c"]);
  });

  it("counts a record without a valid email as withoutEmail", () => {
    const result = batch([
      raw({ emails: [] }),
      raw({ emails: ["not an email", "x@example.com>"] }),
      raw({ emails: ["ok@x.be"] })
    ]);
    expect(result.withoutEmail).toBe(2);
    expect(result.candidates).toHaveLength(1);
  });

  it("settles the first email as primary and the second as email2 only when blank", () => {
    const result = batch([
      raw({ id: "a", emails: ["mailto:a@x.be", "b@x.be", "B@X.BE", "c@x.be"] }),
      raw({
        id: "b",
        emails: ["d@x.be", "e@x.be"],
        fields: { email2: "pre@x.be" }
      })
    ]);
    const [a, b] = result.candidates;
    expect(a.email).toBe("a@x.be");
    expect(a.fields.email2).toBe("b@x.be");
    expect(b.email).toBe("d@x.be");
    expect(b.fields.email2).toBe("pre@x.be");
  });

  it("merges a later duplicate on the primary address", () => {
    const result = batch([
      raw({
        id: "a",
        emails: ["a@x.be"],
        fields: { firstName: "Jean", organization: "" },
        groupNames: ["Amis"]
      }),
      raw({
        id: "b",
        emails: ["A@X.BE", "c@x.be"],
        fields: {
          firstName: "Other",
          lastName: "Dupont",
          organization: "Acme"
        },
        groupNames: ["amis", "Famille"],
        isCompany: true
      })
    ]);
    expect(result.candidates).toHaveLength(1);
    expect(result.duplicatesInFile).toBe(1);
    const [merged] = result.candidates;
    expect(merged.id).toBe("a");
    expect(merged.email).toBe("a@x.be");
    expect(merged.fields).toEqual({
      firstName: "Jean",
      lastName: "Dupont",
      organization: "Acme",
      email2: "c@x.be"
    });
    expect(merged.groupNames).toEqual(["Amis", "Famille"]);
    expect(merged.isCompany).toBe(true);
    expect(merged.needsName).toBe(false);
  });

  it("merges a later duplicate on an earlier email2", () => {
    const result = batch([
      raw({
        id: "a",
        emails: ["a@x.be", "b@x.be"],
        fields: { firstName: "Jean" }
      }),
      raw({ id: "b", emails: ["b@x.be"], fields: { lastName: "Dupont" } })
    ]);
    expect(result.candidates).toHaveLength(1);
    expect(result.duplicatesInFile).toBe(1);
    expect(result.candidates[0].fields).toEqual({
      firstName: "Jean",
      lastName: "Dupont",
      email2: "b@x.be"
    });
  });

  it("folds three copies into one candidate, following the later record's addresses", () => {
    const result = batch([
      raw({ id: "a", emails: ["a@x.be"] }),
      raw({ id: "b", emails: ["a@x.be", "c@x.be"] }),
      raw({
        id: "c",
        emails: ["c@x.be"],
        fields: { firstName: "Jean", lastName: "Dupont" }
      })
    ]);
    expect(result.candidates).toHaveLength(1);
    expect(result.duplicatesInFile).toBe(2);
    expect(result.candidates[0].fields).toEqual({
      firstName: "Jean",
      lastName: "Dupont",
      email2: "c@x.be"
    });
    expect(result.candidates[0].needsName).toBe(false);
  });

  it("folds two earlier candidates together when a later record carries both addresses", () => {
    const out = buildBatch(
      [
        raw({ id: "a", emails: ["a@x.be"], fields: { firstName: "Ann" } }),
        raw({ id: "b", emails: ["b@x.be"], fields: { lastName: "Berg" } }),
        raw({ id: "ab", emails: ["a@x.be", "b@x.be"], groupNames: ["VIP"] })
      ],
      new Set(),
      new Set()
    );
    expect(out.candidates).toHaveLength(1);
    expect(out.duplicatesInFile).toBe(2);
    const [c] = out.candidates;
    expect(c.email).toBe("a@x.be");
    expect(c.fields).toMatchObject({
      firstName: "Ann",
      lastName: "Berg",
      email2: "b@x.be"
    });
    expect(c.groupNames).toEqual(["VIP"]);
    expect(c.needsName).toBe(false);
  });

  it("keeps a candidate that was flagged needsName flagged while a name is still missing", () => {
    const result = batch([
      raw({ id: "a", emails: ["a@x.be"], fields: { firstName: "Jean" } }),
      raw({ id: "b", emails: ["a@x.be"], fields: { firstName: "Other" } })
    ]);
    expect(result.candidates[0].needsName).toBe(true);
  });

  it("flags needsName at build time", () => {
    const result = batch([
      raw({
        id: "a",
        emails: ["a@x.be"],
        fields: { firstName: "Jean", lastName: "Dupont" }
      }),
      raw({
        id: "b",
        emails: ["b@x.be"],
        fields: { firstName: "Jean", lastName: "  " }
      }),
      raw({ id: "c", emails: ["c@x.be"] })
    ]);
    expect(result.candidates.map((c) => c.needsName)).toEqual([
      false,
      true,
      true
    ]);
  });

  it("keeps group names unique ignoring case and collects the ones to create", () => {
    const result = batch(
      [
        raw({
          id: "a",
          emails: ["a@x.be"],
          groupNames: ["Amis", "amis", " Famille ", ""]
        }),
        raw({ id: "b", emails: ["b@x.be"], groupNames: ["AMIS", "Club"] }),
        raw({ id: "c", emails: ["c@x.be"], groupNames: ["Oublié"] }),
        raw({ id: "d", emails: [], groupNames: ["Ignoré"] })
      ],
      ["c@x.be"],
      ["famille"]
    );
    expect(result.candidates[0].groupNames).toEqual(["Amis", "Famille"]);
    expect(result.candidates[1].groupNames).toEqual(["AMIS", "Club"]);
    expect(result.newGroupNames).toEqual(["Amis", "Club"]);
  });

  it("does not mutate the raw records", () => {
    const first = raw({
      id: "a",
      emails: ["a@x.be"],
      fields: { firstName: "Jean" }
    });
    const second = raw({
      id: "b",
      emails: ["a@x.be"],
      fields: { lastName: "Dupont" }
    });
    batch([first, second]);
    expect(first.fields).toEqual({ firstName: "Jean" });
    expect(second.fields).toEqual({ lastName: "Dupont" });
  });
});

describe("isComplete", () => {
  it("needs both names, blanks do not count", () => {
    expect(
      isComplete({ fields: { firstName: "Jean", lastName: "Dupont" } })
    ).toBe(true);
    expect(isComplete({ fields: { firstName: "Jean" } })).toBe(false);
    expect(isComplete({ fields: { firstName: "Jean", lastName: " " } })).toBe(
      false
    );
    expect(isComplete({ fields: {} })).toBe(false);
  });
});

describe("nameFromEmail", () => {
  it("reads first and last from a dotted local part", () => {
    expect(nameFromEmail("jean.dupont@x.be")).toEqual({
      firstName: "Jean",
      lastName: "Dupont"
    });
    expect(nameFromEmail("Jean.DUPONT@x.be")).toEqual({
      firstName: "Jean",
      lastName: "Dupont"
    });
  });

  it("keeps the first and the last token of a longer local part", () => {
    expect(nameFromEmail("jean-pierre_van.damme@x.be")).toEqual({
      firstName: "Jean",
      lastName: "Damme"
    });
  });

  it("gives a last name only for a single token of three letters or more", () => {
    expect(nameFromEmail("jdupont@x.be")).toEqual({ lastName: "Jdupont" });
    expect(nameFromEmail("jp@x.be")).toEqual({});
  });

  it("strips digits", () => {
    expect(nameFromEmail("marie.dupont1962@x.be")).toEqual({
      firstName: "Marie",
      lastName: "Dupont"
    });
  });

  it("keeps and capitalizes unicode letters", () => {
    expect(nameFromEmail("élodie.vds@x.be")).toEqual({
      firstName: "Élodie",
      lastName: "Vds"
    });
  });

  it("gives nothing for a mailbox word written with a separator", () => {
    expect(nameFromEmail("no-reply@x.be")).toEqual({});
    expect(nameFromEmail("no.reply@x.be")).toEqual({});
  });

  it("drops generic mailbox words", () => {
    expect(nameFromEmail("info.acme@x.be")).toEqual({ lastName: "Acme" });
    expect(nameFromEmail("info@x.be")).toEqual({});
    expect(nameFromEmail("noreply@x.be")).toEqual({});
  });
});

describe("autofillNames", () => {
  it("returns the same object when the candidate is complete", () => {
    const c = candidate({ fields: { firstName: "Jean", lastName: "Dupont" } });
    expect(autofillNames(c, SALUTATION)).toBe(c);
  });

  it("fills only the blank name, leaves the rest alone and keeps needsName", () => {
    const c = candidate({
      fields: { firstName: "Marie", organization: "Acme" },
      needsName: true
    });
    const filled = autofillNames(c, SALUTATION);
    expect(filled).not.toBe(c);
    expect(filled.fields).toEqual({
      firstName: "Marie",
      lastName: "Dupont",
      organization: "Acme"
    });
    expect(filled.needsName).toBe(true);
    expect(c.fields).toEqual({ firstName: "Marie", organization: "Acme" });
  });

  it("splits a full name typed into one field at its last space", () => {
    expect(
      autofillNames(
        candidate({ fields: { firstName: "Marie Dupont" } }),
        SALUTATION
      ).fields
    ).toEqual({ firstName: "Marie", lastName: "Dupont" });
    expect(
      autofillNames(
        candidate({ fields: { lastName: "Marie Dupont" } }),
        SALUTATION
      ).fields
    ).toEqual({ firstName: "Marie", lastName: "Dupont" });
    expect(
      autofillNames(
        candidate({ fields: { lastName: "Jean Pierre Van Damme" } }),
        SALUTATION
      ).fields
    ).toEqual({ firstName: "Jean Pierre Van", lastName: "Damme" });
  });

  it("does not split its own salutation on a second pass", () => {
    const once = autofillNames(
      candidate({ email: "jp@x.be", fields: {} }),
      SALUTATION
    );
    const cleared = { ...once, fields: { ...once.fields, lastName: "" } };
    const twice = autofillNames(cleared, SALUTATION);
    expect(twice.fields.firstName).toBe(SALUTATION);
    expect(twice.fields.lastName).toBe(SALUTATION);
  });

  it("keeps a last name that starts with a particle whole", () => {
    const out = autofillNames(
      candidate({ email: "jp@x.be", fields: { lastName: "van der Berg" } }),
      SALUTATION
    );
    expect(out.fields.firstName).toBe(SALUTATION);
    expect(out.fields.lastName).toBe("van der Berg");
  });

  it("treats a mailbox word kept as a name as blank", () => {
    const out = autofillNames(
      candidate({ email: "info@x.be", fields: { firstName: "Info" } }),
      SALUTATION
    );
    expect(out.fields.firstName).toBe(SALUTATION);
    expect(out.fields.lastName).toBe(SALUTATION);
    const withOrg = autofillNames(
      candidate({
        email: "contact@x.be",
        fields: { lastName: "Contact", organization: "Acme" }
      }),
      SALUTATION
    );
    expect(withOrg.fields).toMatchObject({
      firstName: SALUTATION,
      lastName: "Acme"
    });
  });

  it("uses the organization as last name on a company card", () => {
    const generic = candidate({
      email: "info@acme.be",
      isCompany: true,
      fields: { organization: "Acme" }
    });
    expect(autofillNames(generic, SALUTATION).fields).toEqual({
      firstName: SALUTATION,
      lastName: "Acme",
      organization: "Acme"
    });
    const personal = candidate({
      email: "jean.dupont@acme.be",
      isCompany: true,
      fields: { organization: "Acme" }
    });
    expect(autofillNames(personal, SALUTATION).fields).toEqual({
      firstName: SALUTATION,
      lastName: "Acme",
      organization: "Acme"
    });
  });

  it("guesses a person's name from the email before the organization", () => {
    const c = candidate({
      email: "jean.dupont@acme.be",
      fields: { organization: "Acme" }
    });
    expect(autofillNames(c, SALUTATION).fields).toEqual({
      firstName: "Jean",
      lastName: "Dupont",
      organization: "Acme"
    });
  });

  it("falls back to the salutation for a generic mailbox without organization", () => {
    const c = candidate({ email: "info@x.be" });
    expect(autofillNames(c, SALUTATION).fields).toEqual({
      firstName: SALUTATION,
      lastName: SALUTATION
    });
  });

  it("uses the organization as last name for a generic mailbox on a person card", () => {
    const c = candidate({
      email: "info@x.be",
      fields: { organization: "Acme" }
    });
    expect(autofillNames(c, SALUTATION).fields).toEqual({
      firstName: SALUTATION,
      lastName: "Acme",
      organization: "Acme"
    });
  });

  it("uses a single token as last name and the salutation as first name", () => {
    const c = candidate({ email: "jdupont@x.be" });
    expect(autofillNames(c, SALUTATION).fields).toEqual({
      firstName: SALUTATION,
      lastName: "Jdupont"
    });
  });

  it("uses the squashed local part as last name when nothing else is left", () => {
    expect(
      autofillNames(candidate({ email: "j.p.d@x.be" }), SALUTATION).fields
    ).toEqual({
      firstName: SALUTATION,
      lastName: "Jpd"
    });
    expect(
      autofillNames(candidate({ email: "jp@x.be" }), SALUTATION).fields
    ).toEqual({
      firstName: SALUTATION,
      lastName: SALUTATION
    });
  });

  it("always returns a complete candidate", () => {
    const cases = [
      candidate({ email: "a@x.be" }),
      candidate({ email: "info@x.be", isCompany: true }),
      candidate({ email: "1234@x.be" }),
      candidate({ email: "jean.dupont@x.be", fields: { lastName: " " } }),
      candidate({ email: "x@x.be", fields: { firstName: "Solo" } })
    ];
    for (const c of cases)
      expect(isComplete(autofillNames(c, SALUTATION))).toBe(true);
  });
});

describe("toCreateRequest", () => {
  it("trims and truncates to the server maxima", () => {
    const c = candidate({
      email: " jean.dupont@x.be ",
      fields: {
        firstName: "  Jean  ",
        lastName: "D".repeat(150),
        notes: "n".repeat(2500),
        homePostalCode: "1".repeat(30),
        organization: "   "
      }
    });
    const payload = toCreateRequest(c, []);
    expect(payload.email).toBe("jean.dupont@x.be");
    expect(payload.status).toBe("subscribed");
    expect(payload.firstName).toBe("Jean");
    expect(payload.lastName).toHaveLength(100);
    expect(payload.notes).toHaveLength(2000);
    expect(payload.homePostalCode).toHaveLength(20);
    expect(payload).not.toHaveProperty("organization");
  });

  it("cleans email2 or drops it", () => {
    expect(
      toCreateRequest(candidate({ fields: { email2: "mailto:b@x.be" } }), [])
        .email2
    ).toBe("b@x.be");
    expect(
      toCreateRequest(candidate({ fields: { email2: "Name <c@x.be>" } }), [])
        .email2
    ).toBe("c@x.be");
    expect(
      toCreateRequest(candidate({ fields: { email2: "not an email" } }), [])
    ).not.toHaveProperty("email2");
  });

  it("keeps a birthday only in YYYY-MM-DD form", () => {
    expect(
      toCreateRequest(candidate({ fields: { birthday: "1970-12-06" } }), [])
        .birthday
    ).toBe("1970-12-06");
    expect(
      toCreateRequest(candidate({ fields: { birthday: "06/12/1970" } }), [])
    ).not.toHaveProperty("birthday");
  });

  it("sends groups only when there are some", () => {
    expect(toCreateRequest(candidate(), []).groups).toBeUndefined();
    expect(toCreateRequest(candidate(), ["g1", "g2"]).groups).toEqual([
      "g1",
      "g2"
    ]);
  });

  it("never sends the review bookkeeping", () => {
    const payload = toCreateRequest(
      candidate({ groupNames: ["Amis"], isCompany: true, needsName: true }),
      []
    );
    expect(payload).not.toHaveProperty("needsName");
    expect(payload).not.toHaveProperty("isCompany");
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("groupNames");
  });
});

describe("csvToRawCandidates", () => {
  it("reads the template columns, headers matched ignoring case", () => {
    const text = [
      "first name,LAST NAME, E-mail Address ,E-MAIL 2 ADDRESS,Organization,Group",
      "Jean,Dupont,jean@x.be,jean2@x.be,Acme,Amis; Famille ;",
      ",,marie@x.be,,,"
    ].join("\n");
    const rows = csvToRawCandidates(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: "csv-0",
      emails: ["jean@x.be", "jean2@x.be"],
      fields: { firstName: "Jean", lastName: "Dupont", organization: "Acme" },
      groupNames: ["Amis", "Famille"],
      isCompany: false
    });
    expect(rows[1]).toEqual({
      id: "csv-1",
      emails: ["marie@x.be"],
      fields: {},
      groupNames: [],
      isCompany: false
    });
  });

  it("leaves email2 to the batch rules rather than the fields", () => {
    const [row] = csvToRawCandidates(
      "E-mail Address,E-mail 2 Address\na@x.be,b@x.be"
    );
    expect(row.fields).toEqual({});
    expect(row.emails).toEqual(["a@x.be", "b@x.be"]);
  });

  it("gives nothing for an empty or header-only file", () => {
    expect(csvToRawCandidates("")).toEqual([]);
    expect(csvToRawCandidates("   \n")).toEqual([]);
    expect(csvToRawCandidates("First Name,Last Name,E-mail Address\n")).toEqual(
      []
    );
  });
});
