# Talk To Bro Personally — Impeccable Init

## Scope

Capture durable product context for this sub-product only in
`products/talk-to-bro-personally/PRODUCT.md` inside the user-designated
`.worktrees/talk-to-bro-personally-dev` development worktree. Do not create a monorepo-wide
product record or change UI, implementation code, PRD, technical design, or
`DESIGN.md`.

## Sources and Current State

- Product README.
- PRD v1.1: `docs/prd/2026-10-28-talk-to-bro-personally-prd.md`.
- Technical design v1.0:
  `docs/tech-spec/2026-10-28-talk-to-bro-personally-tech-design-and-plan.md`.
- The main checkout contains documentation only; the user corrected the active
  development location to `.worktrees/talk-to-bro-personally-dev`.
- The development worktree contains a Chrome MV3 extension, vanilla TypeScript
  popup/options UI, an esbuild build, and Node tests. Source presence does not
  establish release readiness or successful live acceptance.
- The existing draft bug plan records unresolved popup zoom and Answer-return
  concerns; do not fix them or describe them as verified during init.
- Existing shared graph and unrelated working-tree changes must be preserved.

## Steps

1. Confirm the documented audience, purpose, platform, constraints, and any
   corrections with the user.
2. After explicit approval, create the product-local `PRODUCT.md` using the
   Impeccable product schema. Distinguish confirmed requirements from implemented
   capabilities and record material open decisions.
3. Preserve existing terminology and explicitly documented identity commitments
   without inventing a visual system or requesting new aesthetic decisions.
4. Do not configure live injection into the extension: its MV3 CSP permits only
   packaged scripts. Preserve CSP and implementation code; any separate browser
   preview or live-mode integration requires its own scope and consent.

## Verification

- Read back `PRODUCT.md` and verify the schema marker, `web` platform, confirmed
  facts, source references, and sub-product scope.
- Inspect the task diff for accidental implementation or unrelated changes.
- Consult the shared graph maintenance policy; product-root `PRODUCT.md` is
  outside its current document allowlist. Do not expand that allowlist or replace
  shared graph outputs as an incidental init change. Report any index maintenance
  left pending for this plan. The worktree graph does not surface this product,
  and CodeGraph resolves to a different worktree; use current files as authority.
- Documentation-only work requires no build or UI tests.

## Approval

The user approved the documentation-only init plan, supplied the correct
development worktree, and confirmed that the PRD v1.1 product definition remains
unchanged. Only the development location and the existence of implementation
needed correction. No implementation work is authorized by this plan.
