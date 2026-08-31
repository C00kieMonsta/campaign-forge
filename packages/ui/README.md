# @packages/ui

shadcn-style component kit. Consumed by `apps/frontend` only (`apps/landing` has its own local
components).

## Class vocabulary: write Tailwind v3, not v4

`package.json` declares `tailwindcss: ^4` as a devDependency and
`packages/ui/node_modules/tailwindcss` is v4. **Nothing compiles this package with it.**

There is no build step and no CSS output here. The components ship as source, and the only thing
that ever turns their class strings into CSS is `apps/frontend`, whose `tailwind.config.ts` scans
`../../packages/ui/src/**/*.{ts,tsx}` and which resolves the hoisted **v3.4** at the repo root
(`.npmrc` has `node-linker=hoisted`).

So a v4-only utility here does not fall back or warn. It emits nothing, and the component silently
renders without it. That is not hypothetical: `field-sizing-content` on `Textarea` was the reason
the Lex chat composer was permanently one line high, and `aria-invalid:*` meant the invalid-state
ring on every `Input`, `Textarea` and `Button` had never rendered in either app.

The v4 spellings found and translated, for reference when copying new components from the shadcn
docs (which are v4):

| v4               | v3 equivalent used here                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shadow-xs`      | `shadow-sm` (same value; v4 renamed the scale)                                                                                                                      |
| `rounded-xs`     | `rounded-[2px]` (v4's literal 0.125rem — `rounded-sm` is themed to 8px in this repo)                                                                                |
| `outline-hidden` | `outline-none`                                                                                                                                                      |
| `aria-invalid:x` | `aria-[invalid=true]:x` (the value matters: React renders `aria-invalid={false}` as `aria-invalid="false"`, so a presence selector would match the valid state too) |
| `p-(--var)`      | `p-[var(--var)]`                                                                                                                                                    |
| `p-0!`           | `!p-0`                                                                                                                                                              |
| `has-focus:x`    | `focus-within:x`                                                                                                                                                    |
| `has-disabled:x` | `has-[:disabled]:x`                                                                                                                                                 |
| `*:[svg]:x`      | `[&>svg]:x`                                                                                                                                                         |

`field-sizing-content` has **no v3 equivalent** and is left in `textarea.tsx` for whenever this
package is genuinely built with v4. Anything needing a growing textarea must size it itself.

Still untranslated, in components `apps/frontend` does not render (`card`, `select`, `sidebar`,
`command`, `navigation-menu`, `calendar`, `input-otp`, `context-menu`, `menubar`): `@container`,
the `**:` descendant variant, the `in-*` variant, `group-has-data-*`, and the accordion/caret
keyframes, which need config entries. Port them if you start rendering those.

### How to check

```
pnpm build:frontend
grep -c 'shadow-xs\|rounded-xs\|outline-hidden\|field-sizing' apps/frontend/dist/assets/index-*.css
```

Any non-zero count for a class you expect to work means it is not being emitted.
