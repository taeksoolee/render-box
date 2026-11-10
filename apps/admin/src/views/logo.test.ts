import { describe, expect, it } from "vitest";
import { Document, TopBar } from "./layout";
import { LoginPage } from "./login";

// The logo is a static asset; pages reference it as favicon and in the header.
const user = { keyId: 1, name: "t", role: "EDITOR", sessionId: "s", familyId: "f", csrfToken: "c" } as never;

describe("logo", () => {
  it("is the favicon and touch icon of every page", () => {
    const html = String(Document({ title: "x", children: null }));
    expect(html).toContain('<link rel="icon" href="/static/logo.svg" type="image/svg+xml"/>');
    expect(html).toContain('<link rel="apple-touch-icon" href="/static/apple-touch-icon.png"/>');
  });

  it("appears in the top bar and on the login page, hidden from screen readers", () => {
    expect(String(TopBar({ user }))).toMatch(/<img src="\/static\/logo.svg" alt=""/);
    expect(String(LoginPage({ next: null }))).toMatch(/<img src="\/static\/logo.svg" alt=""/);
  });
});
