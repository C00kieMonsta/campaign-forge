/**
 * Copies text to the clipboard. The async Clipboard API needs a secure context, which the
 * admin app has in production but not always over plain-HTTP LAN access, so a hidden-textarea
 * fallback keeps copy working there too. Resolves false when both routes fail, so callers can
 * show an error rather than silently pretending it worked.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    // Keep it out of view and out of the tab order, but still selectable.
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
