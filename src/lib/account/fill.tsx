import { Fragment, type ReactNode } from "react";

/**
 * Fills "{name}" placeholders of a translated sentence with React nodes (for
 * example a <Num> or a direction-isolated e-mail address), keeping the word
 * order of each language. Unknown placeholders are left as written.
 */
export function fill(template: string, values: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/(\{[a-zA-Z]+\})/g);
  return parts.map((part, i) => {
    const m = /^\{([a-zA-Z]+)\}$/.exec(part);
    if (m && m[1] in values) return <Fragment key={i}>{values[m[1]]}</Fragment>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
