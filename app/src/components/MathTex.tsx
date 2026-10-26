// KaTeX, rendered to a string once per change. Fonts ship with the package, so it works offline.
import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

export function MathTex({ tex, display = true, className = "" }: { tex: string; display?: boolean; className?: string }) {
  const html = useMemo(() => katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore", trust: false }), [tex, display]);
  return <span className={`mathtex ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Text that is safe inside \text{...}. */
export const texText = (s: string) => s.replace(/[\\{}$&#^_%~]/g, (c) => `\\${c === "\\" ? "textbackslash " : c}`);
