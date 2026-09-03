# Resume-cover letter consistency contract

Audit a cover-letter draft against a frozen final resume and its evidence IDs.

Flag any candidate claim that is not directly supported, any contradiction, and any sentence that copies the resume too closely. Do not reward persuasive wording over factual alignment.

Return one JSON object:

```json
{
  "alignment_score": 0,
  "unsupported_claims": [],
  "contradictions": [],
  "copied_phrases": []
}
```

