/* Minimal, safe markdown for chat replies: paragraphs, lists, **bold**, *italic*, `code` and links.
   Builds React elements only (no HTML injection) and opens links in a new tab. */
import { Fragment, type ReactNode } from "react";

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?"'])/g;

export type LinkHandler = (href: string) => void;

function inline(text: string, onLink?: LinkHandler): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const [token] = match;
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const key = `${index}-${token.length}`;
    if (token.startsWith("**")) out.push(<strong key={key}>{inline(token.slice(2, -2), onLink)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const label = token.slice(1, token.indexOf("]("));
      const href = token.slice(token.indexOf("](") + 2, -1);
      out.push(<a key={key} href={href} target="_blank" rel="noopener noreferrer" onClick={() => onLink?.(href)}>{label}</a>);
    } else if (token.startsWith("http")) {
      out.push(<a key={key} href={token} target="_blank" rel="noopener noreferrer" onClick={() => onLink?.(token)}>{token.replace(/^https?:\/\//, "").replace(/\?.*$/, "")}</a>);
    } else out.push(<em key={key}>{inline(token.slice(1, -1), onLink)}</em>);
    last = index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, onLink }: { text: string; onLink?: LinkHandler }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, index) => {
        const lines = block.split("\n").filter((line) => line.trim());
        if (!lines.length) return null;
        const bullet = lines.every((line) => /^\s*[-*•]\s+/.test(line));
        const numbered = lines.every((line) => /^\s*\d+[.)]\s+/.test(line));
        if (bullet || numbered) {
          const items = lines.map((line) => line.replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
          const List = numbered ? "ol" : "ul";
          return <List key={index}>{items.map((item, i) => <li key={i}>{inline(item, onLink)}</li>)}</List>;
        }
        const heading = lines.length === 1 && /^#{1,4}\s+/.test(lines[0]);
        if (heading) return <p key={index}><strong>{inline(lines[0].replace(/^#{1,4}\s+/, ""), onLink)}</strong></p>;
        return (
          <p key={index}>
            {lines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {inline(line.replace(/^\s*[-*•]\s+/, "• "), onLink)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
