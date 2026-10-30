import { randomBase62 } from "./crypto";

export const DOCUMENT_KEY_LENGTH = 22;
const DOCUMENT_KEY_PATTERN = /^[0-9A-Za-z]{22}$/;

export function generateDocumentKey(): string {
  return randomBase62(DOCUMENT_KEY_LENGTH);
}

export function isDocumentKey(value: string): boolean {
  return DOCUMENT_KEY_PATTERN.test(value);
}
