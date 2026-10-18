import { isBinaryPlist, parseBinaryPlist, PlistUid } from "../bplist";
import type { PlistDict, PlistValue } from "../bplist";

// Fixtures generated with `plutil -convert binary1` from hand-written XML plists holding only fake data.
const PERSON_B64 =
  "YnBsaXN0MDDcAQIDBAUGBwgJCgsMDQ4PHR4fICEiMTJJXE9yZ2FuaXphdGlvblNVSURVRW1haWxVRmlyc3RYQ3JlYXRpb25UTGFzdFROb3RlWEJpcnRoZGF5VVBob25lXUFCUGVyc29uRmxhZ3NXQWRkcmVzc1ZNaWRkbGVfEBJCb3VsYW5nZXJpZSBTb2xlaWxfEC0xMTExMTExMS0yMjIyLTMzMzMtNDQ0NC01NTU1NTU1NTU1NTU6QUJQZXJzb27UEBESExQXFhpbaWRlbnRpZmllcnNWdmFsdWVzV3ByaW1hcnlWbGFiZWxzohUWVkUtSUQtMVZFLUlELTKiGBlfEBVlbG9kaWVAc29sZWlsLmV4YW1wbGVfEBZFbG9kaWUuVkRTQGV4YW1wbGUub3JnohscXF8kITxXb3JrPiEkX1xfJCE8SG9tZT4hJF9mAMkAbABvAGQAaQBlM0HFrJhxgAAAXxAQVmFuIGRlciBTdHJhZXRlbm8QHQBSAGUAbgBjAG8AbgB0AHIA6QBlACAAYQB1ACAAbQBhAHIAYwBoAOkAIABkAGUAIABXAGEAdgByAGUzwcxIIKgAAADUEBESEyMoJC2kJCUmJ1ZQLUlELTFWUC1JRC0yVlAtSUQtM1ZQLUlELTSkKSorLF8QECszMiA0NzAgMDAgMDAgMDFcMDIgMDAwIDAwIDAyXDAyIDAwMCAwMCAwM18QECszMiA0NzAgMDAgMDAgMDSkLi8bMF5fJCE8TW9iaWxlPiEkX1BeXyQhPGlQaG9uZT4hJF8QANQQERITMzY0SKI0NVZBLUlELTFWQS1JRC0yojdC1Tg5Ojs8PT4/QEFWU3RyZWV0U1pJUFRDaXR5W0NvdW50cnlDb2RlV0NvdW50cnlvEBkAUgB1AGUAIABkAGUAcwAgAEYAbABlAHUAcgBzACAAMQAyAAoAQgBvAO4AdABlACAAM1QxMzAwVVdhdnJlUmJlWEJlbGdpcXVl1Tg5OkM8REVGR0FVU3RhdGVfEBBBdmVudWUgZHUgUGFpbiAxVDEwMDBZQnJ1eGVsbGVzV0JyYWJhbnSiHBtVTWFyaWUACAAhAC4AMgA4AD4ARwBMAFEAWgBgAG4AdgB9AJIAwgDLANcA3gDmAO0A8AD3AP4BAQEZATIBNQFCAU8BXAFlAXgBtQG+AccBzAHTAdoB4QHoAe0CAAINAhoCLQIyAkECQgJRAlMCXAJfAmYCbQJwAnsCggKGAosClwKfAtQC2QLfAuIC6wL2AvwDDwMUAx4DJgMpAAAAAAAAAgEAAAAAAAAASgAAAAAAAAAAAAAAAAAAAy8=";

