/**
 * demo/engines.ts — small, self-contained "demo engines" that light up the real
 * Typewright extension hooks in the demo. These are deliberately tiny and are
 * NOT production math/diagram engines — a host would plug KaTeX / Mermaid in
 * here. They exist so the demo can drive the REAL extension surfaces
 * (`MathOptions.render`, `MermaidOptions.getEngine`, `MdxOptions`) end to end,
 * with honest, clearly-labelled toy implementations.
 */

/* ------------------------------------------------------------------ *
 * Math — a toy KaTeX-shaped renderer (MathOptions.render)
 * ------------------------------------------------------------------ *
 * `MathOptions.render(src, display)` must return ALREADY-SANITIZED HTML that the
 * renderer inserts verbatim (the host owns sanitization). This demo engine
 * escapes the raw TeX first and then only ever adds a fixed set of tags
 * (`<sup>`, `<sub>`, `<span>`, `<div>`) and a handful of symbol substitutions, so
 * the output can never carry markup from the source — safe by construction. It
 * is a demo, not a typesetter: superscripts, subscripts, simple fractions and a
 * few Greek/operator symbols only.
 */

const MATH_SYMBOLS: Record<string, string> = {
  '\\times': '×',
  '\\cdot': '·',
  '\\pm': '±',
  '\\div': '÷',
  '\\pi': 'π',
  '\\theta': 'θ',
  '\\alpha': 'α',
  '\\beta': 'β',
  '\\gamma': 'γ',
  '\\lambda': 'λ',
  '\\mu': 'μ',
  '\\infty': '∞',
  '\\sum': '∑',
  '\\prod': '∏',
  '\\int': '∫',
  '\\sqrt': '√',
  '\\approx': '≈',
  '\\neq': '≠',
  '\\le': '≤',
  '\\ge': '≥',
  '\\rightarrow': '→',
  '\\to': '→',
  '\\Rightarrow': '⇒',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Demo math renderer wired into `extensions.math.render`. */
export function demoMathRender(src: string, display: boolean): string {
  // 1) Escape first — everything below only adds fixed tags to escaped text.
  let h = escapeHtml(src.trim());
  // 2) \frac{a}{b} -> (a)/(b)
  h = h.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)');
  // 3) superscripts / subscripts: ^{...} ^x  and  _{...} _x
  h = h.replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>').replace(/\^(-?[\w+]+)/g, '<sup>$1</sup>');
  h = h.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>').replace(/_(-?[\w+]+)/g, '<sub>$1</sub>');
  // 4) symbol substitutions (plain string replace — no regex metachars)
  for (const key of Object.keys(MATH_SYMBOLS)) {
    h = h.split(key).join(MATH_SYMBOLS[key] as string);
  }
  const face = "font-family:'Times New Roman',Georgia,serif;font-style:italic";
  if (display) {
    return `<div style="${face};display:block;text-align:center;margin:.7em 0;font-size:1.2em">${h}</div>`;
  }
  return `<span style="${face};font-size:1.05em">${h}</span>`;
}

/* ------------------------------------------------------------------ *
 * Mermaid — a toy flowchart engine, injected INTO the sandbox
 * ------------------------------------------------------------------ *
 * `MermaidOptions.getEngine()` returns the JavaScript *source* of a
 * Mermaid-compatible engine, which Typewright inlines as a `<script>` inside the
 * opaque-origin sandbox iframe (the engine never runs in the host page). The
 * engine must define `self.__twMermaidRender(src): Promise<string>` returning
 * SVG (or a standard `self.mermaid`). This demo engine understands a tiny subset
 * of `graph`/`flowchart` syntax — `A[Label] --> B[Label]` edges — and lays the
 * nodes out top-to-bottom as rounded boxes joined by arrows. It is a demo, not
 * real Mermaid. Text uses `currentColor` so it follows the iframe's
 * `color-scheme` (set from the editor theme) in both light and dark.
 */
