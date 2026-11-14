import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { MAX_ZOOM, clampOffset, cropRect, renderAvatar, type CropView } from "./userAvatar";

const VIEW = 240;

interface Props {
  file: File;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
}

/** 選んだ画像の表示範囲を決めるダイアログ。ドラッグで移動、ホイール・スライダー・+/- で拡大 */
export function AvatarCropper({ file, onCancel, onDone }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const [url, setUrl] = useState("");
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      image.current = el;
      setSize({ width: el.naturalWidth, height: el.naturalHeight });
    };
    el.onerror = () => setError("この画像は読み込めませんでした。PNG・JPEG・WebP を選んでください");
    el.src = objectUrl;
    setUrl(objectUrl);
    dialog.current?.showModal();
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const view = (z: number): CropView | null => (size ? { ...size, view: VIEW, zoom: z } : null);

  function zoomTo(next: number) {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const v = view(z);
    if (!v) return;
    // 枠の中心を基準に拡大する
    setOffset((o) => clampOffset(v, { x: (o.x * z) / zoom, y: (o.y * z) / zoom }));
    setZoom(z);
  }

  function moveBy(dx: number, dy: number) {
    const v = view(zoom);
    if (v) setOffset((o) => clampOffset(v, { x: o.x + dx, y: o.y + dy }));
  }

  // ホイールで拡大。React の onWheel は passive なので preventDefault できず、ページがスクロールしてしまう
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const v = view(zoom);
    if (!d || !v) return;
    setOffset(clampOffset(v, { x: d.ox + e.clientX - d.px, y: d.oy + e.clientY - d.py }));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[e.key];
    if (move) moveBy(move[0], move[1]);
    else if (e.key === "+" || e.key === "=") zoomTo(zoom * 1.1);
    else if (e.key === "-") zoomTo(zoom / 1.1);
    else return;
    e.preventDefault();
  }

  async function apply() {
    const v = view(zoom);
    if (!v || !image.current) return;
    setBusy(true);
    try {
      onDone(await renderAvatar(image.current, cropRect(v, offset)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "画像を処理できませんでした");
      setBusy(false);
    }
  }

  const base = size ? VIEW / Math.min(size.width, size.height) : 1;

  return (
    <dialog
      ref={dialog}
      className="cropper"
      aria-labelledby="cropper-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id="cropper-title">アイコンの範囲</h2>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : (
        <>
          <div
            ref={frame}
            className="cropper-frame"
            style={{ inlineSize: VIEW, blockSize: VIEW }}
            tabIndex={0}
            role="application"
            aria-label="表示範囲。ドラッグか矢印キーで移動、+ と - で拡大縮小"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={onKeyDown}
          >
            {size && (
              <img
                src={url}
                alt=""
                draggable={false}
                style={{
                  inlineSize: size.width * base,
                  blockSize: size.height * base,
                  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                }}
              />
            )}
            <span className="cropper-mask" aria-hidden="true" />
          </div>
          <label className="cropper-zoom">
            拡大
            <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} disabled={!size} onChange={(e) => zoomTo(Number(e.target.value))} />
          </label>
          <p className="hint">ドラッグで位置を、ホイールかスライダーで大きさを調整できます。</p>
        </>
      )}
      <div className="actions">
        <button type="button" className="secondary" onClick={onCancel}>
          キャンセル
        </button>
        {!error && (
          <button type="button" disabled={!size || busy} onClick={apply}>
            この範囲で決定
          </button>
        )}
      </div>
    </dialog>
  );
}
