import { Component, type ReactNode } from "react";

/**
 * Renders the message as plain text if Markdown rendering throws.
 *
 * Assistant replies are model output run through a parser and a custom remark plugin, so a
 * malformed construct or a plugin bug is a live possibility — and without a boundary it unmounts
 * the entire conversation view, which is what happened when the citation plugin was registered
 * pre-invoked. Losing the formatting of one message is a bad day; losing the case discussion is a
 * different category of problem.
 */
export class MarkdownBoundary extends Component<
  { content: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Structured so it is greppable next to the backend's logs.
    console.error(
      JSON.stringify({
        level: "error",
        action: "lexMarkdownRenderFailed",
        error: error instanceof Error ? error.message : String(error)
      })
    );
  }

  render() {
    if (this.state.failed) {
      return <div className="whitespace-pre-wrap">{this.props.content}</div>;
    }
    return this.props.children;
  }
}
