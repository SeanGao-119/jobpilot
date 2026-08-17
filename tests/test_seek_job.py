from services.ingestion.seek_job import parse_seek_job_page


HTML = """
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Senior Data Engineer",
  "hiringOrganization": {"@type": "Organization", "name": "Example Data Co"},
  "jobLocation": {
    "@type": "Place",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Auckland CBD",
      "addressRegion": "Auckland",
      "addressCountry": "NZ"
    }
  },
  "employmentType": ["FULL_TIME", "CONTRACTOR"],
  "baseSalary": {
    "@type": "MonetaryAmount",
    "currency": "NZD",
    "value": {"@type": "QuantitativeValue", "minValue": 130000, "maxValue": 150000, "unitText": "YEAR"}
  },
  "description": "<p>Build <strong>data pipelines</strong> using Python and SQL.</p>",
  "datePosted": "2026-08-16",
  "validThrough": "2026-09-16"
}
</script>
</head></html>
"""


def test_parse_seek_job_page_from_json_ld() -> None:
    job = parse_seek_job_page(HTML, source_url="https://www.seek.co.nz/job/12345678")

    assert job.seek_job_id == "12345678"
    assert job.title == "Senior Data Engineer"
    assert job.company == "Example Data Co"
    assert job.location == "Auckland CBD, Auckland, NZ"
    assert job.employment_type == "FULL_TIME, CONTRACTOR"
    assert job.salary_text == "NZD 130000-150000 YEAR"
    assert "data pipelines" in job.description
    assert "Python" in job.description
