from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from email.header import decode_header, make_header
from pathlib import Path
from typing import Any

import html2text
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


@dataclass(frozen=True, slots=True)
class GmailSeekMessage:
    message_id: str
    subject: str
    body: str


def _default_config_dir() -> Path:
    return Path.home() / ".jobpilot"


def gmail_credentials_path() -> Path:
    return Path(
        os.environ.get(
            "GMAIL_CREDENTIALS_FILE",
            str(_default_config_dir() / "gmail-credentials.json"),
        )
    ).expanduser()


def gmail_token_path() -> Path:
    return Path(
        os.environ.get(
            "GMAIL_TOKEN_FILE",
            str(_default_config_dir() / "gmail-token.json"),
        )
    ).expanduser()


def gmail_seek_query() -> str:
    """Return the default SEEK mailbox query.

    Keep the query broad enough to include both recommendation emails and user-created
    SEEK saved-search/job-alert emails, while excluding SEEK Pass verification traffic.
    """
    return os.environ.get(
        "GMAIL_SEEK_QUERY",
        "from:seek.co.nz -from:seekpass.co newer_than:14d",
    ).strip()


def _credentials() -> Credentials:
    token_path = gmail_token_path()
    credentials_path = gmail_credentials_path()
    creds: Credentials | None = None

    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    elif not creds or not creds.valid:
        if not credentials_path.exists():
            raise RuntimeError(
                "Gmail OAuth credentials not found. Download an OAuth Desktop App credentials JSON "
                f"and save it to {credentials_path}, or set GMAIL_CREDENTIALS_FILE."
            )
        flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path), SCOPES)
        creds = flow.run_local_server(port=0)

    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text(creds.to_json(), encoding="utf-8")
    return creds


def _decode(data: str | None) -> str:
    if not data:
        return ""
    padded = data + "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8", errors="replace")


def _walk_parts(payload: dict[str, Any]) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    mime = payload.get("mimeType", "")
    data = (payload.get("body") or {}).get("data")
    if data and mime in {"text/plain", "text/html"}:
        found.append((mime, _decode(data)))
    for part in payload.get("parts") or []:
        found.extend(_walk_parts(part))
    return found


def _html_to_markdown(value: str) -> str:
    converter = html2text.HTML2Text()
    converter.ignore_images = True
    converter.ignore_emphasis = True
    converter.body_width = 0
    converter.protect_links = False
    return converter.handle(value)


def _subject(payload: dict[str, Any]) -> str:
    headers = payload.get("headers") or []
    raw = next((item.get("value", "") for item in headers if item.get("name", "").lower() == "subject"), "")
    try:
        return str(make_header(decode_header(raw)))
    except Exception:
        return raw


def _message_from_api(message: dict[str, Any]) -> GmailSeekMessage:
    payload = message.get("payload") or {}
    parts = _walk_parts(payload)
    html = next((body for mime, body in parts if mime == "text/html"), "")
    plain = next((body for mime, body in parts if mime == "text/plain"), "")
    body = _html_to_markdown(html) if html else plain
    return GmailSeekMessage(
        message_id=str(message["id"]),
        subject=_subject(payload),
        body=body,
    )


def fetch_seek_messages(*, query: str | None = None, limit: int = 25) -> tuple[GmailSeekMessage, ...]:
    if limit <= 0:
        return ()
    service = build("gmail", "v1", credentials=_credentials(), cache_discovery=False)
    response = service.users().messages().list(
        userId="me",
        q=query or gmail_seek_query(),
        maxResults=min(limit, 100),
    ).execute()
    refs = response.get("messages") or []
    messages: list[GmailSeekMessage] = []
    for ref in refs:
        raw = service.users().messages().get(userId="me", id=ref["id"], format="full").execute()
        messages.append(_message_from_api(raw))
    return tuple(messages)
