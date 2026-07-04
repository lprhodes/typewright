import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { TypewrightEditor, StreamingPreview } from '../src/react';
import type { EditorMode } from '../src/types';

const SAMPLE = `# Typewright

A **from-scratch** Markdown editor with *live* preview, \`code\`, and [links](https://example.com).

## Features

- [x] GFM parsing
- [ ] MDX execution
- Fast

| Feature | Status |
| :- | -: |
| Parser | Shipped |
| Editor | Alpha |

\`\`\`ts
const x: number = 1;
\`\`\`

> A blockquote.

## Second section

Content under the second heading.
`;

const STREAM = ['# Q3 ', 'Plan\n\n', 'The rollout is **bo', 'ld** and ', 'phased.\n\n', '```ts\n', 'const p = 1;\n', '```\n\n', 'Ship it.'];
const MODES: EditorMode[] = ['edit', 'unified', 'preview', 'read'];
const PEOPLE: Record<string, string> = { You: '#6ea3ff', 'Priya N.': '#e0b24d', 'Sam K.': '#58c295', 'Ana R.': '#c98bff' };
const initials = (n: string): string => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

interface Thread {
  id: string; quote: string; author: string; when: string; body: string;
  reactions: Record<string, number>; mine: Record<string, boolean>;
  replies: { author: string; when: string; body: string }[];
}
const SEED_COMMENTS: Thread[] = [
  { id: 't1', quote: 'from-scratch', author: 'Priya N.', when: '2h', body: 'Love that this is zero-dependency. Worth calling out in the README?', reactions: { '👍': 2, '🎯': 1 }, mine: {}, replies: [{ author: 'You', when: '1h', body: 'Done — it leads the pitch now.' }] },
  { id: 't2', quote: 'GFM parsing', author: 'Sam K.', when: '3h', body: 'Tables + task lists render great. Footnotes next?', reactions: { '👀': 1 }, mine: {}, replies: [] },
];
const REACTS = ['👍', '🎯', '👀', '🎉'];

/* toolbar icons (design-preview) */
const TI: Record<string, React.ReactElement> = {
  link: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M9 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M15 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></svg>,
  code: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m8 6-5 6 5 6M16 6l5 6-5 6" /></svg>,
  ul: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" /></svg>,
  ol: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M10 6h11M10 12h11M10 18h11M4 4v4M3 8h2M3 14h2l-2 2h2" /></svg>,
  quote: <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 7H4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1a2 2 0 0 1-2 2H4v2h.5A3.5 3.5 0 0 0 8 17.5V9a2 2 0 0 0-1-2zM19 7h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1a2 2 0 0 1-2 2v2h.5a3.5 3.5 0 0 0 3.5-3.5V9a2 2 0 0 0-1-2z" /></svg>,
  hr: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M3 12h18" /></svg>,
  table: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14.5h18M9 4v16M15 4v16" /></svg>,
  cb: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m9 10-2 2 2 2M15 10l2 2-2 2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
};

function ThemeIcon(): React.ReactElement {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" strokeLinecap="round" /></svg>;
}

const EXT_KEYS = [
  { key: 'gfm', label: 'GitHub Flavored MD', tk: 'gfm', real: true },
  { key: 'folding', label: 'Section folding', tk: 'folding', real: true },
  { key: 'mdx', label: 'MDX v3', tk: 'mdx', real: false },
  { key: 'mermaid', label: 'Mermaid', tk: 'mermaid', real: false },
  { key: 'math', label: 'Math (KaTeX)', tk: 'math', real: false },
] as const;

