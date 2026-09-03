from services.ingestion.job_page import parse_public_job_page, public_job_identity

HTML = """
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Data Engineer",
  "description": "<p>Build Python and SQL data pipelines.</p>",
  "datePosted": "2026-09-01",
  "validThrough": "2026-10-01",
  "employmentType": "FULL_TIME",
  "hiringOrganization": {"@type": "Organization", "name": "Acme Data"},
  "jobLocation": {"address": {"addressLocality": "Christchurch", "addressCountry": "NZ"}}
}
</script>
</head></html>
"""


def test_parses_linkedin_jobposting_and_canonical_identity() -> None:
    url = "https://nz.linkedin.com/jobs/view/data-engineer-4123456789?trk=email"
    identity = public_job_identity(url)
    job = parse_public_job_page(HTML, source_url=identity.canonical_url)

    assert identity.platform == "linkedin"
    assert identity.external_id == "4123456789"
    assert identity.canonical_url == "https://www.linkedin.com/jobs/view/4123456789"
    assert job.title == "Data Engineer"
    assert job.company == "Acme Data"
    assert job.location == "Christchurch, NZ"
    assert job.description == "Build Python and SQL data pipelines."


def test_recognises_zeil_and_trademe_ids() -> None:
    assert public_job_identity("https://www.zeil.com/jobs/data-engineer-abc").platform == "zeil"
    trade_me = public_job_identity("https://www.trademe.co.nz/a/jobs/it/listing/5123456789")
    assert trade_me.platform == "trademe"
    assert trade_me.external_id == "5123456789"
