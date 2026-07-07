import * as React from 'react';
import type { CommentThread } from '../types';

/**
 * Comments & presence — right-docked review sidebar (SPEC.md §14; plan A4).
 *
 * A controlled, data-in/events-out surface: the host owns the `threads` and the
 * component only emits edit intents (reply/react/resolve/delete). It stores
 * nothing. Anchoring/highlighting lives in the editor; this panel is the thread
 * list + composer + reactions UI.
 *
 * Styles ship as {@link COMMENTS_CSS} so the editor can concatenate them into
 * its single injected stylesheet (`tw-*` classes, `--tw-*` tokens).
 */

/** The fixed reaction set (K-7; mirrors the design demo). */
export const REACT_EMOJI = ['👍', '🎯', '👀', '🎉'] as const;

type ReactEmoji = (typeof REACT_EMOJI)[number];

export interface CommentsSidebarProps {
  /** All threads to render; the host is the source of truth. */
  threads: CommentThread[];
  /** The current user; used to author replies and highlight own reactions. */
  me?: { id: string; name: string };
  /** Whether the panel is open. Renders `null` when closed. */
  open: boolean;
  /** Close the panel. */
  onClose: () => void;
  onReply: (threadId: string, body: string) => void;
  onReact: (threadId: string, emoji: string) => void;
  onResolve: (threadId: string, resolved: boolean) => void;
  onDelete?: (threadId: string) => void;
  /** Thread to highlight + scroll into view (e.g. the clicked anchor). */
  activeThreadId?: string;
  /** Fired when a thread card is selected (scrolls the editor to its anchor). */
  onSelectThread?: (threadId: string) => void;
}

export function CommentsSidebar(props: CommentsSidebarProps): React.JSX.Element | null {
  const {
    threads,
    me,
    open,
    onClose,
    onReply,
    onReact,
    onResolve,
    onDelete,
    activeThreadId,
    onSelectThread,
  } = props;

  const activeElRef = React.useRef<HTMLElement | null>(null);
  const [flashId, setFlashId] = React.useState<string | undefined>(undefined);

  // Scroll the active thread into view and flash its card when it changes.
  React.useEffect(() => {
    if (!open || !activeThreadId) return;
    activeElRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setFlashId(activeThreadId);
    const t = setTimeout(() => setFlashId(undefined), 1400);
    return () => clearTimeout(t);
  }, [open, activeThreadId]);

  if (!open) return null;

  const count = threads.length;

  return (
    <aside
      className="tw-comments-sidebar"
      role="complementary"
      aria-label="Comments"
      data-typewright="comments"
    >
      <header className="tw-comments-head">
        <span className="tw-comments-title">Comments</span>
        <span className="tw-comments-count" aria-label={`${count} comment${count === 1 ? '' : 's'}`}>
          {count}
        </span>
        <button
          type="button"
          className="tw-comments-close"
          aria-label="Close comments panel"
          onClick={onClose}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div className="tw-comments-body">
        {count === 0 ? (
          <div className="tw-comments-empty">
            No comments yet.
            <br />
            Select text in the editor to start a thread.
          </div>
        ) : (
          threads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              me={me}
              active={thread.id === activeThreadId}
              flash={thread.id === flashId}
              innerRef={thread.id === activeThreadId ? (el) => { activeElRef.current = el; } : undefined}
              onReply={onReply}
              onReact={onReact}
              onResolve={onResolve}
              onDelete={onDelete}
              onSelect={onSelectThread}
            />
          ))
        )}
      </div>
    </aside>
  );
}

interface ThreadCardProps {
  thread: CommentThread;
  me?: { id: string; name: string };
  active: boolean;
  flash: boolean;
  innerRef?: (el: HTMLElement | null) => void;
  onReply: (threadId: string, body: string) => void;
  onReact: (threadId: string, emoji: string) => void;
  onResolve: (threadId: string, resolved: boolean) => void;
  onDelete?: (threadId: string) => void;
  onSelect?: (threadId: string) => void;
}

