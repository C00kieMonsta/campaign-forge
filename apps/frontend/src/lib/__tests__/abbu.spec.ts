import {
  emailsFromValue,
  isBelgianMobile,
  personRecordToRaw,
  readAbbu
} from "../abbu";
import type { ArchiveEntry } from "../archiveIntake";
import { parseBinaryPlist, type PlistDict, type PlistValue } from "../bplist";

jest.mock("../bplist", () => ({
  ...jest.requireActual("../bplist"),
  parseBinaryPlist: jest.fn()
}));

const parseMock = parseBinaryPlist as jest.MockedFunction<
  typeof parseBinaryPlist
>;

/** An Apple multi-value property; `primary` is the index of the primary value. */
function multi(
  values: PlistValue[],
  labels: PlistValue[] = [],
  primary?: number
): PlistDict {
  const identifiers = values.map((_, i) => `id-${i}`);
  const dict: PlistDict = { values, labels, identifiers };
  if (primary !== undefined) dict.primary = identifiers[primary];
  return dict;
}

function person(overrides: PlistDict = {}): PlistDict {
  return { UID: "u1", ABPersonFlags: 0, ...overrides };
}

function fields(record: PlistDict) {
  return personRecordToRaw(record, "id")?.fields;
}

const HOME = "_$!<Home>!$_";
const WORK = "_$!<Work>!$_";
const MOBILE = "_$!<Mobile>!$_";
const MAIN = "_$!<Main>!$_";
const HOME_FAX = "_$!<HomeFAX>!$_";

describe("emailsFromValue", () => {
  it("reads the shapes Apple exports", () => {
    expect(emailsFromValue("Name <a@b.c>")).toEqual(["a@b.c"]);
    expect(emailsFromValue('"a@b.c" <a@b.c>')).toEqual(["a@b.c"]);
    expect(emailsFromValue("mailto:a@b.c")).toEqual(["a@b.c"]);
    expect(emailsFromValue("a @b.c")).toEqual(["a@b.c"]);
    expect(emailsFromValue("free text")).toEqual([]);
  });

  it("reads every angle-bracket group and unquotes inside it", () => {
    expect(emailsFromValue("A <a@x.be>, B <b@x.be>")).toEqual([
      "a@x.be",
      "b@x.be"
    ]);
    expect(emailsFromValue('<"c@x.be">')).toEqual(["c@x.be"]);
    expect(emailsFromValue("Broken <not an email>")).toEqual([]);
  });

  it("does not split on separators", () => {
    expect(emailsFromValue("a@x.be; b@x.be")).toEqual([]);
    expect(emailsFromValue("a@x.be / b@x.be")).toEqual([]);
  });
});

describe("isBelgianMobile", () => {
  it("accepts the ways a Belgian mobile is written", () => {
    expect(isBelgianMobile("0470 12 34 56")).toBe(true);
    expect(isBelgianMobile("+32 470 12 34 56")).toBe(true);
    expect(isBelgianMobile("+32 (0)470 12 34 56")).toBe(true);
    expect(isBelgianMobile("0032470123456")).toBe(true);
    expect(isBelgianMobile("0495/12.34.56")).toBe(true);
  });

  it("refuses landlines and short numbers", () => {
    expect(isBelgianMobile("02 123 45 67")).toBe(false);
    expect(isBelgianMobile("04 212 34 56")).toBe(false);
    expect(isBelgianMobile("0470123")).toBe(false);
    expect(isBelgianMobile("")).toBe(false);
  });
});

