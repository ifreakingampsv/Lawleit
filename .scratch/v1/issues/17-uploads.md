# 17: Real file uploads

**What to build:** Lawyers attach real files to cases: permission-checked upload requests return short-lived signed URLs, the browser uploads directly to object storage (Supabase Storage, same region as the database, S3-compatible API), the backend stores document metadata + storage key, and downloads go through signed read URLs. Type allowlist and size limits enforced. Per-case folder organization works.

**Blocked by:** 07 (Auth — register Firm, login, sessions).

**Status:** ready-for-agent — **requires owner**: the Supabase project from ticket 06 (storage bucket creation is part of the guided step).

- [ ] Upload flow end to end: request → permission check → signed URL → direct browser upload → metadata row → appears in Documents
- [ ] Download returns an expiring signed URL after a permission check
- [ ] Type allowlist + size limits enforced server-side; oversized/disallowed rejected before any signed URL
- [ ] Cross-firm isolation asserted (cannot sign for, read, or list another firm's documents)
- [ ] Storage provider behind a thin interface (S3-compatible) so it is swappable by config
