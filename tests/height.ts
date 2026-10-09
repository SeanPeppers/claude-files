import { wrappedRows } from "../hooks/rank";

// Rows the drawn tree takes, laid out as the terminal does: a column stacks
// its children, a wrapping row of Buttons wraps by their labels, a border
// adds two rows. Every Text and Button here stays on one row.
export type Node = string | { type: string; props?: any; children?: Node[] };
export const heightOf = (node: Node, columns: number): number => {
  if (typeof node === "string") return node ? 1 : 0;
  const props = node.props ?? {};
  const kids = node.children ?? [];
  if (node.type !== "Box") return 1;
  const frame = (props.borderStyle ? 2 : 0) + (props.marginTop ?? 0);
  if (props.flexDirection === "column") {
    const shown = kids.filter((kid) => kid !== "");
    return (
      frame +
      shown.reduce((sum: number, kid) => sum + heightOf(kid, columns), 0) +
      (props.gap ?? 0) * Math.max(0, shown.length - 1)
    );
  }
  if (props.flexWrap === "wrap") {
    const labels = kids
      .filter((kid): kid is Exclude<Node, string> => typeof kid !== "string")
      .map((kid) =>
        kid.props.hotkey
          ? `${kid.props.hotkey}: ${kid.props.label}`
          : kid.props.label,
      );
    return frame + wrappedRows(labels, columns, props.columnGap ?? 0);
  }
  return frame + Math.max(0, ...kids.map((kid) => heightOf(kid, columns)));
};
