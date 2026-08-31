import {
  applyMention,
  findMention,
  stripMentions,
  textNamesDocument
} from "../mentions";
import { PATH_SEPARATOR } from "../uploadCandidates";

/**
 * The composer's '@' file mention, parsed without a component.
 *
 * The caret rules are where this feature goes wrong: an '@' that opens a menu over a finished
 * question turns the next Enter into a file pick instead of a send, so what does NOT open a mention
 * matters at least as much as what does.
 */

const at = (text: string) => findMention(text, text.length);

describe("findMention — what opens one", () => {
  it("opens on '@' at the very start of the box", () => {
    expect(at("@conv")).toEqual({ start: 0, end: 5, query: "conv" });
  });

  it("opens on '@' after a space", () => {
    expect(at("compare @conv")).toEqual({ start: 8, end: 13, query: "conv" });
  });

  it("opens on '@' after an opening bracket or quote", () => {
    expect(at("(@conv")).not.toBeNull();
    expect(at("«@conv")).not.toBeNull();
  });

  it("opens with an empty query, so the menu appears on the bare '@'", () => {
    expect(at("voir @")).toEqual({ start: 5, end: 6, query: "" });
  });

  it("accepts a multi-word query, because filenames have spaces", () => {
    expect(at("@requête introductive")?.query).toBe("requête introductive");
  });

  it("accepts a flattened folder name, path separator and all", () => {
    const name = `Pièces adverses${PATH_SEPARATOR}Annexe 2.pdf`;
    // Five whitespace-separated tokens once the separator glyph is counted. A four-word cap cut
    // this off before the user finished typing a name they could see on screen.
    expect(at(`@${name}`)?.query).toBe(name);
  });
});

describe("findMention — what does not", () => {
  it("does not open inside a word, so an email address is left alone", () => {
    expect(at("jean@cabinet.be")).toBeNull();
  });

  it("does not open on '@ ', which is an at-sign used as prose", () => {
    expect(at("rendez-vous @ 14h")).toBeNull();
  });

  it("does not open inside a fenced code block", () => {
    expect(at("```\nconst a = @conv")).toBeNull();
  });

  it("does not open inside inline backticks", () => {
    expect(at("le champ `@conv")).toBeNull();
  });

  it("reopens after a fence is closed", () => {
    expect(at("```\ncode\n```\n@conv")).not.toBeNull();
  });

  it("does not open when the query runs past the word cap", () => {
    expect(at("@one two three four five six seven eight nine")).toBeNull();
  });

  it("does not open across a newline", () => {
    expect(at("@conv\nligne suivante")).toBeNull();
  });

  it("takes the LAST '@', not the first", () => {
    expect(at("@a et @b")?.query).toBe("b");
  });

  it("reads the caret, not the end of the text", () => {
    // Caret just after "@conv", with more text to its right.
    expect(findMention("@conv reste du texte", 5)).toEqual({
      start: 0,
      end: 5,
      query: "conv"
    });
  });
});

describe("applyMention", () => {
  it("replaces the query with the token and leaves the caret after its trailing space", () => {
    const text = "compare @conv avec le reste";
    const mention = findMention(text, 13)!;
    const next = applyMention(text, mention, "convention-1998.pdf");
    expect(next.text).toBe("compare @convention-1998.pdf  avec le reste");
    expect(next.caret).toBe("compare @convention-1998.pdf ".length);
  });

  it("inserts the FULL flattened filename, so the token is unambiguous across folders", () => {
    const name = `Pièces adverses${PATH_SEPARATOR}Annexe 2.pdf`;
    const next = applyMention("@ann", findMention("@ann", 4)!, name);
    expect(next.text).toBe(`@${name} `);
  });
});

describe("textNamesDocument", () => {
  it("is true for a token the text carries", () => {
    expect(
      textNamesDocument(
        "compare @convention-1998.pdf avec",
        "convention-1998.pdf"
      )
    ).toBe(true);
  });

  it("is true when the token ends the message", () => {
    expect(textNamesDocument("voir @annexe.pdf", "annexe.pdf")).toBe(true);
  });

  it("is true when the token is followed by punctuation", () => {
    expect(textNamesDocument("voir @annexe.pdf, page 4", "annexe.pdf")).toBe(
      true
    );
  });

  // The bug a bare substring test had: it dropped the wrong document from the persisted reference
  // label, because one filename is a prefix of another.
  it("is false for a filename that is only a PREFIX of the mentioned one", () => {
    expect(textNamesDocument("voir @Annexe 2.pdf", "Annexe 2")).toBe(false);
  });

  it("is true for the shorter name when the text really names it", () => {
    expect(
      textNamesDocument("voir @Annexe 2 et @Annexe 2.pdf", "Annexe 2")
    ).toBe(true);
  });

  it("is true when the token ends a sentence with a full stop", () => {
    expect(textNamesDocument("voir @annexe.pdf.", "annexe.pdf")).toBe(true);
  });

  it("is false when the text names nothing", () => {
    expect(textNamesDocument("une question ordinaire", "annexe.pdf")).toBe(
      false
    );
  });
});

describe("stripMentions", () => {
  // The title of a background run is consumed verbatim by the backend, and in adverse mode it IS
  // the party being defended. A leading filename token there had the model build a case against
  // a PDF.
  it("removes the token and collapses the gap it leaves", () => {
    expect(
      stripMentions("@convention-1998.pdf défends M. Pirson", [
        "convention-1998.pdf"
      ])
    ).toBe("défends M. Pirson");
  });

  it("removes several tokens", () => {
    expect(
      stripMentions("@a.pdf et @b.pdf pour M. X", ["a.pdf", "b.pdf"])
    ).toBe("et pour M. X");
  });

  it("strips the longest name first, so a prefix cannot cut another name in half", () => {
    expect(
      stripMentions("@Annexe 2.pdf reste", ["Annexe 2", "Annexe 2.pdf"])
    ).toBe("reste");
  });

  it("leaves text with no tokens untouched apart from trimming", () => {
    expect(stripMentions("  défends M. Pirson  ", ["a.pdf"])).toBe(
      "défends M. Pirson"
    );
  });
});
