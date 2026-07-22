import { load } from "cheerio";

type Document = ReturnType<typeof load>;
type Selection = ReturnType<Document>;

export interface HtmlCell {
  text: string;
  parts: string[];
  quotes: string[];
}

export interface HtmlTable {
  headers: string[];
  rows: HtmlCell[][];
  headings: string[];
}

interface Span {
  cell: HtmlCell;
  remaining: number;
}

export function htmlText(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function cell($: Document, selection: Selection): HtmlCell {
  const values = (selector: string): string[] =>
    selection
      .find(selector)
      .map((_index, element) => htmlText($(element).text()))
      .get()
      .filter(Boolean);
  return {
    text: htmlText(selection.text()),
    parts: values("code, p"),
    quotes: values("blockquote"),
  };
}

function rows($: Document, table: Selection): HtmlCell[][] {
  const spans: (Span | undefined)[] = [];
  const result: HtmlCell[][] = [];
  table.find("tr").each((_rowIndex, rowElement) => {
    const row: HtmlCell[] = [];
    for (const [column, span] of spans.entries()) {
      if (span === undefined) continue;
      row[column] = span.cell;
      span.remaining -= 1;
      if (span.remaining === 0) spans[column] = undefined;
    }
    let column = 0;
    $(rowElement)
      .children("th,td")
      .each((_cellIndex, cellElement) => {
        while (row[column] !== undefined) column += 1;
        const selection = $(cellElement);
        const value = cell($, selection);
        const colspan = Number(selection.attr("colspan") ?? "1");
        const rowspan = Number(selection.attr("rowspan") ?? "1");
        for (let offset = 0; offset < colspan; offset += 1) {
          row[column + offset] = value;
          if (rowspan > 1) spans[column + offset] = { cell: value, remaining: rowspan - 1 };
        }
        column += colspan;
      });
    result.push(row);
  });
  return result;
}

function headings($: Document, table: Selection): string[] {
  const result: string[] = [];
  table.parents("section").each((_index, section) => {
    const heading = htmlText($(section).children("h1,h2,h3,h4,h5,h6").first().text());
    if (heading !== "") result.push(heading);
  });
  return result;
}

export function htmlTables(body: string): HtmlTable[] {
  const $ = load(body);
  return $("main table, table")
    .toArray()
    .map((element) => {
      const selection = $(element);
      const tableRows = rows($, selection);
      const first = selection.find("tr").first().children("th,td");
      const headerDepth = Math.max(
        1,
        ...first.map((_index, item) => Number($(item).attr("rowspan") ?? "1")).get(),
      );
      const width = Math.max(...tableRows.slice(0, headerDepth).map((row) => row.length));
      const headers = Array.from({ length: width }, (_value, column) =>
        unique(
          tableRows
            .slice(0, headerDepth)
            .flatMap((row) => row[column]?.text ?? [])
            .filter(Boolean),
        ).join(" / "),
      );
      return { headers, rows: tableRows.slice(headerDepth), headings: headings($, selection) };
    });
}

export function htmlColumn(headers: string[], pattern: RegExp): number | undefined {
  const index = headers.findIndex((header) => pattern.test(header));
  return index < 0 ? undefined : index;
}

export function htmlValue(table: HtmlTable, row: HtmlCell[], pattern: RegExp): string | undefined {
  const index = htmlColumn(table.headers, pattern);
  const result = index === undefined ? undefined : row[index]?.text;
  return result === "" ? undefined : result;
}
