# Two versions of one codebase: Demo Version and Production Version

Lawleit must serve a public portfolio demo (zero signup, zero payment info, every
feature explorable) and a real production product for law firms. We decided both are
modes of the same codebase, selected by environment (`VITE_API_MODE=mock|http`),
rather than two forks: the demo runs on the mock adapter (browser-local data, a
"Reset demo data" action), production on the real REST backend. The data-layer seam
(`app/src/lib/data/`) is the switch.

## Considered Options

- Two separate frontends/forks — rejected: every feature would be built twice.
- Demo behind a shared server database — rejected: visitors would see each other's
  edits and the demo would need moderation.

## Consequences

- Anything gated for production must be gated on http mode, never on the demo mode.
- The demo must never gain signup or payment friction; that is its defining property.