describe("personRecordToRaw", () => {
  it("returns null for anything but a dictionary", () => {
    expect(personRecordToRaw(null, "id")).toBeNull();
    expect(personRecordToRaw("text", "id")).toBeNull();
    expect(personRecordToRaw(42, "id")).toBeNull();
    expect(personRecordToRaw([], "id")).toBeNull();
    expect(personRecordToRaw(new Date(), "id")).toBeNull();
    expect(personRecordToRaw(new Uint8Array(2), "id")).toBeNull();
  });

  it("puts the Apple-primary email first, then the others, without repeats", () => {
    const record = person({
      Email: multi(
        ["a@x.be", "Name <b@x.be>", "A@X.BE", "mailto:c@x.be"],
        [],
        1
      )
    });
    expect(personRecordToRaw(record, "id")?.emails).toEqual([
      "b@x.be",
      "a@x.be",
      "c@x.be"
    ]);
  });

  it("keeps the value order when there is no primary", () => {
    const record = person({ Email: multi(["a@x.be", "b@x.be"]) });
    expect(personRecordToRaw(record, "id")?.emails).toEqual([
      "a@x.be",
      "b@x.be"
    ]);
  });

  it("maps names, organization and notes, trimmed", () => {
    const result = personRecordToRaw(
      person({
        First: " Jean ",
        Last: "Dupont",
        Organization: "Acme ",
        Note: " Hello "
      }),
      "rec-1"
    );
    expect(result?.id).toBe("rec-1");
    expect(result?.fields).toEqual({
      firstName: "Jean",
      lastName: "Dupont",
      organization: "Acme",
      notes: "Hello"
    });
    expect(result?.groupNames).toEqual([]);
  });

  it("treats an address typed into a name field as blank and keeps it as an email", () => {
    const result = personRecordToRaw(
      person({ First: "jean@x.be", Last: "Dupont", Email: multi(["a@x.be"]) }),
      "id"
    );
    expect(result?.fields).toEqual({ lastName: "Dupont" });
    expect(result?.emails).toEqual(["a@x.be", "jean@x.be"]);
  });

  it("does not repeat an email already carried by the record", () => {
    const result = personRecordToRaw(
      person({ First: "Jean", Last: "A@X.BE", Email: multi(["a@x.be"]) }),
      "id"
    );
    expect(result?.fields).toEqual({ firstName: "Jean" });
    expect(result?.emails).toEqual(["a@x.be"]);
  });

  it("ignores a name field holding an @ that is not an address", () => {
    const result = personRecordToRaw(
      person({ First: "@jean", Last: "Dupont" }),
      "id"
    );
    expect(result?.fields).toEqual({ lastName: "Dupont" });
    expect(result?.emails).toEqual([]);
  });

  describe("phones", () => {
    it("routes by label, with Belgian mobiles recognised under a blank or Home label", () => {
      expect(fields(person({ Phone: multi(["0470 12 34 56"], [""]) }))).toEqual(
        {
          mobilePhone: "0470 12 34 56"
        }
      );
      expect(fields(person({ Phone: multi(["0470 12 34 56"]) }))).toEqual({
        mobilePhone: "0470 12 34 56"
      });
      expect(
        fields(person({ Phone: multi(["02 123 45 67"], [HOME]) }))
      ).toEqual({
        homePhone: "02 123 45 67"
      });
      expect(
        fields(person({ Phone: multi(["0470 12 34 56"], [HOME]) }))
      ).toEqual({
        mobilePhone: "0470 12 34 56"
      });
      expect(
        fields(person({ Phone: multi(["02 123 45 67"], ["iPhone"]) }))
      ).toEqual({
        mobilePhone: "02 123 45 67"
      });
      expect(
        fields(person({ Phone: multi(["02 123 45 67"], [MOBILE]) }))
      ).toEqual({
        mobilePhone: "02 123 45 67"
      });
      expect(
        fields(person({ Phone: multi(["02 123 45 67"], [WORK]) }))
      ).toEqual({
        businessPhone: "02 123 45 67"
      });
      expect(
        fields(person({ Phone: multi(["02 123 45 67"], [MAIN]) }))
      ).toEqual({
        businessPhone: "02 123 45 67"
      });
    });

    it("skips fax numbers", () => {
      expect(
        fields(person({ Phone: multi(["02 123 45 67"], [HOME_FAX]) }))
      ).toEqual({});
      expect(
        fields(person({ Phone: multi(["02 123 45 67"], ["_$!<WorkFAX>!$_"]) }))
      ).toEqual({});
    });

    it("spills a second mobile into home, a third into business, and drops the rest", () => {
      const record = person({
        Phone: multi(
          ["0470 11 11 11", "0471 22 22 22", "0472 33 33 33", "0473 44 44 44"],
          ["", "", "", ""]
        )
      });
      expect(fields(record)).toEqual({
        mobilePhone: "0470 11 11 11",
        homePhone: "0471 22 22 22",
        businessPhone: "0472 33 33 33"
      });
    });

    it("takes the first free slot when the target is taken, and keeps the original text", () => {
      const record = person({
        Phone: multi(["02 123 45 67 ", " 02 765 43 21"], [HOME, HOME])
      });
      expect(fields(record)).toEqual({
        homePhone: "02 123 45 67",
        mobilePhone: "02 765 43 21"
      });
    });
  });

  describe("addresses", () => {
    it("maps a Home and a Work address, multi-line streets split into street and address 2", () => {
      const record = person({
        Address: multi(
          [
            {
              Street: "Rue de la Loi 16\nBoîte 4\nÉtage 2",
              City: "Bruxelles",
              ZIP: "1000",
              Country: "Belgique",
              CountryCode: "be"
            },
            {
              Street: "Avenue Louise 1\r\nBureau 12",
              City: "Ixelles",
              State: "Bruxelles-Capitale",
              ZIP: "1050",
              Country: "Belgique"
            }
          ],
          [HOME, WORK]
        )
      });
      expect(fields(record)).toEqual({
        homeStreet: "Rue de la Loi 16",
        homeAddress2: "Boîte 4, Étage 2",
        homeCity: "Bruxelles",
        homePostalCode: "1000",
        homeCountry: "Belgique",
        businessAddress: "Avenue Louise 1",
        businessAddress2: "Bureau 12",
        businessCity: "Ixelles",
        businessState: "Bruxelles-Capitale",
        businessPostalCode: "1050",
        businessCountry: "Belgique"
      });
    });

    it("keeps the first address of each kind and sends unlabelled ones home", () => {
      const record = person({
        Address: multi(
          [
            { Street: "First 1", City: "A" },
            { Street: "Second 2", City: "B" },
            { Street: "Other 3", City: "C" }
          ],
          ["", HOME, "_$!<Other>!$_"]
        )
      });
      expect(fields(record)).toEqual({ homeStreet: "First 1", homeCity: "A" });
    });
  });

  describe("birthday", () => {
    it("is the UTC calendar day whatever hour Apple stored", () => {
      for (const hour of [10, 11, 12]) {
        const record = person({
          Birthday: new Date(Date.UTC(1970, 11, 6, hour, 0, 0))
        });
        expect(fields(record)).toEqual({ birthday: "1970-12-06" });
      }
    });

    it("pads month and day", () => {
      const record = person({
        Birthday: new Date(Date.UTC(1985, 0, 3, 11, 0, 0))
      });
      expect(fields(record)).toEqual({ birthday: "1985-01-03" });
    });

    it("drops a birthday without a real year", () => {
      expect(
        fields(person({ Birthday: new Date(Date.UTC(1604, 11, 6, 11)) }))
      ).toEqual({});
      expect(
        fields(person({ Birthday: new Date(Date.UTC(1071, 2, 1, 11)) }))
      ).toEqual({});
      expect(fields(person({ Birthday: "1970-12-06" }))).toEqual({});
    });
  });

  it("reads the company flag", () => {
    expect(
      personRecordToRaw(person({ ABPersonFlags: 1 }), "id")?.isCompany
    ).toBe(true);
    expect(
      personRecordToRaw(person({ ABPersonFlags: 65 }), "id")?.isCompany
    ).toBe(true);
    expect(
      personRecordToRaw(person({ ABPersonFlags: 64 }), "id")?.isCompany
    ).toBe(false);
    expect(personRecordToRaw({ UID: "u1" }, "id")?.isCompany).toBe(false);
  });

  it("omits blanks and still returns a candidate for an empty record", () => {
    const result = personRecordToRaw(
      person({
        First: "  ",
        Last: "",
        Organization: " ",
        Note: "",
        Email: multi([""])
      }),
      "id"
    );
    expect(result).toEqual({
      id: "id",
      emails: [],
      fields: {},
      groupNames: [],
      isCompany: false
    });
  });

  it("ignores malformed multi-values", () => {
    const record = person({
      Email: "a@x.be",
      Phone: { values: "0470" },
      Address: []
    });
    expect(personRecordToRaw(record, "id")).toEqual({
      id: "id",
      emails: [],
      fields: {},
      groupNames: [],
      isCompany: false
    });
  });
});

