from services.ingestion.gmail_seek import gmail_seek_query


def test_default_seek_query_includes_seek_and_excludes_seek_pass(monkeypatch) -> None:
    monkeypatch.delenv("GMAIL_SEEK_QUERY", raising=False)

    query = gmail_seek_query()

    assert "from:seek.co.nz" in query
    assert "-from:seekpass.co" in query
    assert "newer_than:14d" in query


def test_seek_query_can_be_overridden(monkeypatch) -> None:
    monkeypatch.setenv("GMAIL_SEEK_QUERY", "from:noreply@s.seek.co.nz newer_than:30d")

    assert gmail_seek_query() == "from:noreply@s.seek.co.nz newer_than:30d"