function App(): React.ReactElement {
  const [md, setMd] = React.useState(SAMPLE);
  const [mode, setMode] = React.useState<EditorMode>('unified');
  const [theme, setTheme] = React.useState<'dark' | 'light'>('dark');
  const [tab, setTab] = React.useState<'setup' | 'comments'>('setup');
  const [toolbarMode, setToolbarMode] = React.useState<'floating' | 'docked'>('docked');
  const [exts, setExts] = React.useState({ gfm: true, folding: true, mdx: true, mermaid: true, math: true });
  const [comments, setComments] = React.useState<Thread[]>(SEED_COMMENTS);
  const [toast, setToast] = React.useState<string | null>(null);
  const [stream, setStream] = React.useState('');

  const toastTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  const flash = (m: string): void => { setToast(m); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 1800); };

  const play = (): void => {
    setStream('');
    let t = ''; let i = 0;
    const id = setInterval(() => { t += STREAM[i++] ?? ''; setStream(t); if (i >= STREAM.length) clearInterval(id); }, 110);
  };

  const toggleReact = (tid: string, e: string): void => setComments((cs) => cs.map((c) => {
    if (c.id !== tid) return c;
    const mine = { ...c.mine }; const reactions = { ...c.reactions };
    if (mine[e]) { reactions[e] = (reactions[e] ?? 1) - 1; if (!reactions[e]) delete reactions[e]; delete mine[e]; }
    else { reactions[e] = (reactions[e] ?? 0) + 1; mine[e] = true; }
    return { ...c, mine, reactions };
  }));

  const TOOL = (id: string, node: React.ReactNode, cls = ''): React.ReactElement => (
    <button className={`tbtn ${cls}`} title={`${id} — design preview`} onClick={() => flash('Formatting toolbar — designed, not yet wired to the v0.1.0 engine')}>{node}</button>
  );

  const propStr = (): React.ReactElement => (
    <>
      <span className="t">&lt;TypewrightEditor</span><br />
      &nbsp;&nbsp;<span className="k">value</span>=<span className="s2">{'{md}'}</span> <span className="k">onChange</span>=<span className="s2">{'{setMd}'}</span><br />
      &nbsp;&nbsp;<span className="k">mode</span>=<span className="s2">"{mode}"</span><br />
      &nbsp;&nbsp;<span className="k">folding</span>=<span className="s2">{`{${exts.folding}}`}</span><br />
      &nbsp;&nbsp;<span className="k">theme</span>=<span className="s2">{`{{ appearance: "${theme}" }}`}</span><br />
      <span className="t">/&gt;</span>
    </>
  );

  return (
    <>
      <div className="topbar">
        <div className="wrap row">
          <div className="brand"><span className="glyph">T</span> Typewright</div>
          <span className="spacer" />
          <div className="presence" title="Presence — design preview">
            {Object.keys(PEOPLE).map((n) => <span key={n} className="av" style={{ background: PEOPLE[n] }} title={n}>{initials(n)}</span>)}
          </div>
          <button className={`cbtn2${tab === 'comments' ? ' on' : ''}`} onClick={() => setTab((t) => (t === 'comments' ? 'setup' : 'comments'))}>
            💬 Comments <span className="cnt">{comments.length}</span>
          </button>
          <a className="tlink" href="./design-prototype.html">Design vision</a>
          <a className="tlink" href="https://github.com/lprhodes/typewright">GitHub</a>
          <button className="iconbtn" aria-label="Toggle theme" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}><ThemeIcon /></button>
        </div>
      </div>

      <div className="wrap">
        <section className="hero">
          <span className="eyebrow"><span className="dot" /> Live editor · design-preview chrome</span>
          <h1 className="title">A fast, from-scratch <em>Markdown</em> editor</h1>
          <p className="sub">The editing surface below runs the real <code>typewright</code> engine. The toolbar, comments, and presence are the <b>designed</b> surfaces on the roadmap — shown here as preview, tagged accordingly.</p>
          <div className="install"><span className="pl">$</span> npm install typewright</div>
        </section>

        <div className="card">
          <div className="card-head">
            <div className="traffic"><i /><i /><i /></div>
            <span className="doc-name">document.md</span>
            <span className="spacer" />
            <div className="seg" role="group" aria-label="Editor mode">
              {MODES.map((m) => <button key={m} data-mode={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m}</button>)}
            </div>
          </div>
          <div className="layout">
            <div className="editor-col">
              <div className={`toolbar${toolbarMode === 'floating' ? ' floatmode' : ''}`}>
                {TOOL('Bold', 'B', 'b')}{TOOL('Italic', 'I', 'i')}{TOOL('Strikethrough', 'S', 's')}{TOOL('Code', TI.code)}{TOOL('Link', TI.link)}
                <span className="tsep" />
                {TOOL('Heading', 'H')}{TOOL('Bullet list', TI.ul)}{TOOL('Numbered list', TI.ol)}{TOOL('Quote', TI.quote)}{TOOL('Divider', TI.hr)}
                <span className="tsep" />
                {TOOL('Table', TI.table)}{TOOL('Code block', TI.cb)}
              </div>
              <div data-testid="editor" style={{ maxHeight: 480, overflow: 'auto' }}>
                <TypewrightEditor value={md} onChange={setMd} mode={mode} folding={exts.folding} theme={{ appearance: theme }} />
              </div>
            </div>

            <aside className="side">
              <div className="side-tabs">
                <button data-tab="setup" aria-selected={tab === 'setup'} onClick={() => setTab('setup')}>Setup</button>
                <button data-tab="comments" aria-selected={tab === 'comments'} onClick={() => setTab('comments')}>Comments <span className="badge">{comments.length}</span></button>
              </div>

              <div className="pane" hidden={tab !== 'setup'}>
                <div>
                  <h4>Extensions</h4>
                  {EXT_KEYS.map((e) => {
                    const on = (exts as Record<string, boolean>)[e.key];
                    return (
                      <div className="toggle" key={e.key}>
                        <label>{e.label} <span className="tk">{e.tk}</span>{!e.real && <span className="preview-tag" style={{ marginLeft: 2 }}>soon</span>}</label>
                        <button className="sw" role="switch" aria-checked={on} onClick={() => { setExts((x) => ({ ...x, [e.key]: !(x as Record<string, boolean>)[e.key] })); if (!e.real) flash(`${e.label} — deferred (engine always parses GFM in v0.1.0)`); }} />
                      </div>
                    );
                  })}
                </div>
                <div>
                  <h4>Toolbar <span className="preview-tag">preview</span></h4>
                  <div className="seg" role="group" style={{ width: '100%' }}>
                    <button style={{ flex: 1 }} aria-pressed={toolbarMode === 'floating'} onClick={() => setToolbarMode('floating')}>Floating</button>
                    <button style={{ flex: 1 }} aria-pressed={toolbarMode === 'docked'} onClick={() => setToolbarMode('docked')}>Docked</button>
                  </div>
                </div>
                <div><h4>Drop-in usage</h4><div className="props">{propStr()}</div></div>
                <div className="tip"><span>💡</span><span>Unified mode: click any line to reveal its Markdown. Toggle Edit / Preview / Read above. This editor is the real engine.</span></div>
              </div>

              <div className="pane" hidden={tab !== 'comments'}>
                <h4 style={{ marginBottom: 6 }}>Threads <span className="preview-tag">design preview</span></h4>
                {comments.length === 0 ? <div className="cempty">No comments.</div> : comments.map((c) => (
                  <div className="cthread" key={c.id}>
                    <div className="cquote">“{c.quote}”</div>
                    <div className="cmt"><span className="av" style={{ background: PEOPLE[c.author] ?? '#888' }}>{initials(c.author)}</span><div><div className="who">{c.author}<span className="when">{c.when}</span></div><div className="ct">{c.body}</div></div></div>
                    <div className="reacts">
                      {REACTS.filter((e) => c.reactions[e]).map((e) => <button key={e} className={`react${c.mine[e] ? ' on' : ''}`} onClick={() => toggleReact(c.id, e)}>{e} {c.reactions[e]}</button>)}
                      <button className="react" onClick={() => toggleReact(c.id, '🎉')}>＋</button>
                    </div>
                    {c.replies.length > 0 && (
                      <div className="creplies">{c.replies.map((r, i) => <div className="cmt" key={i}><span className="av" style={{ background: PEOPLE[r.author] ?? '#888' }}>{initials(r.author)}</span><div><div className="who">{r.author}<span className="when">{r.when}</span></div><div className="ct">{r.body}</div></div></div>)}</div>
                    )}
                  </div>
                ))}
                <div className="tip"><span>💡</span><span>Comments + presence are a designed feature on the roadmap (SPEC.md §15) — interactive here, not yet in the engine.</span></div>
              </div>
            </aside>
          </div>
        </div>
        <div className="meta" data-testid="value-len">len:{md.length} · mode:{mode}</div>

        <p className="section-label">Streaming preview</p>
        <button className="btn" data-testid="play-stream" onClick={play}>▶ Play stream</button>
        <div className="card" style={{ marginTop: 10 }}>
          <div data-testid="stream" style={{ minHeight: 130, padding: 4 }}>
            <StreamingPreview text={stream} anticipate className={theme === 'dark' ? 'tw-theme-dark' : 'tw-theme-light'} />
          </div>
        </div>

        <p className="note"><b>What's real vs. preview.</b> Real (the shipped engine): the editor's four modes, unified block editing, GFM rendering, folding, theming, and streaming anticipation. Design-preview (roadmap, tagged above): the formatting toolbar, inline comments &amp; presence, and the MDX/Mermaid/math extensions. The full vision is the <a href="./design-prototype.html">design prototype</a>; details in the <a href="../SPEC.md#15-roadmap">roadmap</a>.</p>
      </div>

      <footer><div className="wrap frow">
        <div className="brand" style={{ fontSize: 15 }}><span className="glyph" style={{ width: 22, height: 22, fontSize: 13 }}>T</span> Typewright</div>
        <span className="spacer" style={{ flex: 1 }} />
        <a href="https://github.com/lprhodes/typewright">GitHub</a><a href="../SPEC.md">Spec</a><a href="https://www.npmjs.com/package/typewright">npm</a><span>MIT © Luke Rhodes</span>
      </div></footer>

      {toast && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'rgba(24,28,33,.92)', color: '#e8eaed', border: '1px solid rgba(255,255,255,.14)', borderRadius: 11, padding: '10px 16px', fontSize: 13.5, zIndex: 100, backdropFilter: 'blur(16px)' }}>{toast}</div>}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
