import { reportHtml, type Assessment } from "./evidence.ts";

export function exportSnapshot(record: Assessment) {
  const snapshot = structuredClone(record);
  return { record: snapshot, html: reportHtml(snapshot), json: JSON.stringify(snapshot, null, 2) };
}
