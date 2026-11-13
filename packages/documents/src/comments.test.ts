import { describe, expect, it } from "vitest";
import { MAX_COMMENT_CHARS, readCommentBody } from "./comments";

describe("readCommentBody", () => {
  it("trims, keeps inner line breaks and normalizes CRLF", () => {
    expect(readCommentBody("  첫 줄\r\n둘째 줄\n  ")).toBe("첫 줄\n둘째 줄");
  });

  it("rejects empty, whitespace-only and non-string input", () => {
    expect(readCommentBody("")).toBeNull();
    expect(readCommentBody(" \n\t ")).toBeNull();
    expect(readCommentBody(undefined)).toBeNull();
    expect(readCommentBody(["a", "b"])).toBeNull();
  });

  it("counts characters, not UTF-16 units, up to the limit", () => {
    expect(readCommentBody("가".repeat(MAX_COMMENT_CHARS))).not.toBeNull();
    expect(readCommentBody("😀".repeat(MAX_COMMENT_CHARS))).not.toBeNull();
    expect(readCommentBody("가".repeat(MAX_COMMENT_CHARS + 1))).toBeNull();
  });
});
