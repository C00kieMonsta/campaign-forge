import { unsubscribeUrl } from "./token";

const BUSINESS_NAME = "Thermonique";
const BUSINESS_ADDRESS = "Belgium";

export function appendFooter(html: string, emailLower: string): string {
  const url = unsubscribeUrl(emailLower);
  const footer = `
<div style="margin-top:40px;padding-top:20px;border-top:1px solid #e0e0e0;font-size:12px;color:#666;text-align:center">
  <p><strong>${BUSINESS_NAME}</strong><br>${BUSINESS_ADDRESS}</p>
  <p><a href="${url}" style="color:#666;text-decoration:underline">Unsubscribe</a></p>
</div>`;
  return html.includes("</body>") ? html.replace("</body>", `${footer}</body>`) : html + footer;
}
