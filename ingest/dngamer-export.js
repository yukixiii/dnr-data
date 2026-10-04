// dngamer.site (中国版フォーラム「DN聚集地」) のスレッド本文を1つの JSON にまとめてダウンロードするスニペット。
// ログインが必要なので Node からは取得できない。ログイン済みのブラウザで https://dngamer.site/ を開き、
// DevTools のコンソールにこのファイルの中身を貼り付けて実行する (スレッド id は下の THREADS を編集)。
// ダウンロードされた JSON は `npm run import:dngamer -- <JSONのパス>` で ingest/raw/dngamer-<id>.txt に変換する。
// 本文は .bbWrapper の innerHTML のまま保存し、テキスト化 (表の平坦化) は ingest/lib.ts の toText に任せる。
(async (THREADS) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  const threads = [];
  for (const id of THREADS) {
    const posts = [];
    let title = "";
    let pages = 1;
    for (let page = 1; page <= pages; page++) {
      const url = `/threads/${id}/${page > 1 ? `page-${page}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const doc = parse(await res.text());
      title ||= doc.querySelector("h1.p-title-value")?.textContent.replace(/\s+/g, " ").trim() ?? "";
      const nav = [...doc.querySelectorAll(".pageNav-page")].map((x) => Number(x.textContent.trim()) || 0);
      pages = Math.max(pages, ...nav);
      for (const a of doc.querySelectorAll("article.message")) {
        const body = a.querySelector(".bbWrapper");
        if (!body) continue;
        posts.push({
          author: a.getAttribute("data-author") ?? "",
          posted_at: a.querySelector(".message-attribution-main time")?.getAttribute("datetime") ?? "",
          edited_at: a.querySelector(".message-lastEdit time")?.getAttribute("datetime") ?? "",
          html: body.innerHTML,
        });
      }
      await sleep(1000);
    }
    threads.push({ id, url: `https://dngamer.site/threads/${id}/`, title, posts });
    console.log(`dngamer-export: ${id} ${title} (${posts.length} posts)`);
  }
  const fetched_at = new Date().toISOString();
  const blob = new Blob([JSON.stringify({ fetched_at, threads }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `dngamer-export-${fetched_at.slice(0, 10).replaceAll("-", "")}.json`;
  a.click();
  console.log(`dngamer-export: ${threads.length} threads, ${blob.size} bytes -> ${a.download}`);
})([
  // 装備数据 (forums/26)
  3909, 11679, 11728, 8615, 1091, 564, 1090, 4995, 1152, 1086, 1783, 3370, 3062,
  // 副本奖励 (forums/27)
  33, 4347, 1092, 1096, 1327, 12305, 11747, 10760, 9031, 1762, 4910, 1093, 4309, 1095, 1097, 1098, 30,
  // 现金点券 (forums/29) / 其他数据 (forums/30)
  73, 1517, 1121, 1124,
]);
