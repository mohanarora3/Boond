"""File storage: S3 with presigned URLs in AWS; a local folder served by local_server.py in dev."""
from __future__ import annotations

import os
from pathlib import Path

URL_EXPIRY_S = 900


def _local_dir() -> Path | None:
    db = os.environ.get("BOOND_LOCAL_DB")
    return Path(db).parent / "files" if db else None


def local_path(key: str) -> Path | None:
    """Where a key lives in local dev: public-data/ under backend/.local/, everything else under .local/files/."""
    db = os.environ.get("BOOND_LOCAL_DB")
    if not db:
        return None
    return Path(db).parent / key if key.startswith("public-data/") else Path(db).parent / "files" / key


def _local_url(key: str) -> str:
    return f"{os.environ.get('BOOND_LOCAL_URL', 'http://localhost:3001')}/_files/{key}"


def _client():  # type: ignore[no-untyped-def]
    import boto3
    from botocore.config import Config

    return boto3.client("s3", config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))


def _bucket() -> str:
    return os.environ["BUCKET_NAME"]


def presign_put(key: str, content_type: str) -> str:
    if _local_dir():
        return _local_url(key)
    return _client().generate_presigned_url(
        "put_object", Params={"Bucket": _bucket(), "Key": key, "ContentType": content_type}, ExpiresIn=URL_EXPIRY_S
    )


def presign_get(key: str, download_name: str | None = None) -> str:
    if _local_dir():
        return _local_url(key)
    params = {"Bucket": _bucket(), "Key": key}
    if download_name:
        params["ResponseContentDisposition"] = f'attachment; filename="{download_name}"'
    return _client().generate_presigned_url("get_object", Params=params, ExpiresIn=URL_EXPIRY_S)


def put_bytes(key: str, data: bytes, content_type: str) -> None:
    path = local_path(key)
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return
    _client().put_object(Bucket=_bucket(), Key=key, Body=data, ContentType=content_type)


def exists(key: str) -> bool:
    path = local_path(key)
    if path:
        return path.is_file()
    client = _client()
    try:
        client.head_object(Bucket=_bucket(), Key=key)
        return True
    except client.exceptions.ClientError:
        return False


def get_bytes(key: str, max_bytes: int) -> bytes | None:
    """Returns None if the object does not exist. Raises ValueError if it is larger than max_bytes."""
    path = local_path(key)
    if path:
        if not path.is_file():
            return None
        if path.stat().st_size > max_bytes:
            raise ValueError("too large")
        return path.read_bytes()
    client = _client()
    try:
        head = client.head_object(Bucket=_bucket(), Key=key)
    except client.exceptions.ClientError:
        return None
    if head["ContentLength"] > max_bytes:
        raise ValueError("too large")
    return client.get_object(Bucket=_bucket(), Key=key)["Body"].read()
