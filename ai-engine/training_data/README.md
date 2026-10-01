# Local training data

AI-02A writes tenant-scoped JSONL datasets, manifests, and quality reports in
this directory by default. Generated files are deliberately ignored by Git and
excluded from the inference container build because they may contain sensitive
security telemetry.

Do not commit, email, or upload a real training dataset without completing the
organization's data-handling review.
