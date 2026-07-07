import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { TypewrightEditor, StreamingPreview } from '../src/react';
import type {
  CommentsOptions,
  CommentThread,
  EditorMode,
  Extensions,
  PresencePeer,
} from '../src/types';
import { DEMO_MDX_COMPONENTS, demoMathRender, demoMermaidEngine } from './engines';

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

## Extensions

Inline math renders through a host engine: $e = mc^2$ and the identity $a^2 + b^2 = c^2$.

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

A Mermaid diagram, rendered by a host-supplied engine inside the sandbox:

\`\`\`mermaid
graph TD
  A[Write Markdown] --> B[Parse to AST]
  B --> C[Render safely]
  C --> D[Ship it]
\`\`\`

MDX executes in an opaque-origin sandbox:

<Callout type="info">
  <div style="border-left:3px solid #6ea3ff;background:rgba(110,163,255,.12);padding:12px 14px;border-radius:10px;font:14px/1.55 system-ui">
    <strong>MDX runs in a sandbox.</strong> Compiled by the zero-dependency constrained transform and executed inside an opaque-origin iframe. A live host component cannot cross that boundary, so this callout is authored with built-in HTML the sandbox renders directly.
  </div>
</Callout>
`;

const STREAM = ['# Q3 ', 'Launch\n\n', 'The rollout is **bo', 'ld** and *phas', 'ed*.\n\n', '- Ship\n', '- Measure\n', '- Iterate\n\n', '```ts\n', 'const plan = phases.map(run)\n', '```\n\n', '> Ship it.'];
const MODES: EditorMode[] = ['edit', 'unified', 'preview', 'read'];
const PEOPLE: Record<string, string> = { You: '#6ea3ff', 'Priya N.': '#e0b24d', 'Sam K.': '#58c295', 'Ana R.': '#c98bff' };
const initials = (n: string): string => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

/** The current demo user — authors new threads/replies/reactions (CommentsOptions.me). */
const ME = { id: 'you', name: 'You' } as const;

const HOUR = 3_600_000;
const iso = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();
const newId = (): string => `c-${Math.random().toString(36).slice(2, 9)}`;

/** Locate a quote in the sample document to seed a real comment anchor (offset range). */
function anchorFor(quote: string): { from: number; to: number } {
  const from = SAMPLE.indexOf(quote);
  return from < 0 ? { from: 0, to: quote.length } : { from, to: from + quote.length };
}

/**
 * Seed threads in the real {@link CommentThread} shape (anchor + quote + author +
 * body + reactions as emoji→userIds + replies). The demo holds these in state and
 * IS the host transport: the editor's callbacks mutate this state.
 */
const SEED_THREADS: CommentThread[] = [
  {
    id: 't1',
    anchor: anchorFor('from-scratch'),
    quote: 'from-scratch',
    author: 'Priya N.',
    body: 'Love that this is zero-dependency. Worth calling out in the README?',
    createdAt: iso(2 * HOUR),
    reactions: { '👍': ['sam', 'ana'], '🎯': ['priya'] },
    replies: [{ id: 'r1', author: 'You', body: 'Done — it leads the pitch now.', createdAt: iso(HOUR) }],
  },
  {
    id: 't2',
    anchor: anchorFor('GFM parsing'),
    quote: 'GFM parsing',
    author: 'Sam K.',
    body: 'Tables + task lists render great. Footnotes next?',
    createdAt: iso(3 * HOUR),
    reactions: { '👀': ['priya'] },
    replies: [],
  },
];

/** Remote collaborators passed as `presence` — one carries a live cursor. */
const cursorAt = (needle: string): { from: number; to: number } => {
  const at = SAMPLE.indexOf(needle);
  return { from: Math.max(0, at), to: Math.max(0, at) };
};
const PRESENCE: PresencePeer[] = [
  { id: 'priya', name: 'Priya N.', color: PEOPLE['Priya N.'], cursor: cursorAt('Content under the second') },
  { id: 'sam', name: 'Sam K.', color: PEOPLE['Sam K.'] },
  { id: 'ana', name: 'Ana R.', color: PEOPLE['Ana R.'] },
];

/** Toggle the current user's reaction on a thread (reactions are emoji → userId[]). */
function toggleReaction(thread: CommentThread, emoji: string): CommentThread {
  const reactions: Record<string, string[]> = { ...(thread.reactions ?? {}) };
  const users = new Set(reactions[emoji] ?? []);
  if (users.has(ME.id)) users.delete(ME.id);
  else users.add(ME.id);
  if (users.size === 0) delete reactions[emoji];
  else reactions[emoji] = [...users];
  return { ...thread, reactions };
}

/** A large synthetic document (headings + paragraphs) to exercise virtualization. */
function makeLargeDoc(n: number): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    if (i % 4 === 0) parts.push(`## Section ${i}`);
    else parts.push(`Paragraph ${i} with **bold** and _italic_ text and a [link](https://example.com/${i}).`);
  }
  return parts.join('\n\n');
}

