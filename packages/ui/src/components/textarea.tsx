import * as React from "react";
import { cn } from "../lib";

/**
 * forwardRef because a caller may need the DOM node: the Lex composer reads `selectionStart` to
 * decide whether the caret sits inside an '@' mention, and calls `setSelectionRange` after
 * inserting one.
 *
 * NOTE: `field-sizing-content` below does NOT auto-grow this box. It is a Tailwind v4 utility and
 * the only thing that compiles this package is apps/frontend on v3.4, so the class is never
 * emitted. There is no v3 equivalent, so anything that needs a growing textarea has to size it
 * itself (see the composer in LexWorkspaceChat). Left in place for whenever this package is
 * actually built with the v4 it declares.
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<"textarea">
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-[invalid=true]:ring-destructive/20 dark:aria-[invalid=true]:ring-destructive/40 aria-[invalid=true]:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-sm transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
      ref={ref}
    />
  );
});

export { Textarea };