const COMPANY_B64 =
  "YnBsaXN0MDDWAQIDBAUGBwgJChQVU1VJRFxPcmdhbml6YXRpb25YQmlydGhkYXlVRW1haWxdQUJQZXJzb25GbGFnc1VQaG9uZV8QLUFBQUFBQUFBLUJCQkItQ0NDQy1ERERELUVFRUVFRUVFRUVFRTpBQlBlcnNvbl8QFEN1aXNpbmVzIER1cG9udCBTUFJMM8IHUz4igAAA0wsMDQ4QEltpZGVudGlmaWVyc1ZsYWJlbHNWdmFsdWVzoQ9WRS1JRC05oRFQoRNfEBxpbmZvQGN1aXNpbmVzLWR1cG9udC5leGFtcGxlEAHTCwwNFhgaoRdWUC1JRC05oRlcXyQhPE1haW4+ISRfoRtcMDEwIDAwIDAwIDA5AAgAFQAZACYALwA1AEMASQB5AJAAmQCgAKwAswC6ALwAwwDFAMYAyADnAOkA8ADyAPkA+wEIAQoAAAAAAAACAQAAAAAAAAAcAAAAAAAAAAAAAAAAAAABFw==";

const TYPES_B64 =
  "YnBsaXN0MDDfEBQBAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZHR8gISIjKCkqKyw8PT4/VnJlYWw2NFJpOFNpNjRSaTBTYXJyUXRRZlVlbXB0eVRsb25nVnJlYWwzMlZuZXN0ZWRTaTE2VGRhdGVTdWlkU2kzMlZiaWdhcnJTbmVnVWFzY2lpVXV0ZjE2VGRhdGEjQAkh+1RELRgQyBMAH////////xAAoxobHBABU3R3b6EdCQkIUF8RAT14eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eCM/+AAAAAAAANEkJVFr0SYnVGRlZXBRdhGcQDMAAAAAAAAAAIAHErLQXgCvEBAaLS4vMDEyMzQ1Njc4OTo7EAIQAxAEEAUQBhAHEAgQCRAKEAsQDBANEA4QDxAQE//////////7W3BsYWluIGFzY2lpbxARAEMAYQBmAOkAIADgACAAbAAnAOkAdADpACDYPd4AACAA30UAAQID/wAIADMAOgA9AEEARABIAEoATABSAFcAXgBlAGkAbgByAHYAfQCBAIcAjQCSAJsAnQCmAKgArACuALIAtAC1ALYAtwC4AfkCAgIFAgcCCgIPAhECFAIdAh8CJAI3AjkCOwI9Aj8CQQJDAkUCRwJJAksCTQJPAlECUwJVAl4CagKPAAAAAAAAAgEAAAAAAAAAQAAAAAAAAAAAAAAAAAAAApU=";

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function ascii(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0));
}

/** Builds a bplist00 file from raw object bytes with 1-byte offsets and references. */
function buildPlist(objects: number[][], topObject = 0): Uint8Array {
  const header = ascii("bplist00");
  const body: number[] = [];
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(header.length + body.length);
    body.push(...obj);
  }
  const tableOffset = header.length + body.length;
  const trailer = [
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    ...be64(objects.length),
    ...be64(topObject),
    ...be64(tableOffset)
  ];
  return new Uint8Array([...header, ...body, ...offsets, ...trailer]);
}

