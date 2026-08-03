import { ConflictException, Injectable } from "@nestjs/common";
import type { LexArtifact, LexArtifactVersion } from "@packages/types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Renders an artifact version to a self-contained, print-ready HTML document with on-page
 * footnote markers and a References section built from the SAME citation data as the claims.
 * A native PDF/DOCX renderer (Puppeteer/docx) is a later addition; browser "Print → PDF"
 * covers filing needs today.
 */
@Injectable()
export class ExportService {
  renderHtml(
    artifact: LexArtifact,
    version: LexArtifactVersion,
    opts: { verifiedOnly: boolean }
  ): string {
    const signedOff = Boolean(version.signedOffAt);
    const verified = version.verificationStatus === "verified";

    // Verified-only export is a hard, server-side gate re-checked at export time.
    if (opts.verifiedOnly && !(verified && signedOff)) {
      throw new ConflictException(
        "Artifact is not exportable for filing: it must be machine-verified AND human-signed-off."
      );
    }

    const claims = version.bodyJson?.claims ?? [];
    const footnotes: { n: number; label: string; quote: string }[] = [];

    const body = claims
      .map((c) => {
        if (c.status === "supported" && c.citation) {
          const n = footnotes.length + 1;
          footnotes.push({
            n,
            label: `${c.citation.filename}${c.citation.pageFrom ? `, p. ${c.citation.pageFrom}` : ""}`,
            quote: c.citation.quote
          });
          return `<p>${esc(c.text)}<sup>[${n}]</sup></p>`;
        }
        // A sentence verification did not apply to is NOT an unsupported one, and stamping it
        // "[UNSUPPORTED — not for filing]" was the same category error as counting it against the
        // document: it reads as a defect in the draft when it is a request to the court. It carries
        // no footnote — there is nothing to cite — and its kind instead, so a reader can see the
        // document's own voice separated from what the file establishes.
        if (c.status === "not_checked") {
          return `<p class="unchecked">${esc(c.text)} <span class="kind">[${esc(c.kind ?? "argument")}]</span></p>`;
        }
        return `<p class="unsupported">${esc(c.text)} <span class="flag">[UNSUPPORTED — not for filing]</span></p>`;
      })
      .join("\n");

    const references = footnotes.length
      ? `<hr/><h2>References</h2><ol>` +
        footnotes
          .map((f) => `<li>${esc(f.label)} — “${esc(f.quote)}”</li>`)
          .join("\n") +
        `</ol>`
      : "";

    const watermark = signedOff
      ? ""
      : `<div class="watermark">DRAFT — NOT FOR FILING</div>`;

    return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<title>${esc(artifact.title)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; max-width: 720px; margin: 40px auto; line-height: 1.6; color: #111; padding: 0 24px; }
  h1 { font-size: 22px; } h2 { font-size: 16px; margin-top: 28px; }
  sup { color: #b45309; font-size: 0.75em; }
  .meta { color: #666; font-size: 12px; margin-bottom: 24px; }
  .unsupported { color: #991b1b; } .flag { font-size: 0.8em; font-weight: bold; }
  .unchecked .kind { color: #6b7280; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.04em; }
  ol li { margin-bottom: 6px; font-size: 13px; color: #333; }
  .watermark { position: fixed; top: 40%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg);
    font-size: 64px; color: rgba(200,0,0,0.12); font-weight: bold; pointer-events: none; z-index: 0; }
</style>
</head>
<body>
${watermark}
<h1>${esc(artifact.title)}</h1>
<div class="meta">
  ${esc(artifact.type)} · v${version.version} ·
  ${verified ? "machine-verified" : "NOT verified"} ·
  ${signedOff ? `signed off by ${esc(version.signedOffBy ?? "")}` : "not signed off"}
</div>
${body}
${references}
</body>
</html>`;
  }
}
