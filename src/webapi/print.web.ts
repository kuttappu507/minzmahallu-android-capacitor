/*
 * Printing + file-output for the MMS Android port.
 *
 * Desktop renders PDFs with a hidden Electron BrowserWindow and save dialogs.
 * On Android the same HTML goes to a hidden iframe and the system print
 * framework (which produces PDFs / prints to network printers). Binary
 * exports (Excel/CSV) go through the Web Share Sheet when available, with a
 * classic download as fallback.
 */

/** Print an HTML document via a hidden iframe (Android print framework). */
export function printHtml(html: string, title = "MMS Print"): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", title);
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";
  iframe.srcdoc = html;
  iframe.onload = () => {
    try {
      const win = iframe.contentWindow;
      if (!win) throw new Error("Print frame unavailable");
      win.focus();
      win.print();
    } catch (err) {
      console.error("[mms.print] print failed:", err);
    } finally {
      // Keep the frame around — Android's print dialog renders from it.
      window.setTimeout(() => iframe.remove(), 60000);
    }
  };
  document.body.appendChild(iframe);
}

export type OutputResult =
  | { status: "shared" }
  | { status: "downloaded" }
  | { status: "cancelled"; error: string };

/** Share-or-download a binary export (Excel, CSV, PDF bytes). */
export async function outputBytes(bytes: Uint8Array, filename: string, mime: string): Promise<OutputResult> {
  try {
    const file = new File([bytes as unknown as BlobPart], filename, { type: mime });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: filename });
      return { status: "shared" };
    }
  } catch (err: any) {
    if (String(err?.name) === "AbortError") return { status: "cancelled", error: "cancelled" };
    console.warn("[mms.print] share failed, falling back to download:", err);
  }
  try {
    const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { status: "downloaded" };
  } catch (err: any) {
    return { status: "cancelled", error: String(err?.message ?? err) };
  }
}

/** Current UI language as the print templates expect it. */
export function printLang(): "en" | "ml" {
  return document.documentElement.classList.contains("lang-ml") ? "ml" : "en";
}