function be64(value: number): number[] {
  const out = new Array<number>(8).fill(0);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

function dict(value: unknown): PlistDict {
  expect(value).not.toBeNull();
  expect(typeof value).toBe("object");
  return value as PlistDict;
}

describe("isBinaryPlist", () => {
  it("recognises the bplist magic", () => {
    expect(isBinaryPlist(fromBase64(PERSON_B64))).toBe(true);
    expect(isBinaryPlist(new Uint8Array(ascii("bplist00")))).toBe(true);
  });

  it("rejects other bytes", () => {
    expect(isBinaryPlist(new Uint8Array(0))).toBe(false);
    expect(isBinaryPlist(new Uint8Array(ascii("bpl")))).toBe(false);
    expect(isBinaryPlist(new Uint8Array(ascii("<?xml version")))).toBe(false);
  });
});

describe("parseBinaryPlist with the types fixture", () => {
  const root = dict(parseBinaryPlist(fromBase64(TYPES_B64)));

  it("decodes booleans and integers of every size", () => {
    expect(root.t).toBe(true);
    expect(root.f).toBe(false);
    expect(root.i0).toBe(0);
    expect(root.i8).toBe(200);
    expect(root.i16).toBe(40000);
    expect(root.i32).toBe(3000000000);
    expect(root.i64).toBe(9007199254740991);
    expect(root.neg).toBe(-5);
  });

  it("decodes reals", () => {
    expect(root.real32).toBe(1.5);
    expect(root.real64).toBe(3.141592653589793);
  });

  it("decodes the date as seconds since 2001", () => {
    expect(root.date).toBeInstanceOf(Date);
    expect((root.date as Date).getTime()).toBe(Date.UTC(2001, 0, 1, 0, 0, 0));
    expect((root.date as Date).toISOString()).toBe("2001-01-01T00:00:00.000Z");
  });

  it("decodes data as bytes", () => {
    expect(root.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(root.data as Uint8Array)).toEqual([0, 1, 2, 3, 255]);
  });

  it("decodes nested arrays and dicts", () => {
    expect(root.arr).toEqual([1, "two", [true]]);
    expect(root.nested).toEqual({ k: { deep: "v" } });
  });

  it("decodes an array whose count needs the extended form", () => {
    expect(root.bigarr).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
    ]);
  });

  it("decodes a UID", () => {
    expect(root.uid).toBeInstanceOf(PlistUid);
    expect((root.uid as PlistUid).id).toBe(7);
  });

  it("decodes ASCII, UTF-16 and empty strings", () => {
    expect(root.ascii).toBe("plain ascii");
    expect(root.utf16).toBe("Café à l'été 😀 ß");
    expect(root.empty).toBe("");
    expect(typeof root.long).toBe("string");
    expect((root.long as string).length).toBe(317);
    expect(root.long).toBe("x".repeat(317));
  });

  it("has exactly the keys of the XML source", () => {
    expect(Object.keys(root).sort()).toEqual(
      [
        "arr",
        "ascii",
        "bigarr",
        "data",
        "date",
        "empty",
        "f",
        "i0",
        "i16",
        "i32",
        "i64",
        "i8",
        "long",
        "neg",
        "nested",
        "real32",
        "real64",
        "t",
        "uid",
        "utf16"
      ].sort()
    );
  });
});

describe("parseBinaryPlist with the person fixture", () => {
  const root = dict(parseBinaryPlist(fromBase64(PERSON_B64)));

  it("decodes the names", () => {
    expect(root.First).toBe("Élodie");
    expect(root.Last).toBe("Van der Straeten");
    expect(root.Middle).toBe("Marie");
    expect(root.Organization).toBe("Boulangerie Soleil");
    expect(root.Note).toBe("Rencontrée au marché de Wavre");
    expect(root.ABPersonFlags).toBe(0);
    expect(root.UID).toBe("11111111-2222-3333-4444-555555555555:ABPerson");
  });

  it("decodes the multi-value email property", () => {
    const email = dict(root.Email);
    expect(email.values).toEqual([
      "elodie@soleil.example",
      "Elodie.VDS@example.org"
    ]);
    expect(email.identifiers).toEqual(["E-ID-1", "E-ID-2"]);
    expect(email.labels).toEqual(["_$!<Work>!$_", "_$!<Home>!$_"]);
    expect(email.primary).toBe("E-ID-2");
  });

  it("decodes shared string objects without reporting a cycle", () => {
    const phone = dict(root.Phone);
    expect(phone.labels).toEqual([
      "_$!<Mobile>!$_",
      "",
      "_$!<Work>!$_",
      "_$!<iPhone>!$_"
    ]);
    expect(phone.values).toEqual([
      "+32 470 00 00 01",
      "02 000 00 02",
      "02 000 00 03",
      "+32 470 00 00 04"
    ]);
    const address = dict(root.Address);
    expect(address.labels).toEqual(["_$!<Home>!$_", "_$!<Work>!$_"]);
  });

  it("keeps the newline inside a street", () => {
    const values = dict(root.Address).values as PlistValue[];
    const home = dict(values[0]);
    expect(home.Street).toBe("Rue des Fleurs 12\nBoîte 3");
    expect(home.City).toBe("Wavre");
    expect(home.ZIP).toBe("1300");
    expect(home.Country).toBe("Belgique");
    expect(home.CountryCode).toBe("be");
    const work = dict(values[1]);
    expect(work.Street).toBe("Avenue du Pain 1");
    expect(work.State).toBe("Brabant");
  });

  it("decodes the birthday and creation dates", () => {
    expect(root.Birthday).toBeInstanceOf(Date);
    expect((root.Birthday as Date).getTime()).toBe(
      Date.UTC(1970, 11, 6, 11, 0, 0)
    );
    expect((root.Birthday as Date).toISOString()).toBe(
      "1970-12-06T11:00:00.000Z"
    );
    expect((root.Creation as Date).toISOString()).toBe(
      "2024-01-18T10:11:47.000Z"
    );
  });
});

