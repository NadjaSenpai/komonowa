import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { useBlocker, useNavigate, useParams, useSearchParams } from "react-router";
import { ApiError, api, errorMessage, type Article } from "../api";
import { ErrorAlert } from "../ErrorAlert";
import { renderMarkdown } from "../markdown";
import { applyMarkup, insertIntoTextarea, markupShortcut, type MarkupAction } from "../markup";
import { MarkupToolbar } from "../MarkupToolbar";
import { ACCEPT, attachmentMarkdown, namePastedFile, referencedIds, uploadAttachment } from "../upload";

function parseTags(input: string) {
  return input
    .split(/[,、\s]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean);
}

export function ArticleEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  // [[まだない記事]] から来たときは、そのタイトルを入れておく（未保存の変更として扱う）
  const [searchParams] = useSearchParams();
  const [title, setTitle] = useState(() => (id ? "" : (searchParams.get("title") ?? "")));
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [baseVersion, setBaseVersion] = useState(0);
  const [original, setOriginal] = useState({ title: "", body: "", tags: "" });
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<Article | null>(null);
  const [saving, setSaving] = useState(false);
  // 保存できた記事の ID。描画に反映されてから移動しないと、未保存の確認が出てしまう
  const [savedId, setSavedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  // 新規作成中にアップロードした下書き添付。保存時に本文で使っているものだけをひもづける
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    api
      .get<{ article: Article }>(`/articles/${id}`)
      .then(({ article }) => {
        setTitle(article.title);
        setBody(article.body);
        setTags(article.tags.join(", "));
        setBaseVersion(article.version);
        setOriginal({ title: article.title, body: article.body, tags: article.tags.join(", ") });
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  const dirty = !savedId && (title !== original.title || body !== original.body || tags !== original.tags);
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (savedId) navigate(`/articles/${savedId}`);
  }, [savedId, navigate]);
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (confirm("保存していない変更があります。破棄して移動しますか？")) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const preview = useMemo(() => (tab === "preview" ? renderMarkdown(body) : ""), [tab, body]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = { title, body, tags: parseTags(tags) };
    try {
      const r = id
        ? await api.put<{ article: Article }>(`/articles/${id}`, { ...payload, baseVersion })
        : await api.post<{ article: Article }>("/articles", { ...payload, attachmentIds: referencedIds(body, draftIds) });
      setSavedId(r.article.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.data.current) {
        setConflict(err.data.current as Article);
      }
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * 画像・ファイルをアップロードして本文のカーソル位置に差し込む。
   * 先に「アップロード中」の仮の行を入れ、終わったら本物の Markdown に置き換える（その間も書き続けられる）
   */
  function insertFiles(files: File[]) {
    if (files.length === 0) return;
    setError("");
    const items = files.map((file) => {
      const token = crypto.randomUUID().slice(0, 8);
      const bang = file.type.startsWith("image/") ? "!" : "";
      return { file, placeholder: `${bang}[${file.name.replace(/[[\]]/g, "")} をアップロード中…](#uploading-${token})` };
    });
    const el = textarea.current;
    const at = el && tab === "edit" ? Math.min(el.selectionStart, body.length) : body.length;
    const before = body.slice(0, at);
    const after = body.slice(at);
    // 画像は行として置く（前後が行の途中なら改行を補う）
    const lead = before === "" || before.endsWith("\n") ? "" : "\n";
    const tail = after.startsWith("\n") ? "" : "\n";
    const inserted = lead + items.map((i) => i.placeholder).join("\n") + tail;
    setBody(before + inserted + after);
    const caret = at + inserted.length;
    requestAnimationFrame(() => {
      if (textarea.current && document.activeElement === textarea.current) textarea.current.setSelectionRange(caret, caret);
    });
    setUploading((n) => n + items.length);
    for (const { file, placeholder } of items) {
      uploadAttachment(file, id)
        .then((a) => {
          if (!id) setDraftIds((ids) => [...ids, a.id]);
          setBody((prev) => prev.replace(placeholder, attachmentMarkdown(a)));
        })
        .catch((err) => {
          setBody((prev) => prev.replace(`${placeholder}\n`, "").replace(placeholder, ""));
          setError(errorMessage(err));
        })
        .finally(() => setUploading((n) => n - 1));
    }
  }

  /** ツールバーやショートカットで、選択範囲に Markdown の記号を付ける */
  function markup(action: MarkupAction) {
    const el = textarea.current;
    if (!el || tab !== "edit") return;
    insertIntoTextarea(el, applyMarkup(action, el.value, el.selectionStart, el.selectionEnd), setBody);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const action = markupShortcut(e);
    if (!action) return;
    e.preventDefault();
    markup(action);
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    e.preventDefault();
    insertFiles(files.map((f) => namePastedFile(f)));
  }

  function onDragOver(e: DragEvent<HTMLTextAreaElement>) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }

  function onDrop(e: DragEvent<HTMLTextAreaElement>) {
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    e.preventDefault();
    // ドロップした位置にカーソルを移してから差し込む
    e.currentTarget.focus();
    insertFiles(files);
  }

  /** 競合時: 自分の編集内容は残したまま、最新版を基準にして保存し直せるようにする */
  function rebase() {
    if (!conflict) return;
    setBaseVersion(conflict.version);
    setOriginal({ title: conflict.title, body: conflict.body, tags: conflict.tags.join(", ") });
    setConflict(null);
    setError("");
  }

  function discardMine() {
    if (!conflict) return;
    setTitle(conflict.title);
    setBody(conflict.body);
    setTags(conflict.tags.join(", "));
    rebase();
  }

  if (loading) return <p className="muted">読み込み中…</p>;

  return (
    <form onSubmit={submit} className="editor">
      <h1>{id ? "記事を編集" : "新しい記事"}</h1>
      <label>
        タイトル
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
      </label>
      <label>
        タグ（カンマ・空白区切り）
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="例: ごはん, おでかけ, 手順" />
      </label>
      <div className="editor-bar">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "edit"} className={tab === "edit" ? "active" : ""} onClick={() => setTab("edit")}>
            本文を編集
          </button>
          <button type="button" role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>
            プレビュー
          </button>
        </div>
        <button type="button" className="secondary small" onClick={() => fileInput.current?.click()}>
          画像・ファイルを挿入
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            insertFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      <div className="markup-row">
        <MarkupToolbar disabled={tab !== "edit"} onAction={markup} />
        {/* 書きかけを失わないよう新しいタブで開く */}
        <a className="markup-help small" href="/help#markdown" target="_blank" rel="noopener">
          書き方
        </a>
      </div>
      {tab === "edit" ? (
        <textarea
          ref={textarea}
          className={dragOver ? "drop-target" : undefined}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          onDragOver={onDragOver}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          rows={24}
          aria-label="本文"
          spellCheck={false}
        />
      ) : (
        <div className="markdown preview" dangerouslySetInnerHTML={{ __html: preview || "<p class='muted'>（本文なし）</p>" }} />
      )}
      <p className="muted small" role="status">
        {uploading > 0
          ? `アップロード中…（${uploading}件）`
          : "画像やファイルは、ボタン・貼り付け・ドラッグ＆ドロップで本文に差し込めます（10MBまで）。画像はその場に表示され、ほかのファイルはリンクになります。"}
      </p>

      {conflict && (
        <div className="conflict" role="alert">
          <p>
            <strong>{conflict.updated_by_name}</strong> さんが先に第{conflict.version}版を保存しました。最新版の本文：
          </p>
          <pre>{conflict.body}</pre>
          <div className="actions">
            <button type="button" onClick={rebase}>
              自分の内容で上書きする
            </button>
            <button type="button" className="secondary" onClick={discardMine}>
              自分の変更を捨てて最新版を読み込む
            </button>
          </div>
        </div>
      )}
      {!conflict && <ErrorAlert message={error} />}
      <div className="actions editor-savebar">
        <span className="save-state" role="status">
          {saving ? "保存中…" : dirty ? "未保存の変更" : "変更はありません"}
        </span>
        <button type="submit" disabled={saving || uploading > 0 || Boolean(conflict)}>
          {saving ? "保存中…" : "保存"}
        </button>
        <button type="button" className="secondary" onClick={() => navigate(id ? `/articles/${id}` : "/")}>
          キャンセル
        </button>
      </div>
    </form>
  );
}