function ThreadCard(props: ThreadCardProps): React.JSX.Element {
  const { thread, me, active, flash, innerRef, onReply, onReact, onResolve, onDelete, onSelect } = props;
  const [draft, setDraft] = React.useState('');

  const submitReply = React.useCallback(() => {
    const body = draft.trim();
    if (!body) return;
    onReply(thread.id, body);
    setDraft('');
  }, [draft, onReply, thread.id]);

  const cls = [
    'tw-comment-thread',
    thread.resolved ? 'resolved' : '',
    active ? 'tw-comment-thread--active' : '',
    flash ? 'tw-comment-thread--flash' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const selectFromCard = (e: React.MouseEvent<HTMLElement>) => {
    if (!onSelect) return;
    // Don't hijack clicks on interactive children (buttons/inputs).
    if ((e.target as HTMLElement).closest('button, textarea, input, a')) return;
    onSelect(thread.id);
  };

  return (
    <article ref={innerRef} className={cls} onClick={selectFromCard}>
      {thread.quote ? <div className="tw-comment-quote">“{thread.quote}”</div> : null}

      <CommentRow author={thread.author} body={thread.body} createdAt={thread.createdAt} />

      <div className="tw-comment-reacts">
        {REACT_EMOJI.map((emoji) => {
          const users = thread.reactions?.[emoji];
          const n = users?.length ?? 0;
          const mine = !!(me && users?.includes(me.id));
          return (
            <button
              type="button"
              key={emoji}
              className="tw-comment-react"
              aria-pressed={mine}
              aria-label={`React ${emoji}${n ? `, ${n}` : ''}`}
              onClick={() => onReact(thread.id, emoji)}
            >
              <span aria-hidden="true">{emoji}</span>
              {n > 0 ? <span className="tw-comment-react-n">{n}</span> : null}
            </button>
          );
        })}
      </div>

      {thread.replies.length > 0 ? (
        <div className="tw-comment-replies">
          {thread.replies.map((r) => (
            <CommentRow key={r.id} author={r.author} body={r.body} createdAt={r.createdAt} />
          ))}
        </div>
      ) : null}

      <div className="tw-comment-reply">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submitReply();
            }
          }}
          placeholder="Reply…"
          aria-label="Reply to thread"
          rows={1}
        />
        <button
          type="button"
          className="tw-comment-btn"
          aria-label="Send reply"
          disabled={!draft.trim()}
          onClick={submitReply}
        >
          Send
        </button>
      </div>

      <div className="tw-comment-actions">
        {onDelete ? (
          <button
            type="button"
            className="tw-comment-btn tw-comment-del"
            aria-label="Delete thread"
            onClick={() => onDelete(thread.id)}
          >
            Delete
          </button>
        ) : null}
        <button
          type="button"
          className="tw-comment-btn"
          aria-label={thread.resolved ? 'Reopen thread' : 'Resolve thread'}
          aria-pressed={!!thread.resolved}
          onClick={() => onResolve(thread.id, !thread.resolved)}
        >
          {thread.resolved ? 'Reopen' : 'Resolve'}
        </button>
      </div>
    </article>
  );
}

