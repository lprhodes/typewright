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

function App(): React.ReactElement {
  const [md, setMd] = React.useState(SAMPLE);
  const [mode, setMode] = React.useState<EditorMode>('unified');
  const [stream, setStream] = React.useState('');

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

  const btn = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 8, border: '1px solid #333', cursor: 'pointer',
    background: active ? '#6ea3ff' : '#1a1e22', color: active ? '#08111f' : '#e8eaed',
  });

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: 24 }}>
      <h2>Typewright playground</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {MODES.map((m) => (
          <button key={m} data-mode={m} aria-pressed={mode === m} onClick={() => setMode(m)} style={btn(mode === m)}>
            {m}
          </button>
        ))}
      </div>
      <div data-testid="editor" style={{ border: '1px solid #222', borderRadius: 12, minHeight: 360, overflow: 'hidden' }}>
        <TypewrightEditor value={md} onChange={setMd} mode={mode} folding theme={{ appearance: 'dark' }} />
      </div>
      <div data-testid="value-len" style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12, color: '#8b929a' }}>
        len:{md.length}
      </div>

      <h3 style={{ marginTop: 32 }}>Streaming preview</h3>
      <button data-testid="play-stream" onClick={play} style={btn(false)}>Play stream</button>
      <div data-testid="stream" className="tw-theme-dark" style={{ border: '1px solid #222', borderRadius: 12, marginTop: 8, minHeight: 120, overflow: 'hidden' }}>
        <StreamingPreview text={stream} anticipate className="tw-theme-dark" />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
