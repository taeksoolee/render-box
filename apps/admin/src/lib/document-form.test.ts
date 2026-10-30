import { describe, expect, it } from "vitest";
import { readDocumentForm, validateDocumentForm } from "./document-form";

const form = (body: Record<string, string | string[]>) => readDocumentForm(body);

describe("document form (design.md 4.4, 4.5)", () => {
  it("pairs links by index, drops empty rows, keeps order", () => {
    const v = form({ title: "t", link_label: ["기획서", "", ""], link_url: ["https://a.test", "", "https://b.test"] });
    const { errors, links } = validateDocumentForm(v);
    expect(errors).toEqual({});
    expect(links).toEqual([
      { label: "기획서", url: "https://a.test" },
      { label: "", url: "https://b.test" },
    ]);
  });

  it.each([
    [{ title: "" }, "title"],
    [{ title: "x".repeat(201) }, "title"],
    [{ title: "t", description: "x".repeat(2001) }, "description"],
    [{ title: "t", link_label: "이름만", link_url: "" }, "links"],
    [{ title: "t", link_label: "", link_url: "javascript:alert(1)" }, "links"],
    [{ title: "t", link_label: Array(11).fill(""), link_url: Array(11).fill("https://a.test") }, "links"],
  ])("rejects %j", (body, field) => {
    const { errors } = validateDocumentForm(form(body as Record<string, string | string[]>));
    expect(errors).toHaveProperty(field);
  });

  it("only accepts positive integer ids", () => {
    expect(form({ upload_id: "12", version: "3" })).toMatchObject({ uploadId: 12, version: 3 });
    expect(form({ upload_id: "-1", version: "1e3" })).toMatchObject({ uploadId: null, version: null });
  });
});
