"""Canonical serialization + hash for .dpbundle payloads (Phase 5).

This module owns the wire-level rules that make the bundle hash deterministic
and reproducible byte-for-byte across Python (engine) and TypeScript (CLI).

Canonical form:
  - JSON keys sorted alphabetically at every level (sort_keys=True).
  - Compact separators (no spaces).
  - UTF-8 encoding, ensure_ascii=False (preserves accented characters as UTF-8
    bytes rather than \\u escapes — keeps payload smaller and human-readable).
  - Floats serialized with Python's repr-style minimal form (consistent with
    JavaScript's JSON.stringify for the values we emit: ratios, counts).

The TypeScript twin lives at packages/cli/src/bundle/canonical.ts. Both must
agree on every byte — test_bundle_contract enforces this via a fixed expected
hash computed from a known fixture.
"""
from __future__ import annotations

import dataclasses
import hashlib
import json

from models import BundlePayload


def _normalize_numbers(value: object) -> object:
    """Drop `.0` from whole floats so Python and JavaScript agree.

    `json.dumps(1.0)` → `"1.0"`, but `JSON.stringify(1.0)` → `"1"`. Coercing
    whole floats to ints before serializing keeps both languages byte-identical
    without changing semantics (the receiver always reinterprets the field's
    type from the schema).
    """
    if isinstance(value, bool):
        return value  # bool is a subclass of int — preserve as-is
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {k: _normalize_numbers(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_numbers(v) for v in value]
    return value


def canonical_json(value: object) -> str:
    """Stable JSON string: sorted keys, compact separators, UTF-8.

    Whole floats are normalized to ints to align with JavaScript serialization.
    """
    return json.dumps(
        _normalize_numbers(value),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )


def payload_to_canonical(payload: BundlePayload) -> str:
    return canonical_json(dataclasses.asdict(payload))


def payload_hash(payload: BundlePayload) -> str:
    """SHA-256 of the canonical-JSON-encoded payload, prefixed 'sha256:'."""
    raw = payload_to_canonical(payload).encode("utf-8")
    return "sha256:" + hashlib.sha256(raw).hexdigest()
