# PropDesk schema migrations

Plain numbered SQL (no Alembic until a Python/FastAPI service owns the schema).

## Apply

**Local / test rebuild** (preferred):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql -f schema_tests.sql
```

`schema.sql` at the repo root is the full rebuild script and the source of truth.

**Incremental path** (existing DB tracking versions):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_ravi_nov12_correction.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/002_final_schema_closeout.sql
```

Future changes land as `003_*.sql`, … Never edit an applied migration; add a new file.

## Version map

| File | Notes |
|---|---|
| `001_ravi_nov12_correction.sql` | Nov 12 correction baseline marker |
| `002_final_schema_closeout.sql` | Final closeout marker (breach, AI, §6, partitions, roles) |