function ThemeIcon(): React.ReactElement {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" strokeLinecap="round" /></svg>;
}

/** Extension switches — every one is REAL now (drives the `extensions`/`folding` props). */
const EXT_KEYS = [
  { key: 'gfm', label: 'GitHub Flavored MD', tk: 'gfm' },
  { key: 'syntaxHighlight', label: 'Syntax highlighting', tk: 'syntaxHighlight' },
  { key: 'folding', label: 'Section folding', tk: 'folding' },
  { key: 'mdx', label: 'MDX (sandboxed)', tk: 'mdx' },
  { key: 'mermaid', label: 'Mermaid diagrams', tk: 'mermaid' },
  { key: 'math', label: 'Math', tk: 'math' },
] as const;

type ExtState = Record<(typeof EXT_KEYS)[number]['key'], boolean>;

function App(): React.ReactElement {
  const [md, setMd] = React.useState(SAMPLE);
  const [mode, setMode] = React.useState<EditorMode>('unified');
  const [theme, setTheme] = React.useState<'dark' | 'light'>('dark');
  const [toolbarMode, setToolbarMode] = React.useState<'floating' | 'docked'>('floating');
  const [exts, setExts] = React.useState<ExtState>({ gfm: true, syntaxHighlight: true, folding: true, mdx: true, mermaid: true, math: true });
  const [threads, setThreads] = React.useState<CommentThread[]>(SEED_THREADS);
  const [stream, setStream] = React.useState('');

  React.useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  const play = (): void => {
    setStream('');
    let t = ''; let i = 0;
    const id = setInterval(() => { t += STREAM[i++] ?? ''; setStream(t); if (i >= STREAM.length) clearInterval(id); }, 110);
  };

  // Real `extensions` wiring: syntax highlighting needs no engine; math/mermaid/mdx
  // get the small demo engines (host-supplied, exactly as a real integration would).
  const extensions = React.useMemo<Extensions>(
    () => ({
      gfm: exts.gfm,
      syntaxHighlight: exts.syntaxHighlight,
      math: { enabled: exts.math, render: demoMathRender },
      mermaid: { enabled: exts.mermaid, getEngine: demoMermaidEngine },
      mdx: { enabled: exts.mdx, transform: 'constrained', components: DEMO_MDX_COMPONENTS },
    }),
    [exts],
  );

  // Real `comments` wiring: controlled data-in / events-out. The demo state IS the
  // host transport — every callback mutates `threads`, which flows back in as the
  // source of truth (the editor renders the sidebar + anchored highlights itself).
  const comments = React.useMemo<CommentsOptions>(
    () => ({
      enabled: true,
      threads,
      me: ME,
      onCreate: ({ anchor, quote, body }) =>
        setThreads((ts) => [
          ...ts,
          { id: newId(), anchor, quote, author: ME.name, body, createdAt: new Date().toISOString(), reactions: {}, replies: [] },
        ]),
      onReply: (threadId, body) =>
        setThreads((ts) =>
          ts.map((t) =>
            t.id === threadId
              ? { ...t, replies: [...t.replies, { id: newId(), author: ME.name, body, createdAt: new Date().toISOString() }] }
              : t,
          ),
        ),
      onReact: (threadId, emoji) => setThreads((ts) => ts.map((t) => (t.id === threadId ? toggleReaction(t, emoji) : t))),
      onResolve: (threadId, resolved) => setThreads((ts) => ts.map((t) => (t.id === threadId ? { ...t, resolved } : t))),
      onDelete: (threadId) => setThreads((ts) => ts.filter((t) => t.id !== threadId)),
    }),
    [threads],
  );

  const propStr = (): React.ReactElement => (
    <>
      <span className="t">&lt;TypewrightEditor</span><br />
      &nbsp;&nbsp;<span className="k">value</span>=<span className="s2">{'{md}'}</span> <span className="k">onChange</span>=<span className="s2">{'{setMd}'}</span><br />
      &nbsp;&nbsp;<span className="k">mode</span>=<span className="s2">"{mode}"</span><br />
      &nbsp;&nbsp;<span className="k">extensions</span>=<span className="s2">{'{{ syntaxHighlight, math, mermaid, mdx }}'}</span><br />
      &nbsp;&nbsp;<span className="k">comments</span>=<span className="s2">{'{{ enabled, threads, me, onCreate, … }}'}</span><br />
      &nbsp;&nbsp;<span className="k">presence</span>=<span className="s2">{'{peers}'}</span> <span className="k">settings</span><br />
      &nbsp;&nbsp;<span className="k">folding</span>=<span className="s2">{`{${exts.folding}}`}</span> <span className="k">theme</span>=<span className="s2">{`{{ appearance: "${theme}" }}`}</span><br />
      <span className="t">/&gt;</span>
    </>
  );

  return (
    <>
      <div className="topbar">
        <div className="wrap row">
          <div className="brand"><span className="glyph">T</span> Typewright</div>
          <span className="spacer" />
          <div className="presence" title="Live presence — passed to the editor via the presence prop">
            {Object.keys(PEOPLE).map((n) => <span key={n} className="av" style={{ background: PEOPLE[n] }} title={n}>{initials(n)}</span>)}
          </div>
          <a className="tlink" href="./design-prototype.html">Design vision</a>
          <a className="tlink" href="https://github.com/lprhodes/typewright">GitHub</a>
          <button className="iconbtn" aria-label="Toggle theme" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}><ThemeIcon /></button>
        </div>
      </div>

      <div className="wrap">
        <section className="hero">
          <span className="eyebrow"><span className="dot" /> Live editor · real engine surfaces</span>
          <h1 className="title">A fast, from-scratch <em>Markdown</em> editor</h1>
          <p className="sub">The editing surface below runs the real <code>typewright</code> engine — including comments &amp; presence, the settings panel + ⌘K palette, syntax colouring, and the sandboxed MDX / Mermaid / math extensions. Select text to comment; press <kbd>⌘K</kbd> for the command palette.</p>
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
              <div data-testid="editor" style={{ maxHeight: 480, overflow: 'auto' }}>
                <TypewrightEditor
                  value={md}
                  onChange={setMd}
                  mode={mode}
                  extensions={extensions}
                  folding={exts.folding}
                  comments={comments}
                  presence={PRESENCE}
                  settings={{ enabled: true }}
                  toolbar={toolbarMode}
                  theme={{ appearance: theme }}
                />
              </div>
            </div>

            <aside className="side">
              <div className="pane">
                <div>
                  <h4>Extensions</h4>
                  {EXT_KEYS.map((e) => {
                    const on = exts[e.key];
                    return (
                      <div className="toggle" key={e.key}>
                        <label>{e.label} <span className="tk">{e.tk}</span></label>
                        <button
                          className="sw"
                          role="switch"
                          aria-checked={on}
                          aria-label={e.label}
                          onClick={() => setExts((x) => ({ ...x, [e.key]: !x[e.key] }))}
                        />
                      </div>
                    );
                  })}
                </div>
                <div>
                  <h4>Toolbar</h4>
                  <div className="seg" role="group" style={{ width: '100%' }}>
                    <button style={{ flex: 1 }} aria-pressed={toolbarMode === 'floating'} onClick={() => setToolbarMode('floating')}>Floating</button>
                    <button style={{ flex: 1 }} aria-pressed={toolbarMode === 'docked'} onClick={() => setToolbarMode('docked')}>Docked</button>
                  </div>
                </div>
                <div><h4>Drop-in usage</h4><div className="props">{propStr()}</div></div>
                <div className="tip"><span>💡</span><span>Select text in the editor to start a comment thread. The 💬 toggle and ⚙ settings gear sit in the editor's top-right; ⌘K opens the command palette.</span></div>
              </div>
            </aside>
          </div>
        </div>
        <div className="meta" data-testid="value-len">len:{md.length} · mode:{mode}</div>
        <button className="btn" data-testid="load-large" style={{ marginTop: 6 }} onClick={() => { setMode('unified'); setMd(makeLargeDoc(800)); }}>Load large doc (virtualization)</button>

        <p className="section-label">Streaming preview</p>
        <button className="btn" data-testid="play-stream" onClick={play}>▶ Play stream</button>
        <div className="card" style={{ marginTop: 10 }}>
          <div data-testid="stream" style={{ minHeight: 130, padding: 4 }}>
            <StreamingPreview text={stream} anticipate className={theme === 'dark' ? 'tw-theme-dark' : 'tw-theme-light'} />
          </div>
        </div>

        <p className="note"><b>This is the real engine.</b> Comments &amp; presence, the settings panel + ⌘K command palette, native syntax colouring, section folding, and the sandboxed MDX / Mermaid / math extensions are all live here — driven by the same props a host app passes. The demo supplies small toy engines for math (a KaTeX-shaped renderer) and Mermaid (a flowchart engine inlined into the sandbox); a real integration plugs in KaTeX / Mermaid instead. <b>One honest limitation:</b> compiled MDX runs inside an opaque-origin sandbox reached only by <code>postMessage</code>, so live host React components can't cross that boundary — the demo authors its MDX with the built-in HTML the sandbox renders directly. See the full vision in the <a href="./design-prototype.html">design prototype</a> and the <a href="../SPEC.md#15-roadmap">roadmap</a>.</p>
      </div>

      <footer><div className="wrap frow">
        <div className="brand" style={{ fontSize: 15 }}><span className="glyph" style={{ width: 22, height: 22, fontSize: 13 }}>T</span> Typewright</div>
        <span className="spacer" style={{ flex: 1 }} />
        <a href="https://github.com/lprhodes/typewright">GitHub</a><a href="../SPEC.md">Spec</a><a href="https://www.npmjs.com/package/typewright">npm</a><span>MIT © Luke Rhodes</span>
      </div></footer>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
