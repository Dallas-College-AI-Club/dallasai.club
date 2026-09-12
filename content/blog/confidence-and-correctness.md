{
  "slug": "confidence-and-correctness",
  "legacyIndex": 0,
  "author": "Editorial sample",
  "isSample": true,
  "category": "Essay",
  "title": "When a confident answer isn’t a good answer.",
  "abstract": "A small neural network offers a useful lesson in a much bigger question: what should it take to trust an AI system?",
  "section": "Learning & AI",
  "takeaway": {
    "text": "Try one hidden unit, then eight. Compare the boundary and the mistakes.",
    "mode": "lab",
    "label": "Open the experiment"
  },
  "references": [
    [
      "Google Machine Learning Crash Course",
      "Training, validation, and test sets",
      "https://developers.google.com/machine-learning/crash-course/overfitting/dividing-datasets"
    ],
    [
      "TensorFlow",
      "A Neural Network Playground",
      "https://playground.tensorflow.org/"
    ]
  ],
  "weight": 1,
  "draft": false,
  "publishDate": "2026-09-10T00:00:00Z",
  "aliases": [
    "/review/confidence-and-correctness/"
  ]
}

## Start with a question you can test {#section-0}

In the AI Lab, a model receives two numbers: the horizontal and vertical position of a point. Its task is to decide which of two groups that point belongs to. The question is small enough that we can see the examples and inspect the result ourselves.

That makes this a useful place to practice evaluating an AI system. Before training, decide what success would look like. Keep some examples out of the training process. Then compare the model’s predictions with the answers you already know.

## A boundary is a prediction {#section-1}

Switch between a ring and opposite corners. Train with one hidden unit, then repeat with eight. The colored boundary changes because the model has different ways to represent the pattern. More capacity can help, but the number of units is not a measure of trustworthiness.

The model produces a probability for each point. That number describes its prediction; it does not independently establish that the answer is correct. Inspect the points on the wrong side of the boundary. What do those mistakes have in common?

## Keep asking what would change your mind {#section-2}

The lab separates training examples from held-out examples. This is a teaching demonstration, not a full evaluation protocol. Repeatedly changing a model after looking at the same held-out results can still bias our choices toward that particular set. A real project also needs a validation strategy and fresh evaluation data.

The useful habit is to record what you changed, what happened, and what remains uncertain. Bring those notes into the next discussion. A result becomes more interesting when someone else can examine the reasoning behind it.
