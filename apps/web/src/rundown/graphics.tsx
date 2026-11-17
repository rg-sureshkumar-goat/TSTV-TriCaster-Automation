// The files attached to a rundown's graphics (RG, Nov 17, 2026). Each graphic in a section's Graphics column
// has a Choose graphic button: the file goes straight from this computer to Google Drive, into the episode's
// folder, with a progress bar, and then shows beside the graphic. RiGster downloads each one onto its cue.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api.ts';
import { graphicFormatProblems, graphicsDeleteDate, isAttachable, isFormatChecked, readVideoFormat, type AttachedGraphic, type Element } from '@tstv/shared';

export interface EpisodeGraphics {
  driveConnected: boolean;
  deleteOn: string | null;
  deletedAt: number | null;
  folderUrl: string | null;
  graphics: AttachedGraphic[];
}

interface GraphicsContextValue {
  episodeId: string;
  data: EpisodeGraphics | null;
  /** Percent sent, for each graphic whose file is on its way. */
  sending: Record<string, number>;
  /** Whether files can change: not for an archived episode, or once its graphics were deleted. */
  canChange: boolean;
  choose: (element: Element) => void;
  remove: (element: Element) => void;
}

const GraphicsContext = createContext<GraphicsContextValue | null>(null);

/** The attached graphics for the rundown inside it. Checked again every 30 seconds, for others' uploads. */
export function GraphicsProvider({ episodeId, readOnly, onError, children }: { episodeId: string; readOnly: boolean; onError: (message: string) => void; children: ReactNode }) {
  const [data, setData] = useState<EpisodeGraphics | null>(null);
  const [sending, setSending] = useState<Record<string, number>>({});
  const load = useCallback(() => {
    api<EpisodeGraphics>(`/episodes/${episodeId}/graphics`).then(setData, () => undefined);
  }, [episodeId]);
  // Every 30 seconds; every 5 while a graphic is being converted, so its new file shows soon after.
  const converting = data?.graphics.some((g) => g.converting) ?? false;
  useEffect(() => {
    load();
    const timer = setInterval(load, converting ? 5_000 : 30_000);
    return () => clearInterval(timer);
  }, [load, converting]);

  const send = async (element: Element, file: File) => {
    const progress = (percent: number) => setSending((s) => ({ ...s, [element.id]: percent }));
    progress(0);
    try {
      // An L3, OTSL or OTSR: its format is read first, here, so one in the wrong format can be converted.
      const formatProblems = isFormatChecked(element.type) ? await formatProblemsOf(file) : [];
      const { uploadUrl } = await api<{ uploadUrl: string }>(`/episodes/${episodeId}/graphics/${element.id}/uploads`, {
        method: 'POST',
        body: { fileName: file.name, size: file.size, type: file.type || 'application/octet-stream', elementType: element.type },
      });
      const driveFileId = await sendToDrive(uploadUrl, file, progress);
      const done = await api<{ graphics: AttachedGraphic[] }>(`/episodes/${episodeId}/graphics/${element.id}`, {
        method: 'POST',
        body: { driveFileId, elementType: element.type, formatProblems },
      });
      setData((d) => (d ? { ...d, graphics: done.graphics } : d));
    } catch (e) {
      onError(`Couldn’t send ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(({ [element.id]: _, ...rest }) => rest);
    }
  };

  const choose = (element: Element) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,image/*,.mov,.mp4,.m4v,.mxf,.png,.jpg,.jpeg,.tif,.tiff';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void send(element, file);
    };
    input.click();
  };

  const remove = async (element: Element) => {
    const attached = data?.graphics.find((g) => g.elementId === element.id);
    if (!attached || !confirm(`Delete ${attached.fileName} from this graphic? It’s deleted from Google Drive for good.`)) return;
    try {
      const done = await api<{ graphics: AttachedGraphic[] }>(`/episodes/${episodeId}/graphics/${element.id}`, { method: 'DELETE' });
      setData((d) => (d ? { ...d, graphics: done.graphics } : d));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const canChange = !readOnly && !data?.deletedAt && data?.driveConnected === true;
  return <GraphicsContext.Provider value={{ episodeId, data, sending, canChange, choose, remove: (e) => void remove(e) }}>{children}</GraphicsContext.Provider>;
}

/**
 * What's wrong with a graphic's format (RG, Nov 17, 2026: 1080p, 29.97, ProRes 4444 with alpha, in a
 * QuickTime .mov), read from the file's own index without uploading it; nothing when it's right.
 */
async function formatProblemsOf(file: File): Promise<string[]> {
  const read = async (start: number, end: number) => new Uint8Array(await file.slice(start, end).arrayBuffer());
  const format = await readVideoFormat(read, file.size).catch(() => null);
  return graphicFormatProblems(file.name, format);
}

/** A file's size, like 172 MB. */
function size(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** Sends the file to Google's upload address, reporting progress, and returns the new file's id in the Drive. */
function sendToDrive(uploadUrl: string, file: File, progress: (percent: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && progress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      try {
        const id = (JSON.parse(xhr.responseText) as { id?: string }).id;
        if (xhr.status >= 200 && xhr.status < 300 && id) return resolve(id);
      } catch {
        // Falls through to the error below.
      }
      reject(new Error(`Google Drive answered ${xhr.status}.`));
    };
    xhr.onerror = () => reject(new Error('the connection to Google Drive dropped. Try again.'));
    xhr.send(file);
  });
}

/** Beside a graphic in the Graphics column: Choose graphic, its progress, or its file with Replace and ×. */
export function GraphicFile({ element }: { element: Element }) {
  const graphics = useContext(GraphicsContext);
  if (!graphics?.data || !isAttachable(element.type)) return null;
  const attached = graphics.data.graphics.find((g) => g.elementId === element.id);
  const percent = graphics.sending[element.id];
  if (percent !== undefined) {
    return (
      <span className="graphic-file sending" role="status" aria-label={`Sending ${element.type}: ${percent}%`}>
        <span className="graphic-progress" style={{ width: `${percent}%` }} />
        Sending… {percent}%
      </span>
    );
  }
  if (attached?.converting) {
    return (
      <span className="graphic-file converting" role="status" title="It isn’t in the right format (1080p, 29.97, ProRes 4444 with alpha, QuickTime), so it’s being converted. The converted file replaces it.">
        Converting {attached.fileName} to 1080p ProRes 4444…
      </span>
    );
  }
  if (attached) {
    return (
      <span className="graphic-file attached" title={`${attached.fileName} (${size(attached.size)})${attached.uploadedBy ? `, added by ${attached.uploadedBy}` : ''}`}>
        {/* The name opens its preview (RG, Nov 17, 2026); Replace and Delete sit beside it. */}
        <GraphicPreviewButton episodeId={graphics.episodeId} element={element} file={attached} />
        {graphics.canChange && (
          <>
            <button className="graphic-action" onClick={() => graphics.choose(element)} aria-label={`Replace ${attached.fileName} on ${element.type}`}>
              Replace
            </button>
            <button className="graphic-action danger" onClick={() => graphics.remove(element)} aria-label={`Delete ${attached.fileName} from ${element.type}`}>
              Delete
            </button>
          </>
        )}
        {attached.fixes && (
          <span className="graphic-tag converted" title={`Converted to 1080p, 29.97, ProRes 4444 with alpha. The original: ${attached.fixes.join('; ')}.`}>
            Converted
          </span>
        )}
        {attached.convertError && (
          <span className="graphic-tag failed" title={attached.convertError}>
            Not converted: {attached.convertError}
          </span>
        )}
      </span>
    );
  }
  if (!graphics.canChange) return null;
  return (
    <button className="graphic-choose" onClick={() => graphics.choose(element)} aria-label={`Choose graphic for ${element.type}${element.name ? ` ${element.name}` : ''}`}>
      Choose graphic
    </button>
  );
}

/** For the episode's details: when its graphics folder in Google Drive is deleted (two weeks after air). */
export function GraphicsDeleteNote({ airDate, formatDate }: { airDate: string; formatDate: (d: string) => string }) {
  const graphics = useContext(GraphicsContext);
  if (!graphics?.data?.driveConnected) return null;
  const { deletedAt, folderUrl, graphics: files } = graphics.data;
  const on = graphicsDeleteDate(airDate);
  return (
    <p className="muted small graphics-note">
      {deletedAt ? (
        <>Its graphics were deleted from Google Drive on {new Date(deletedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, two weeks after it aired.</>
      ) : on ? (
        <>
          Graphics in Google Drive{files.length ? ` (${files.length})` : ''}: deleted on <strong>{formatDate(on)}</strong>, two weeks after the air date.
        </>
      ) : (
        <>Graphics in Google Drive are deleted two weeks after the air date: set an air date to schedule it.</>
      )}
      {folderUrl && !deletedAt && (
        <>
          {' '}
          <a href={folderUrl} target="_blank" rel="noreferrer">
            Open its folder
          </a>
        </>
      )}
    </p>
  );
}

/** The green file name: opens the preview window. */
function GraphicPreviewButton({ episodeId, element, file }: { episodeId: string; element: Element; file: AttachedGraphic }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="link-button graphic-name" onClick={() => setOpen(true)} aria-label={`Preview ${file.fileName}`}>
        ✓ {file.fileName}
      </button>
      {open && (
        <GraphicPreview
          src={`/api/episodes/${episodeId}/graphics/${element.id}/media`}
          drivePlayer={`/episodes/${episodeId}/graphics/${element.id}/drive-player`}
          file={file}
          label={`${element.type}${element.name ? ` ${element.name}` : ''}`}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Whether this browser can't play the file itself: Chrome can't play Apple ProRes, which TSTV's graphics
 * are (.mov). Safari can. A file that fails to play once it's tried counts too (see GraphicPreview).
 */
function cannotPlayHere(fileName: string): boolean {
  if (!/\.mov$/i.test(fileName)) return false;
  return document.createElement('video').canPlayType('video/quicktime') === '';
}

const isImage = (name: string) => /\.(png|jpe?g|gif|tiff?)$/i.test(name);

/** Minutes and seconds, like 0:07 or 1:23. */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A graphic playing in a window over the rundown (RG, Nov 17, 2026), on a checkerboard so its see-through
 * parts show: play and pause, a bar to drag through it, and back or forward 10 seconds. Space plays and
 * pauses, ← and → skip 10 seconds, and Escape closes it. In a browser that can't play the file (Chrome and
 * Apple ProRes), it shows Google Drive's own player instead, as Drive does: Google's copy, with a black
 * background where the graphic is see-through, and Drive's own controls (RG, Nov 17, 2026).
 */
export function GraphicPreview({ src, drivePlayer, file, label, onClose }: { src: string; drivePlayer: string; file: AttachedGraphic; label: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const image = isImage(file.fileName);
  const [cannotPlay, setCannotPlay] = useState(() => !image && cannotPlayHere(file.fileName));
  /** Google Drive's player for the file, once the website has shared it; or why it couldn't. */
  const [player, setPlayer] = useState<{ url: string } | { error: string } | null>(null);
  useEffect(() => {
    if (!cannotPlay || player) return;
    api<{ playerUrl: string }>(drivePlayer, { method: 'POST' }).then(
      (r) => setPlayer({ url: r.playerUrl }),
      (e: unknown) => setPlayer({ error: e instanceof Error ? e.message : String(e) }),
    );
  }, [cannotPlay, player, drivePlayer]);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };
  const skip = (by: number) => {
    const v = video.current;
    if (v) v.currentTime = Math.min(Math.max(0, v.currentTime + by), v.duration || v.currentTime + by);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (image || cannotPlay) return;
    if (e.key === ' ') toggle();
    else if (e.key === 'ArrowLeft') skip(-10);
    else if (e.key === 'ArrowRight') skip(10);
    else return;
    e.preventDefault();
  };

  return (
    <dialog ref={dialog} className="graphic-preview" aria-label={`Preview of ${file.fileName}`} onClose={onClose} onKeyDown={keys} onClick={(e) => e.target === dialog.current && dialog.current?.close()}>
      <div className="graphic-preview-head">
        <h2>
          {label} <span className="muted">{file.fileName}</span>
        </h2>
        <button className="close-button" onClick={() => dialog.current?.close()} aria-label="Close the preview">
          ×
        </button>
      </div>
      <div className="graphic-preview-picture">
        {image ? (
          <img src={src} alt={file.fileName} />
        ) : cannotPlay ? (
          player && 'url' in player ? (
            <iframe className="graphic-preview-drive" src={player.url} title={`Google Drive’s player for ${file.fileName}`} allow="autoplay; fullscreen" />
          ) : (
            <p className="graphic-preview-note">
              {player && 'error' in player ? (
                <>
                  Google Drive’s player isn’t available: {player.error} Apple ProRes graphics (.mov) play in <strong>Safari</strong> on a Mac.
                </>
              ) : (
                'Opening Google Drive’s player…'
              )}
            </p>
          )
        ) : (
          <video
            ref={video}
            src={src}
            autoPlay
            playsInline
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setLength(e.currentTarget.duration)}
            onDurationChange={(e) => setLength(e.currentTarget.duration)}
            onError={() => setCannotPlay(true)}
            onClick={toggle}
          />
        )}
      </div>
      {cannotPlay && player && 'url' in player && (
        <p className="graphic-preview-drive-note muted small">
          Google Drive’s copy, as on Drive: it has no see-through parts, so they show black. If it says it’s still being processed, Google is preparing it: try
          again in a few minutes. <strong>Safari</strong> on a Mac plays the original, see-through parts and all.
        </p>
      )}
      {!image && !cannotPlay && (
        <div className="graphic-preview-controls">
          <button onClick={() => skip(-10)} aria-label="Back 10 seconds" title="Back 10 seconds (←)">
            « 10s
          </button>
          <button className="primary play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} title="Play or pause (Space)">
            {playing ? '❚❚' : '▶'}
          </button>
          <button onClick={() => skip(10)} aria-label="Forward 10 seconds" title="Forward 10 seconds (→)">
            10s »
          </button>
          <span className="graphic-preview-time">{clock(time)}</span>
          <input
            type="range"
            className="graphic-preview-bar"
            aria-label="Position in the graphic"
            min={0}
            max={length || 0}
            step={0.01}
            value={Math.min(time, length || 0)}
            onChange={(e) => {
              const v = video.current;
              if (v) v.currentTime = Number(e.target.value);
              setTime(Number(e.target.value));
            }}
          />
          <span className="graphic-preview-time">{clock(length)}</span>
        </div>
      )}
    </dialog>
  );
}
