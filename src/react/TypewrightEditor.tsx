import * as React from 'react';
import type { DocChange, EditorConfig, EditorEvents } from '../types';

export interface TypewrightEditorProps extends EditorConfig, EditorEvents {
  /** Controlled document value. */
  value?: string;
  /** Uncontrolled initial value. */
  defaultValue?: string;
  className?: string;
  style?: React.CSSProperties;
}

let warned = false;

/**
 * Typewright — drop-in Markdown + MDX editor React component.
 *
 * ⚠️ PRE-ALPHA SCAFFOLD. The high-performance from-scratch engine described in
 * SPEC.md (incremental parser, virtualized view, unified live preview, folding,
 * tables, streaming) is not yet implemented. This placeholder renders an
 * accessible controlled `<textarea>` so the package installs and the API can be
 * integrated against — it is NOT the real editor and carries none of the
 * performance or rich-editing behaviour yet.
 */
export function TypewrightEditor(props: TypewrightEditorProps): React.ReactElement {
  const { value, defaultValue, onChange, className, style, placeholder, readOnly } = props;

  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState<string>(defaultValue ?? '');
  const current = isControlled ? value ?? '' : internal;

  React.useEffect(() => {
    if (!warned) {
      warned = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[typewright] pre-alpha scaffold: rendering a <textarea> fallback. ' +
          'The performance engine is not yet implemented — see SPEC.md.',
      );
    }
  }, []);

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const next = event.target.value;
    if (!isControlled) setInternal(next);
    const change: DocChange = { from: 0, to: current.length, insert: next };
    onChange?.(next, change);
  };

  return (
    <textarea
      data-typewright="scaffold"
      className={className}
      style={{
        width: '100%',
        minHeight: '12rem',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        ...style,
      }}
      value={current}
      placeholder={placeholder}
      readOnly={readOnly}
      spellCheck={false}
      onChange={handleChange}
    />
  );
}