describe("parseBinaryPlist with the company fixture", () => {
  const root = dict(parseBinaryPlist(fromBase64(COMPANY_B64)));

  it("decodes the company flag and fields", () => {
    expect(root.ABPersonFlags).toBe(1);
    expect(root.Organization).toBe("Cuisines Dupont SPRL");
    expect(root.First).toBeUndefined();
    expect(dict(root.Email).values).toEqual(["info@cuisines-dupont.example"]);
    expect(dict(root.Email).labels).toEqual([""]);
    expect(dict(root.Phone).labels).toEqual(["_$!<Main>!$_"]);
  });

  it("decodes a birthday far before 1970", () => {
    const birthday = root.Birthday as Date;
    expect(birthday).toBeInstanceOf(Date);
    expect(birthday.getUTCFullYear()).toBe(1604);
    expect(birthday.getTime()).toBe(Date.UTC(1604, 2, 5, 11, 0, 0));
  });
});

describe("parseBinaryPlist with hand-built objects", () => {
  it("decodes null and the fill byte", () => {
    expect(parseBinaryPlist(buildPlist([[0x00]]))).toBeNull();
    expect(parseBinaryPlist(buildPlist([[0x0f]]))).toBeNull();
  });

  it("decodes a 16-byte integer from its low 8 bytes", () => {
    const bytes = [
      0x14,
      ...new Array<number>(8).fill(0),
      0,
      0,
      0,
      0,
      0,
      0,
      0x01,
      0x00
    ];
    expect(parseBinaryPlist(buildPlist([bytes]))).toBe(256);
    const negative = [
      0x14,
      ...new Array<number>(8).fill(0xff),
      ...new Array<number>(7).fill(0xff),
      0xfe
    ];
    expect(parseBinaryPlist(buildPlist([negative]))).toBe(-2);
  });

  it("decodes an 8-byte integer beyond 32 bits", () => {
    expect(parseBinaryPlist(buildPlist([[0x13, 0, 0, 0, 1, 0, 0, 0, 0]]))).toBe(
      2 ** 32
    );
  });

  it("decodes a UTF-8 string with a two-byte sequence and an emoji", () => {
    const text = [0x43, 0x61, 0x66, 0xc3, 0xa9, 0x20, 0xf0, 0x9f, 0x98, 0x80];
    expect(parseBinaryPlist(buildPlist([[0x70 | text.length, ...text]]))).toBe(
      "Café 😀"
    );
  });

  it("replaces malformed UTF-8 bytes", () => {
    expect(parseBinaryPlist(buildPlist([[0x72, 0xc3, 0x41]]))).toBe("�A");
    expect(parseBinaryPlist(buildPlist([[0x71, 0xff]]))).toBe("�");
  });

  it("decodes sets and ordered sets as arrays", () => {
    const objects = [
      [0xc2, 0x01, 0x02],
      [0x10, 0x05],
      [0x51, 0x61]
    ];
    expect(parseBinaryPlist(buildPlist(objects))).toEqual([5, "a"]);
    objects[0][0] = 0xb2;
    expect(parseBinaryPlist(buildPlist(objects))).toEqual([5, "a"]);
  });

  it("stringifies a non-string dict key", () => {
    const objects = [[0xd1, 0x01, 0x02], [0x10, 0x07], [0x09]];
    expect(parseBinaryPlist(buildPlist(objects))).toEqual({ "7": true });
  });

  it("honours the top object index", () => {
    const objects = [
      [0x10, 0x01],
      [0x10, 0x02]
    ];
    expect(parseBinaryPlist(buildPlist(objects, 1))).toBe(2);
  });
});

