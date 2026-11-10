// A11: the Markdown renderer is safe against script and link injection.
import { describe, expect, it } from "vitest";
import { createMarkdownRenderer } from "../../server/adapters/markdown";

const md = createMarkdownRenderer();
const att = [{ id: "att-1", altText: "Stored alt" }];

describe("A11: safe Markdown rendering", () => {
  it("renders ordinary Markdown", () => {
    const html = md.render("## Heading\n\n**bold** _em_ `code`\n\n- one\n- two\n\n> quote\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<table>");
  });

  it.each([
    ["<script>alert(1)</script>"],
    ['<img src=x onerror="alert(1)">'],
    ['<iframe src="https://evil.example"></iframe>'],
    ['<a href="javascript:alert(1)">x</a>'],
    ["<svg onload=alert(1)>"],
    ['<div style="background:url(javascript:alert(1))">x</div>'],
  ])("shows raw HTML as text: %s", (input) => {
    const html = md.render(input);
    expect(html).not.toMatch(/<(script|img|iframe|svg|div|a)\b/i);
    expect(html).toContain("&lt;");
  });

  it.each([
    ["[x](javascript:alert(1))"],
    ["[x](JAVASCRIPT:alert(1))"],
    ["[x](  javascript:alert(1))"],
    ["[x](java&#x09;script:alert(1))"],
    ["[x](vbscript:msgbox(1))"],
    ["[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
    ["[x](file:///etc/passwd)"],
    ["<javascript:alert(1)>"],
    ["[x][r]\n\n[r]: javascript:alert(1)"],
  ])("drops unsafe links (any remains are escaped text): %s", (input) => {
    const html = md.render(input);
    expect(html).not.toMatch(/<a\b/i);
    expect(html).not.toMatch(/href=/i);
  });

  it("keeps http, https, and mailto links with a safe rel", () => {
    const html = md.render("[a](https://example.com/a?b=1) [b](http://example.com) [c](mailto:test@example.test)");
    expect(html).toContain('<a href="https://example.com/a?b=1" rel="nofollow noopener noreferrer ugc">a</a>');
    expect(html).toContain('href="http://example.com"');
    expect(html).toContain('href="mailto:test@example.test"');
  });

  it("escapes attribute breakouts in links and titles", () => {
    const html = md.render('[x](https://example.com/"onmouseover="alert(1) "t\\"onclick=\\"x")');
    expect(html).not.toMatch(/\son(mouseover|click)=/i);
  });

  it("rewrites only allowed attachment images and drops every other image", () => {
    const html = md.render(
      [
        "![Chart](attachment:att-1)",
        "![](attachment:att-1)",
        "![Other](attachment:att-2)",
        "![Remote](https://example.com/x.png)",
        "![Data](data:image/png;base64,AAAA)",
        '![x](attachment:att-1"onerror="alert(1))',
      ].join("\n\n"),
      { attachments: att },
    );
    expect(html).toContain('<img src="/attachments/att-1" alt="Chart" loading="lazy">');
    expect(html).toContain('<img src="/attachments/att-1" alt="Stored alt" loading="lazy">');
    expect(html.match(/<img/g)).toHaveLength(2);
    expect([...html.matchAll(/\ssrc="([^"]*)"/g)].map((m) => m[1])).toEqual(["/attachments/att-1", "/attachments/att-1"]);
    expect(html).not.toContain("example.com/x.png");
    expect(html).not.toMatch(/\sonerror\s*=/i);
  });

  it("drops attachment images entirely when no attachments are allowed", () => {
    expect(md.render("![Chart](attachment:att-1)")).not.toContain("<img");
  });

  it("finds attachment references for validation", () => {
    expect(md.attachmentRefs("![a](attachment:x1) [b](attachment:x2) ![c](attachment:x1)\n\n![d][r]\n\n[r]: attachment:x3")).toEqual(["x1", "x2", "x3"]);
    expect(md.attachmentRefs(null)).toEqual([]);
    // Mentions of the syntax in text or code are not references.
    expect(md.attachmentRefs("Use `![alt](attachment:ID)`.\n\n```\n![x](attachment:Y)\n```\n\nmyattachment:foo")).toEqual([]);
  });
});
