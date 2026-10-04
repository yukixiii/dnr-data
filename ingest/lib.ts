import { load } from "cheerio";

export const UA = "Mozilla/5.0 (dnr-data ingest; manual run)";

export async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 本文をレビューしやすいテキストに変換。表は TSV 風に、見出し・リストは改行を保つ。
export function toText(
  html: string,
  bodySelector: string,
  titleSelector = "title",
): { title: string; text: string } {
  const $ = load(html);
  const title = ($(titleSelector).first().text() || $("title").text()).replace(/\s+/g, " ").trim();
  const body = $(bodySelector).first();
  const root = body.length ? body : $("body");
  root.find("script, style").remove();
  root.find("table").each((_, t) => {
    const rows = $(t)
      .find("tr")
      .map((_, tr) =>
        $(tr)
          .find("th,td")
          .map((_, c) => $(c).text().replace(/\s+/g, " ").trim())
          .get()
          .join("\t"),
      )
      .get();
    $(t).replaceWith(`\n[TABLE]\n${rows.join("\n")}\n[/TABLE]\n`);
  });
  root.find("br").replaceWith("\n");
  root.find("p, div, li, h1, h2, h3, h4, h5, tr").each((_, el) => {
    $(el).append("\n");
  });
  const text = root
    .text()
    .split("\n")
    .map((l) => l.replace(/[ \t ]+$/g, "").replace(/^[  ]+/, ""))
    .filter((l, i, arr) => l !== "" || arr[i - 1] !== "")
    .join("\n");
  return { title, text };
}