describe("readAbbu", () => {
  beforeEach(() => parseMock.mockReset());

  function entry(path: string, tag: number, fail = false): ArchiveEntry {
    return {
      path,
      read: async () => {
        if (fail) throw new Error("unreadable file");
        return new Uint8Array([tag]);
      }
    };
  }

  it("collects the readable records, counts the rest, and reports progress", async () => {
    parseMock.mockImplementation((bytes) => {
      const tag = bytes[0];
      if (tag === 2) throw new Error("bad plist");
      if (tag === 3) return "not a record";
      return person({ First: `P${tag}`, Email: multi([`p${tag}@x.be`]) });
    });
    const entries = [
      entry("Sources/S1/Metadata/U1:ABPerson.abcdp", 1),
      entry("Sources/S1/Metadata/U2:ABPerson.abcdp", 2),
      entry("Sources/S1/Metadata/U3:ABPerson.abcdp", 3),
      entry("Sources/S1/Metadata/U4:ABPerson.abcdp", 4, true),
      entry("Metadata/U5:ABPerson.abcdp", 5),
      entry("AddressBook-v22.abcddb", 6)
    ];
    const progress = jest.fn();

    const result = await readAbbu(entries, progress);

    expect(result.raw.map((r) => r.id)).toEqual(["U1:ABPerson", "U5:ABPerson"]);
    expect(result.raw[0].fields).toEqual({ firstName: "P1" });
    expect(result.raw[0].emails).toEqual(["p1@x.be"]);
    expect(result.unreadable).toBe(3);
    expect(parseMock).toHaveBeenCalledTimes(4);
    expect(progress.mock.calls[0]).toEqual([0, 5]);
    expect(progress.mock.calls[progress.mock.calls.length - 1]).toEqual([5, 5]);
    expect(progress).toHaveBeenCalledTimes(6);
  });

  it("works without a progress callback and with no entries", async () => {
    await expect(readAbbu([])).resolves.toEqual({ raw: [], unreadable: 0 });
  });

  it("gets through more than one yield chunk", async () => {
    parseMock.mockImplementation((bytes) => person({ First: `P${bytes[0]}` }));
    const entries = Array.from({ length: 450 }, (_, i) =>
      entry(`Sources/S/Metadata/U${i}:ABPerson.abcdp`, i % 250)
    );
    const progress = jest.fn();

    const result = await readAbbu(entries, progress);

    expect(result.raw).toHaveLength(450);
    expect(result.unreadable).toBe(0);
    expect(progress).toHaveBeenLastCalledWith(450, 450);
  });
});
