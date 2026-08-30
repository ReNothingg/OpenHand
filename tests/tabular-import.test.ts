import { describe, expect, it } from "vitest";
import {
  delimitedTextToMarkdown,
  parseDelimitedText,
} from "../src/lib/tabularImport";

describe("tabular import", () => {
  it("parses quoted CSV and produces a Markdown table", () => {
    const source = 'Имя,Комментарий\nАнна,"раз, два"\nБорис,"a ""quote"""';
    expect(parseDelimitedText(source)).toEqual([
      ["Имя", "Комментарий"],
      ["Анна", "раз, два"],
      ["Борис", 'a "quote"'],
    ]);
    expect(delimitedTextToMarkdown(source)).toContain("| Анна | раз, два |");
  });

  it("detects TSV and escapes Markdown pipes", () => {
    expect(delimitedTextToMarkdown("A\tB\n1\tx|y")).toContain("x\\|y");
  });
});
