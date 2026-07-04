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

const STREAM = [
  '# Q3 ', 'Plan\n\n', 'The rollout is **bo', 'ld** and ', 'phased.\n\n',
  '```ts\n', 'const p = 1;\n', '```\n\n', 'Ship it.',
];

const MODES: EditorMode[] = ['edit', 'unified', 'preview', 'read'];

function ThemeIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" strokeLinecap="round" />
    </svg>
  );
}

function App(): React.ReactElement {
  const [md, setMd] = React.useState(SAMPLE);
  const [mode, setMode] = React.useState<EditorMode>('unified');
  const [stream, setStream] = React.useState('');
  const [theme, setTheme] = React.useState<'dark' | 'light'>('dark');

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const play = (): void => {
    setStream('');
    let t = '';
    let i = 0;
    const id = setInterval(() => {
      t += STREAM[i++] ?? '';
      setStream(t);
      if (i >= STREAM.length) clearInterval(id);
    }, 110);
  };

  return (
    <>
      <div className="topbar">
        <div className="wrap row">
          <div className="brand"><span className="glyph">T</span> Typewright</div>
          <span className="spacer" />
          <a className="tlink" href="./design-prototype.html">Design vision</a>
          <a className="tlink" href="../SPEC.md">Spec</a>
          <a className="tlink" href="https://github.com/lprhodes/typewright">GitHub</a>
          <button className="iconbtn" aria-label="Toggle theme" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
            <ThemeIcon />
          </button>
        </div>
      </div>

      <div className="wrap">
        <section className="hero">
          <span className="eyebrow"><span className="dot" /> Live · powered by the real engine</span>
          <h1 className="title">A fast, from-scratch <em>Markdown</em> editor</h1>
          <p className="sub">This demo runs the actual <code>typewright</code> library — the hand-written GFM parser, sanitizing renderer, unified block-level editing, folding, and streaming anticipation. Edit below.</p>
          <div className="install"><span className="pl">$</span> npm install typewright</div>
        </section>

        <div className="card">
          <div className="card-head">
            <div className="traffic"><i /><i /><i /></div>
            <span className="doc-name">document.md</span>
            <span className="spacer" />
            <div className="seg" role="group" aria-label="Editor mode">
              {MODES.map((m) => (
                <button key={m} data-mode={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m}</button>
              ))}
            </div>
          </div>
          <div className="editor-host" data-testid="editor">
            <TypewrightEditor value={md} onChange={setMd} mode={mode} folding theme={{ appearance: theme }} />
          </div>
        </div>
        <div className="meta" data-testid="value-len">len:{md.length} · mode:{mode}</div>

        <p className="section-label">Streaming preview</p>
        <button className="btn" data-testid="play-stream" onClick={play}>▶ Play stream</button>
        <div className="card" style={{ marginTop: 10 }}>
          <div className="editor-host" data-testid="stream" style={{ minHeight: 130, padding: 4 }}>
            <StreamingPreview text={stream} anticipate className={theme === 'dark' ? 'tw-theme-dark' : 'tw-theme-light'} />
          </div>
        </div>

        <p className="note">
          <b>This is the shipped v0.1.0 slice.</b> Designed-but-deferred surfaces — inline comments &amp; presence,
          the floating formatting toolbar, in-place table editing, Mermaid, and MDX component execution — are shown in
          the <a href="./design-prototype.html">full design prototype</a> and tracked in the <a href="../SPEC.md#15-roadmap">roadmap</a>.
        </p>
      </div>

      <footer>
        <div className="wrap frow">
          <div className="brand" style={{ fontSize: 15 }}><span className="glyph" style={{ width: 22, height: 22, fontSize: 13 }}>T</span> Typewright</div>
          <span className="spacer" style={{ flex: 1 }} />
          <a href="https://github.com/lprhodes/typewright">GitHub</a>
          <a href="../SPEC.md">Architecture spec</a>
          <a href="https://www.npmjs.com/package/typewright">npm</a>
          <span>MIT © Luke Rhodes</span>
        </div>
      </footer>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
