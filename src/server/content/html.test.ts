import { describe, expect, it } from "vitest";
import { isBlankRichText, sanitizeRichText } from "./html";

describe("sanitizeRichText", () => {
  it("keeps what the editor legitimately writes", () => {
    const html =
      "<h3>Plano</h3><p>Comprar <strong>tinta</strong> e <em>rolo</em>.</p><ul><li>Item</li></ul>";
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("keeps the section a phase leaves behind", () => {
    const html = '<section data-phase-note="2026-09-10"><h3>Execução</h3><p>Nota.</p></section>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("drops a script, an event handler and a style", () => {
    const dirty =
      '<p onclick="steal()">oi</p><script>steal()</script><p style="position:fixed">x</p>';
    const clean = sanitizeRichText(dirty);

    expect(clean).not.toContain("script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("style");
    expect(clean).toContain("oi");
  });

  it("refuses a javascript: link but keeps an ordinary one", () => {
    const clean = sanitizeRichText('<a href="javascript:alert(1)">x</a>');
    expect(clean).not.toContain("javascript:");

    const link = sanitizeRichText('<a href="https://planora.app">docs</a>');
    expect(link).toContain('href="https://planora.app"');
    expect(link).toContain('rel="noopener noreferrer nofollow"');
  });

  it("keeps an image served by our own signed route", () => {
    const clean = sanitizeRichText('<img src="/api/files/a/b.png?exp=1&sig=2" alt="planta">');
    expect(clean).toContain('src="/api/files/a/b.png?exp=1&amp;sig=2"');
    expect(clean).toContain('alt="planta"');
  });

  it("drops an svg, whatever it carries", () => {
    expect(sanitizeRichText('<svg><use href="#x" /></svg>')).not.toContain("svg");
  });
});

describe("isBlankRichText", () => {
  it("reads an empty editor as nothing written", () => {
    expect(isBlankRichText("")).toBe(true);
    expect(isBlankRichText("<p></p>")).toBe(true);
    expect(isBlankRichText("<p>&nbsp;</p>")).toBe(true);
  });

  it("reads a lone image as something written", () => {
    expect(isBlankRichText('<p><img src="/api/files/a.png"></p>')).toBe(false);
  });

  it("reads text as something written", () => {
    expect(isBlankRichText("<p>oi</p>")).toBe(false);
  });
});