export const DEMO_MERMAID_ENGINE = `
self.__twMermaidRender = function (src) {
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  var order=[],label={},edges=[];
  function node(raw){
    var t=raw.replace(/\\|[^|]*\\|/g,'').trim();
    var m=t.match(/^([A-Za-z0-9_]+)\\s*(?:\\[([^\\]]*)\\]|\\(([^)]*)\\)|\\{([^}]*)\\})?/);
    if(!m)return null;
    var id=m[1],lbl=m[2]||m[3]||m[4];
    if(order.indexOf(id)<0){order.push(id);label[id]=lbl||id;}
    else if(lbl){label[id]=lbl;}
    return id;
  }
  var lines=src.split(/\\r?\\n/);
  for(var i=0;i<lines.length;i++){
    var ln=lines[i].trim();
    if(!ln||/^(graph|flowchart)\\b/i.test(ln)||/^%%/.test(ln))continue;
    var seg=ln.split(/\\s*(?:--+>?|==+>?)\\s*/);
    if(seg.length>=2){
      var prev=null;
      for(var j=0;j<seg.length;j++){
        var id=node(seg[j]);
        if(prev&&id)edges.push([prev,id]);
        if(id)prev=id;
      }
    }else{ node(ln); }
  }
  var W=240,H=52,GAP=32,PAD=14;
  var n=order.length;
  var height=PAD*2+n*H+(n>0?(n-1)*GAP:0);
  var width=W+PAD*2;
  var y={};
  for(var k=0;k<n;k++){y[order[k]]=PAD+k*(H+GAP);}
  var out='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'" font-family="system-ui,-apple-system,sans-serif">';
  out+='<defs><marker id="twa" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6 Z" fill="#6ea3ff"/></marker></defs>';
  for(var e=0;e<edges.length;e++){
    var a=edges[e][0],b=edges[e][1];
    if(y[a]==null||y[b]==null)continue;
    var x=PAD+W/2,y1=y[a]+H,y2=y[b];
    out+='<path d="M'+x+' '+y1+' L'+x+' '+y2+'" stroke="#6ea3ff" stroke-width="1.6" fill="none" marker-end="url(#twa)"/>';
  }
  for(var q=0;q<n;q++){
    var id2=order[q],yy=y[id2];
    out+='<rect x="'+PAD+'" y="'+yy+'" width="'+W+'" height="'+H+'" rx="10" fill="rgba(110,163,255,.14)" stroke="#6ea3ff" stroke-width="1.4"/>';
    out+='<text x="'+(PAD+W/2)+'" y="'+(yy+H/2+5)+'" text-anchor="middle" font-size="14" fill="currentColor">'+esc(label[id2])+'</text>';
  }
  out+='</svg>';
  return Promise.resolve(out);
};
`;

/** Stable `getEngine` identity so the sandbox is not recreated every render. */
export function demoMermaidEngine(): string {
  return DEMO_MERMAID_ENGINE;
}

/* ------------------------------------------------------------------ *
 * MDX components — the opaque-origin boundary, honestly
 * ------------------------------------------------------------------ *
 * DOCUMENTED LIMITATION. `MdxOptions.components` names components the MDX module
 * can reference (`<Callout/>`, `<Chart/>`). But compiled MDX runs INSIDE the
 * opaque-origin `<iframe sandbox="allow-scripts">`, reached only via
 * `postMessage`. A live React component is a function, and functions are NOT
 * structured-cloneable — they cannot cross that boundary. So a host React
 * component map can never render live inside the sandbox.
 *
 * What DOES work (and what this demo uses): the `constrained` transform compiles
 * MDX to `h()` calls that build real DOM inside the sandbox. Lowercase / built-in
 * HTML tags (`<div>`, `<strong>`, …) render directly with no host code crossing
 * the boundary. The demo therefore authors its MDX with built-in HTML (see the
 * `<Callout>` block in the sample doc, whose visible, styled content is a
 * sandbox-rendered `<div>`), rather than faking a live host component.
 *
 * The map below is passed through for completeness; the sample deliberately does
 * not depend on any entry resolving to a live host component.
 */
export const DEMO_MDX_COMPONENTS: Record<string, unknown> = {};
