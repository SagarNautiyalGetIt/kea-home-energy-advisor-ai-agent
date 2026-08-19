# Data model (ERD)

PostgreSQL from Sprint 2 ([ADR-0006](adr/0006-postgres-in-sprint-2.md)).
Source of truth is `app/db/models.py`; this diagram is generated from it by hand
and must be updated in the same PR as any schema change.

Build it with `alembic upgrade head`.

---

## Diagram

```mermaid
erDiagram
    CUSTOMER ||--o{ METER : "has"
    CUSTOMER ||--o{ CUSTOMER_TARIFF : "on"
    CUSTOMER ||--o{ CONVERSATION : "starts"
    CUSTOMER }o--|| BENCHMARK : "compared to"
    METER    ||--o{ READING : "records"
    TARIFF   ||--o{ CUSTOMER_TARIFF : "priced by"

    CONVERSATION ||--o{ TURN : "contains"
    CONVERSATION ||--o{ ESCALATION : "may raise"
    TURN ||--o| FACT_BUNDLE  : "computed"
    TURN ||--o| VERIFICATION : "checked by"
    TURN ||--o| TOKEN_USAGE  : "cost of"
    TURN ||--o{ ESCALATION   : "triggers"

    CUSTOMER {
        int      id PK
        string   external_ref UK
        string   region
        int      benchmark_id FK
        string   label "demo households only"
        datetime created_at
    }
    METER {
        int    id PK
        int    customer_id FK
        string icp UK
    }
    READING {
        int      id PK
        int      meter_id FK
        datetime interval_start "half-hourly"
        decimal  kwh "Numeric(10,3)"
    }
    TARIFF {
        int     id PK
        string  name
        string  plan_type
        decimal unit_price_nzd  "Numeric(12,4)"
        decimal daily_fixed_nzd "Numeric(12,4)"
        bool    is_illustrative
    }
    CUSTOMER_TARIFF {
        int  id PK
        int  customer_id FK
        int  tariff_id FK
        date valid_from
        date valid_to
    }
    BENCHMARK {
        int     id PK
        string  region
        string  segment
        decimal kwh_per_day
        text    source "must cite"
    }
    WEATHER_DAY {
        int     id PK
        string  region
        date    day
        decimal mean_temp_c
    }
    CONVERSATION {
        int      id PK
        int      customer_id FK
        string   channel "chat | voice"
        datetime started_at
        datetime ended_at
    }
    TURN {
        int      id PK
        int      conversation_id FK
        int      seq
        string   role "customer | agent"
        text     body
        string   intent
        datetime created_at
    }
    FACT_BUNDLE {
        int    id PK
        int    turn_id FK,UK
        string intent
        string period
        jsonb  facts
    }
    VERIFICATION {
        int   id PK
        int   turn_id FK,UK
        bool  passed
        jsonb checked
        jsonb unverified
        bool  regenerated
        bool  fell_back_to_template
    }
    TOKEN_USAGE {
        int    id PK
        int    turn_id FK,UK
        string provider "ollama | bedrock"
        string model
        int    prompt_tokens
        int    completion_tokens
    }
    ESCALATION {
        int      id PK
        int      conversation_id FK
        int      turn_id FK
        string   reason
        datetime created_at
    }
```

---

## Why the tables are shaped this way

**Three groups.** Reference data (`benchmark`, `tariff`, `weather_day`), customer
data (`customer`, `meter`, `reading`, `customer_tariff`), and the evidence trail
(`conversation`, `turn`, `fact_bundle`, `verification`, `token_usage`, `escalation`).

| Choice | Reason |
|---|---|
| `Numeric`, never `float`, for kWh and money | binary floats cannot represent `0.1`. A pitch about not fabricating numbers cannot round badly |
| `reading` is half-hourly, indexed on `(meter_id, interval_start)` | 5 households × 31 days × 48 = ~7,440 rows for the demo alone; this is time-series access |
| `fact_bundle.facts` is `JSONB` | facts differ per intent; a rigid column set would need a migration per new analytic |
| `verification` is its own table, 1:1 with `turn` | it is the evidence for *"0 fabricated figures"*. Evidence you compute later is not evidence |
| `token_usage` is its own table, 1:1 with `turn` | the Bedrock cost projection multiplies these by published rates. Cannot be reconstructed retroactively |
| `benchmark.source` is `NOT NULL` text | every external figure carries a source link. Enforced in the schema, not by memory |
| `tariff.is_illustrative` defaults `true` | prevents an illustrative price being quoted as if it were a real Kea Energy rate |
| `customer.external_ref`, not a name | no PII in the model. See [`SECURITY.md`](../SECURITY.md) |

## Changing the schema

1. Edit `app/db/models.py`.
2. `alembic revision --autogenerate -m "..."` — then **read the generated migration**. Autogenerate misses renames and constraint changes.
3. Update this diagram in the same PR.
4. `alembic upgrade head` on an empty database must still build the whole schema.
5. Migrations touching `alembic/` or `app/db/` require maintainer review (CODEOWNERS).

---

## Related

- [`prd.md`](prd.md) · [`api-standards.md`](api-standards.md) · [ADR-0006](adr/0006-postgres-in-sprint-2.md)
