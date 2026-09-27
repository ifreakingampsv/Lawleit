// Tables land with ticket 07 (auth: firms, users, sessions) and later modules.
// Every tenant table must follow the baseline conventions recorded in
// drizzle/README.md: firm_id, bigint-paise money, created_at/updated_at,
// nullable deleted_at, gen_random_uuid() primary keys.

export {};
