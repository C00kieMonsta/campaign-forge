# Retrieval evaluation

```
pnpm --filter @apps/backend eval -- --workspace <uuid> --owner <email>
pnpm --filter @apps/backend eval -- --workspace <uuid> --owner <email> --accept   # record a baseline
```

Not part of `pnpm test`: it needs a live database and it spends a few cents on embeddings, one per
case. A suite that cannot run in CI without credentials and a bill does not belong in the suite.

## What it measures

**Retrieval only.** For a fact the corpus genuinely states — an amount, a date written in the text, a
person named in few documents — it asks whether the retriever surfaces the documents that state it.
Both the question and its correct answer are derived from the corpus, so no labelling is needed.

Cases are only built from _distinctive_ facts, in at most three documents. "Which pièces mention
1.500.000 BEF?" has eighteen right answers on this file, so every retriever passes and the case
measures nothing.

## What it does NOT measure

Whether an answer is **legally correct**. That needs a practitioner, and no amount of derived ground
truth substitutes for it. `verified-cases.json` is where that judgement goes — it starts empty on
purpose rather than seeded with guesses.

A green run means _the right documents came back_. It does not mean the answer was right.

## Reading the output

The single score is close to useless on its own — nobody knows whether 84% is good. What is actionable
is the comparison with the last accepted baseline:

```
against the last accepted run:
  regressed 2
    ↓ amount:45.500.000_bef
    ↓ date:27_mai_1998
```

A case that used to be found and now is not is a retrieval regression, and that is the shape of every
silent defect this app has shipped: the assembler taking the oldest sixteen messages and dropping the
live question; a pinned page returning a neighbouring chunk labelled with the wrong page number; a
one-page PDF handing over half its text as though it were the whole page. None of them threw. Each
produced a confident answer built on the wrong passage.

The run exits non-zero when anything regressed, so it can gate a deploy.
