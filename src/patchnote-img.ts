// 日韓アップデートの画像の置き場所。原文の画像 URL から決める (取り込み・検証・表示で共通)
// 例: kr-201 の //images-us.dragonnest.com/cms/1/20261102/2026110219431350082.png → patchnote-img/kr-201/2026110219431350082.webp
export function patchImgPath(noteId: string, src: string): string {
  const base = src.split(/[?#]/)[0].split("/").pop()!.replace(/\.[^.]+$/, "");
  return `patchnote-img/${noteId}/${base}.webp`;
}
