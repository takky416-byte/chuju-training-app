import type { ReactNode } from "react";

const FRACTION_PATTERN = /(\d+) (\d+)\/(\d+)|(\d+)\/(\d+)/g;

export function renderFractionText(text: string | undefined | null): ReactNode {
  if (!text) return text;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  FRACTION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FRACTION_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      parts.push(
        <span className="frac-mixed" key={key++}>
          <span className="frac-whole">{match[1]}</span>
          <span className="frac"><span className="frac-num">{match[2]}</span><span className="frac-den">{match[3]}</span></span>
        </span>
      );
    } else {
      parts.push(
        <span className="frac" key={key++}><span className="frac-num">{match[4]}</span><span className="frac-den">{match[5]}</span></span>
      );
    }
    lastIndex = FRACTION_PATTERN.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
