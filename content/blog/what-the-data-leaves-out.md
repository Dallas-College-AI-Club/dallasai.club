{
  "slug": "what-the-data-leaves-out",
  "legacyIndex": 2,
  "author": "Editorial sample",
  "isSample": true,
  "category": "Method note",
  "title": "What our dataset leaves out.",
  "abstract": "An overall score can hide very different experiences. A simple comparison makes the gap visible.",
  "section": "Data & society",
  "takeaway": {
    "text": "Change the test mix yourself. See what changes and what stays the same.",
    "mode": "ethics",
    "label": "Open the experiment"
  },
  "references": [
    [
      "Timnit Gebru and coauthors",
      "Datasheets for Datasets",
      "https://arxiv.org/abs/1803.09010"
    ]
  ],
  "weight": 3,
  "draft": false,
  "publishDate": "2026-09-10T00:00:00Z",
  "aliases": [
    "/review/what-the-data-leaves-out/"
  ]
}

## Ask how the examples arrived {#section-0}

A dataset is a record of what someone managed to collect. It is not a complete account of the world. Start by listing where the examples came from, how they were selected, and what situations they do not include.

Consider the fictional information assistant in “Check its answers.” It responds correctly to 95% of familiar phrases and 55% of unfamiliar wording. Those are deliberately constructed rates for a teaching exercise, not results from a deployed college system.

## Look behind the average {#section-1}

If familiar wording makes up 80% of the test, the weighted overall score is 87%. With an even split, it becomes 75%. The assistant has not changed. The composition of the test has changed what the single number tells us.

Neither average removes the 40 percentage-point difference between the groups. Report the separate results and inspect examples of failure. A bigger dataset will not automatically solve a gap if it contains more of the same situations.

## Document the missing context {#section-2}

The “Datasheets for Datasets” proposal recommends documenting a dataset’s motivation, composition, collection, and intended uses. Those questions make a practical starting point for a small student project as well.

Keep the documentation with the work. Describe what the examples can support, what they cannot, and who should help review the missing context. That record gives future contributors a clearer starting point than a score alone.
