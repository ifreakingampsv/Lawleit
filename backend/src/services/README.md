# Service layer

Business logic lives here, one module per contract resource. Every query is
scoped to the session user's Firm (ADR-0003) and each module carries a
cross-firm assertion in its tests. Route handlers stay thin and delegate to
these modules.
