"""Single-table storage. DynamoDB in AWS; a JSON file when BOOND_LOCAL_DB is set (local dev)."""
from __future__ import annotations

import json
import os
import threading
from decimal import Decimal
from pathlib import Path
from typing import Any, Protocol


class Store(Protocol):
    def get(self, pk: str, sk: str) -> dict[str, Any] | None: ...
    def put(self, item: dict[str, Any]) -> None: ...
    def query(self, pk: str, sk_prefix: str = "") -> list[dict[str, Any]]: ...
    def query_gsi1(self, gsi1pk: str, sk_prefix: str = "") -> list[dict[str, Any]]: ...
    def scan_plans(self) -> list[dict[str, Any]]: ...


def to_dynamo(value: Any) -> Any:
    """DynamoDB rejects floats; convert recursively to Decimal."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: to_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_dynamo(v) for v in value]
    return value


def from_dynamo(value: Any) -> Any:
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: from_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [from_dynamo(v) for v in value]
    return value


class DynamoStore:
    def __init__(self, table_name: str, endpoint_url: str | None = None):
        import boto3

        self._table = boto3.resource("dynamodb", endpoint_url=endpoint_url).Table(table_name)

    def get(self, pk: str, sk: str) -> dict[str, Any] | None:
        item = self._table.get_item(Key={"PK": pk, "SK": sk}).get("Item")
        return from_dynamo(item) if item else None

    def put(self, item: dict[str, Any]) -> None:
        self._table.put_item(Item=to_dynamo(item))

    def _query_all(self, **kwargs: Any) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        while True:
            page = self._table.query(**kwargs)
            items.extend(from_dynamo(i) for i in page.get("Items", []))
            if "LastEvaluatedKey" not in page:
                return items
            kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    def query(self, pk: str, sk_prefix: str = "") -> list[dict[str, Any]]:
        from boto3.dynamodb.conditions import Key

        cond = Key("PK").eq(pk)
        if sk_prefix:
            cond = cond & Key("SK").begins_with(sk_prefix)
        return self._query_all(KeyConditionExpression=cond)

    def query_gsi1(self, gsi1pk: str, sk_prefix: str = "") -> list[dict[str, Any]]:
        from boto3.dynamodb.conditions import Key

        cond = Key("GSI1PK").eq(gsi1pk)
        if sk_prefix:
            cond = cond & Key("GSI1SK").begins_with(sk_prefix)
        return self._query_all(IndexName="GSI1", KeyConditionExpression=cond)

    def scan_plans(self) -> list[dict[str, Any]]:
        from boto3.dynamodb.conditions import Attr

        kwargs: dict[str, Any] = {"FilterExpression": Attr("SK").eq("META") & Attr("PK").begins_with("PLAN#")}
        items: list[dict[str, Any]] = []
        while True:
            page = self._table.scan(**kwargs)
            items.extend(from_dynamo(i) for i in page.get("Items", []))
            if "LastEvaluatedKey" not in page:
                return items
            kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


class LocalStore:
    """File-backed store for running without AWS. Not for production."""

    _lock = threading.Lock()

    def __init__(self, path: str):
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def _read(self) -> dict[str, dict[str, Any]]:
        if not self._path.exists():
            return {}
        return json.loads(self._path.read_text(encoding="utf-8") or "{}")

    def get(self, pk: str, sk: str) -> dict[str, Any] | None:
        with self._lock:
            return self._read().get(f"{pk}|{sk}")

    def put(self, item: dict[str, Any]) -> None:
        with self._lock:
            data = self._read()
            data[f"{item['PK']}|{item['SK']}"] = from_dynamo(item)
            self._path.write_text(json.dumps(data, indent=1), encoding="utf-8")

    def query(self, pk: str, sk_prefix: str = "") -> list[dict[str, Any]]:
        with self._lock:
            items = [i for i in self._read().values() if i["PK"] == pk and i["SK"].startswith(sk_prefix)]
        return sorted(items, key=lambda i: i["SK"])

    def query_gsi1(self, gsi1pk: str, sk_prefix: str = "") -> list[dict[str, Any]]:
        with self._lock:
            items = [
                i for i in self._read().values()
                if i.get("GSI1PK") == gsi1pk and str(i.get("GSI1SK", "")).startswith(sk_prefix)
            ]
        return sorted(items, key=lambda i: i["GSI1SK"])

    def scan_plans(self) -> list[dict[str, Any]]:
        with self._lock:
            return [i for i in self._read().values() if i["SK"] == "META" and i["PK"].startswith("PLAN#")]


_store: Store | None = None


def get_store() -> Store:
    global _store
    if _store is None:
        local_path = os.environ.get("BOOND_LOCAL_DB")
        if local_path:
            _store = LocalStore(local_path)
        else:
            _store = DynamoStore(os.environ["TABLE_NAME"], os.environ.get("DYNAMODB_ENDPOINT") or None)
    return _store


def set_store(store: Store | None) -> None:
    """For tests."""
    global _store
    _store = store