function CommentRow(props: { author: string; body: string; createdAt?: string }): React.JSX.Element {
  const { author, body, createdAt } = props;
  const when = formatWhen(createdAt);
  return (
    <div className="tw-comment-row">
      <span className="tw-comment-av" style={{ background: avatarColor(author) }} aria-hidden="true">
        {initials(author)}
      </span>
      <div>
        <div className="tw-comment-who">
          {author}
          {when ? <span className="tw-comment-when">{when}</span> : null}
        </div>
        <div className="tw-comment-text">{body}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Presentation helpers (zero-dep)
 * ------------------------------------------------------------------ */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase() || '?';
}

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 58% 60%)`;
}

/** Short relative time for a host-supplied ISO-8601 timestamp. */
function formatWhen(iso?: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'now';
  const m = s / 60;
  if (m < 45) return `${Math.round(m)}m`;
  const hrs = m / 60;
  if (hrs < 24) return `${Math.round(hrs)}h`;
  const d = hrs / 24;
  if (d < 7) return `${Math.round(d)}d`;
  const w = d / 7;
  if (w < 5) return `${Math.round(w)}w`;
  return new Date(t).toLocaleDateString();
}

/* ------------------------------------------------------------------ *
 * Styles — concatenated into the editor's single injected stylesheet.
 * ------------------------------------------------------------------ */

export const COMMENTS_CSS = `
.tw-comments-sidebar { --tw-fg:#1a1d20; --tw-muted:#5a6169; --tw-faint:#8b929a; --tw-bg:#ffffff; --tw-chip:#f0f1f3; --tw-line:rgba(18,22,27,.1); --tw-accent:#2f6fed; --tw-accent-soft:rgba(47,111,237,.1); position:absolute; top:0; right:0; bottom:0; width:min(340px,82vw); display:flex; flex-direction:column; box-sizing:border-box; background:var(--tw-bg); color:var(--tw-fg); border-left:1px solid var(--tw-line); font-family:-apple-system,"SF Pro Text",system-ui,sans-serif; font-size:15px; line-height:1.5; z-index:20; box-shadow:-8px 0 24px -18px rgba(0,0,0,.4); animation:tw-comments-in .26s cubic-bezier(.32,.72,0,1) both; }
@media (prefers-color-scheme: dark) { .tw-comments-sidebar:not(.tw-theme-light) { --tw-fg:#e8eaed; --tw-muted:#a3abb2; --tw-faint:#6a727a; --tw-bg:#0f1215; --tw-chip:#1e242b; --tw-line:rgba(255,255,255,.1); --tw-accent:#6ea3ff; --tw-accent-soft:rgba(110,163,255,.14); } }
.tw-comments-sidebar.tw-theme-dark, :root[data-theme="dark"] .tw-comments-sidebar { --tw-fg:#e8eaed; --tw-muted:#a3abb2; --tw-faint:#6a727a; --tw-bg:#0f1215; --tw-chip:#1e242b; --tw-line:rgba(255,255,255,.1); --tw-accent:#6ea3ff; --tw-accent-soft:rgba(110,163,255,.14); }
:root[data-theme="light"] .tw-comments-sidebar { --tw-fg:#1a1d20; --tw-muted:#5a6169; --tw-faint:#8b929a; --tw-bg:#ffffff; --tw-chip:#f0f1f3; --tw-line:rgba(18,22,27,.1); --tw-accent:#2f6fed; --tw-accent-soft:rgba(47,111,237,.1); }
@keyframes tw-comments-in { from { transform:translateX(16px); opacity:0 } to { transform:none; opacity:1 } }
.tw-comments-head { display:flex; align-items:center; gap:8px; padding:11px 14px; border-bottom:1px solid var(--tw-line); background:color-mix(in srgb, var(--tw-bg) 80%, transparent); backdrop-filter:blur(18px) saturate(1.6); -webkit-backdrop-filter:blur(18px) saturate(1.6); position:sticky; top:0; z-index:2; }
.tw-comments-title { font-size:14px; font-weight:660; letter-spacing:-.01em; }
.tw-comments-count { font-size:11.5px; font-weight:640; color:var(--tw-muted); background:var(--tw-chip); border:1px solid var(--tw-line); border-radius:999px; padding:1px 8px; line-height:1.5; }
.tw-comments-close { margin-left:auto; width:28px; height:28px; padding:0; border:1px solid transparent; background:transparent; color:var(--tw-muted); border-radius:7px; cursor:pointer; display:grid; place-items:center; transition:color .15s, background .15s; }
.tw-comments-close:hover { color:var(--tw-fg); background:var(--tw-accent-soft); }
.tw-comments-close:focus-visible { outline:2px solid var(--tw-accent); outline-offset:2px; }
.tw-comments-body { flex:1; overflow-y:auto; padding:12px; }
.tw-comments-empty { color:var(--tw-faint); font-size:13px; text-align:center; padding:34px 14px; line-height:1.55; }
.tw-comment-thread { border:1px solid var(--tw-line); border-radius:12px; padding:12px; margin-bottom:12px; background:var(--tw-bg); transition:box-shadow .2s, border-color .2s, opacity .2s; }
.tw-comment-thread:last-child { margin-bottom:0; }
.tw-comment-thread.resolved { opacity:.58; }
.tw-comment-thread--active { border-color:var(--tw-accent); }
.tw-comment-thread--flash { animation:tw-comment-flash 1.4s ease; }
@keyframes tw-comment-flash { 0%,100% { box-shadow:0 0 0 0 transparent } 12%,70% { box-shadow:0 0 0 3px var(--tw-accent-soft) } }
.tw-comment-quote { font-size:12px; color:var(--tw-muted); border-left:2px solid var(--tw-accent-soft); padding:1px 0 1px 8px; margin-bottom:8px; font-style:italic; }
.tw-comment-row { display:flex; gap:8px; margin-bottom:8px; }
.tw-comment-av { width:24px; height:24px; border-radius:50%; display:grid; place-items:center; font-size:10px; font-weight:640; color:#0b0d0f; flex:none; }
.tw-comment-who { font-size:12.5px; font-weight:600; }
.tw-comment-when { font-size:11px; color:var(--tw-faint); margin-left:6px; font-weight:400; }
.tw-comment-text { font-size:13px; color:var(--tw-fg); margin-top:1px; white-space:pre-wrap; overflow-wrap:anywhere; }
.tw-comment-reacts { display:flex; gap:5px; flex-wrap:wrap; margin:6px 0 4px 32px; }
.tw-comment-react { font-size:12px; border:1px solid var(--tw-line); background:var(--tw-chip); color:var(--tw-muted); border-radius:999px; padding:2px 8px; display:inline-flex; gap:4px; align-items:center; cursor:pointer; transition:border-color .15s, background .15s, color .15s; }
.tw-comment-react:hover { border-color:var(--tw-accent); }
.tw-comment-react[aria-pressed="true"] { border-color:var(--tw-accent); background:var(--tw-accent-soft); color:var(--tw-accent); }
.tw-comment-react:focus-visible { outline:2px solid var(--tw-accent); outline-offset:2px; }
.tw-comment-react-n { font-variant-numeric:tabular-nums; font-size:11px; }
.tw-comment-replies { margin-left:32px; border-left:1px solid var(--tw-line); padding-left:10px; margin-top:6px; }
.tw-comment-replies .tw-comment-row:last-child { margin-bottom:0; }
.tw-comment-reply { display:flex; gap:6px; align-items:flex-end; margin:8px 0 2px 32px; }
.tw-comment-reply textarea { flex:1; min-width:0; min-height:33px; max-height:120px; box-sizing:border-box; resize:none; background:var(--tw-bg); border:1px solid var(--tw-line); border-radius:8px; padding:7px 9px; font:inherit; font-size:12.5px; line-height:1.4; color:var(--tw-fg); outline:none; transition:border-color .15s; }
.tw-comment-reply textarea:focus { border-color:var(--tw-accent); }
.tw-comment-reply textarea::placeholder { color:var(--tw-faint); }
.tw-comment-btn { border:1px solid var(--tw-line); background:var(--tw-chip); color:var(--tw-muted); border-radius:8px; padding:5px 10px; font:inherit; font-size:12px; cursor:pointer; white-space:nowrap; transition:color .15s, border-color .15s, background .15s; }
.tw-comment-btn:hover { color:var(--tw-fg); border-color:var(--tw-accent); }
.tw-comment-btn:focus-visible { outline:2px solid var(--tw-accent); outline-offset:2px; }
.tw-comment-btn:disabled { opacity:.5; cursor:default; }
.tw-comment-btn:disabled:hover { color:var(--tw-muted); border-color:var(--tw-line); }
.tw-comment-actions { display:flex; justify-content:flex-end; align-items:center; gap:6px; margin-top:8px; }
.tw-comment-del { margin-right:auto; }
.tw-comment-del:hover { color:#e5484d; border-color:#e5484d; }
@media (prefers-reduced-transparency: reduce) { .tw-comments-head { backdrop-filter:none; -webkit-backdrop-filter:none; background:var(--tw-bg); } }
@media (prefers-reduced-motion: reduce) { .tw-comments-sidebar, .tw-comment-thread--flash { animation:none !important; } }
`;
