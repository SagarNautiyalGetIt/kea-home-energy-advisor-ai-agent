"""Portable SQL inventory for comparing a paused source with a restored database."""

from __future__ import annotations

import json
from collections.abc import Callable


def identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def inventory(query: Callable[[str], str]) -> dict:
    relations = json.loads(
        query("""
        SELECT COALESCE(json_agg(json_build_object(
            'schema', n.nspname, 'name', c.relname, 'kind', c.relkind)
            ORDER BY n.nspname,c.relname),'[]'::json)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('r','p','m','S')
          AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
    """)
    )
    statements = []
    for relation in relations:
        schema, name, kind = (relation[k] for k in ("schema", "name", "kind"))
        qualified = f"{identifier(schema)}.{identifier(name)}"
        value = (
            "json_build_object('last_value',last_value,'is_called',is_called)"
            if kind == "S"
            else "to_json(count(*))"
        )
        statements.append(
            f"SELECT {literal(schema)} AS schema, {literal(name)} AS name, "
            f"{literal(kind)} AS kind, {value} AS value FROM {qualified}"
        )
    values = (
        json.loads(
            query(
                "SELECT json_agg(row_to_json(v)) FROM ("
                + " UNION ALL ".join(statements)
                + ") v"
            )
        )
        if statements
        else []
    )
    extensions = json.loads(
        query("SELECT json_agg(extname ORDER BY extname) FROM pg_extension")
    )
    return {"relations": values, "extensions": extensions}