describe("parseBinaryPlist with bad input", () => {
  const person = fromBase64(PERSON_B64);

  it("throws on empty input", () => {
    expect(() => parseBinaryPlist(new Uint8Array(0))).toThrow(Error);
  });

  it("throws on a wrong magic", () => {
    const bytes = person.slice();
    bytes.set(ascii("xplist00"), 0);
    expect(() => parseBinaryPlist(bytes)).toThrow(/not a binary plist/i);
    const text = new Uint8Array(ascii('<?xml version="1.0"?>'.padEnd(64, " ")));
    expect(() => parseBinaryPlist(text)).toThrow(Error);
  });

  it("throws on a truncated trailer", () => {
    expect(() => parseBinaryPlist(person.slice(0, 20))).toThrow(/truncated/i);
    expect(() => parseBinaryPlist(person.slice(0, person.length - 1))).toThrow(
      Error
    );
  });

  it("throws when the offset table points past the end", () => {
    const bytes = person.slice();
    bytes.set(be64(bytes.length), bytes.length - 8);
    expect(() => parseBinaryPlist(bytes)).toThrow(/offset table/i);
  });

  it("throws when the offset table does not fit before the trailer", () => {
    const bytes = person.slice();
    bytes.set(be64(bytes.length - 32 - 1), bytes.length - 8);
    expect(() => parseBinaryPlist(bytes)).toThrow(/offset table/i);
  });

  it("throws when an object offset points past the table", () => {
    const bytes = person.slice();
    const tableOffset = 0x032f;
    bytes[tableOffset] = 0xff;
    bytes[tableOffset + 1] = 0xff;
    expect(() => parseBinaryPlist(bytes)).toThrow(/offset/i);
  });

  it("throws when there are no objects or the top object is out of range", () => {
    const none = buildPlist([[0x09]]);
    none.set(be64(0), none.length - 24);
    expect(() => parseBinaryPlist(none)).toThrow(Error);
    expect(() => parseBinaryPlist(buildPlist([[0x09]], 3))).toThrow(
      /top object/i
    );
  });

  it("throws when a string runs into the offset table", () => {
    expect(() => parseBinaryPlist(buildPlist([[0x55, 0x61, 0x62]]))).toThrow(
      /past the end/i
    );
    expect(() =>
      parseBinaryPlist(buildPlist([[0x6f, 0x10, 0x40, 0x00]]))
    ).toThrow(/past the end/i);
  });

  it("throws when a reference points outside the object table", () => {
    expect(() => parseBinaryPlist(buildPlist([[0xa1, 0x05]]))).toThrow(
      /reference/i
    );
  });

  it("throws on a reference cycle instead of hanging", () => {
    expect(() => parseBinaryPlist(buildPlist([[0xa1, 0x00]]))).toThrow(
      /cycle/i
    );
    const dictCycle = [
      [0xd1, 0x01, 0x00],
      [0x51, 0x6b]
    ];
    expect(() => parseBinaryPlist(buildPlist(dictCycle))).toThrow(/cycle/i);
    const twoStep = [
      [0xa1, 0x01],
      [0xa1, 0x00]
    ];
    expect(() => parseBinaryPlist(buildPlist(twoStep))).toThrow(/cycle/i);
  });

  it("throws on an unknown marker", () => {
    expect(() => parseBinaryPlist(buildPlist([[0x90]]))).toThrow(/marker/i);
    expect(() => parseBinaryPlist(buildPlist([[0x05]]))).toThrow(/marker/i);
  });
});
