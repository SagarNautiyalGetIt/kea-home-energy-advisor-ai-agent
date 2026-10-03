"""Load team-owned SSM configuration before importing the API, without logging secrets."""

from __future__ import annotations

import os
import re
import sys


def load_parameters(client=None) -> None:
    prefix = os.environ.get("KEA_SSM_PREFIX", "")
    if not prefix.startswith("/") or prefix == "/":
        raise RuntimeError("KEA_SSM_PREFIX must identify this deployment only.")
    if client is None:
        import boto3

        client = boto3.client("ssm", region_name=os.environ.get("AWS_REGION", "ap-southeast-2"))
    for page in client.get_paginator("get_parameters_by_path").paginate(
        Path=prefix, Recursive=False, WithDecryption=True
    ):
        for parameter in page["Parameters"]:
            name = parameter["Name"].rsplit("/", 1)[-1]
            if not re.fullmatch(r"(KEA_|GEMINI_)[A-Z0-9_]+", name):
                raise RuntimeError("Unexpected deployment parameter name.")
            os.environ.setdefault(name, parameter["Value"])


def main() -> None:
    load_parameters()
    # An incomplete team configuration cannot start a publicly reachable demo API.
    if os.environ.get("KEA_PRODUCTION") != "1":
        raise RuntimeError("Team runtime requires KEA_PRODUCTION=1.")
    arguments = sys.argv[1:] or ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
    os.execvp(arguments[0], arguments)


if __name__ == "__main__":
    main()
