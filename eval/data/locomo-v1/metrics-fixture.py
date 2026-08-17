"""Reference values from the real upstream scorers, for the TypeScript port to match."""
"""Regenerate eval/data/locomo-v1/metrics.fixture.json.

    python3 eval/data/locomo-v1/metrics-fixture.py \
        --dataset .eval-data/locomo/<revision>/locomo10.json \
        > eval/data/locomo-v1/metrics.fixture.json

Needs `nltk` and `rouge-score`. The dataset argument is optional and only widens the
stem vocabulary to every word the scorers will actually stem; without it the fixture
still covers the hand-written cases below.
"""
import argparse, json, string, statistics
import regex
from collections import Counter
from nltk.stem import PorterStemmer
from nltk.tokenize import word_tokenize
from nltk.translate.bleu_score import sentence_bleu, SmoothingFunction
from rouge_score import rouge_scorer

ps = PorterStemmer()

# ---- snap-research/locomo task_eval/evaluation.py (verbatim) ----
def normalize_answer(s):
    s = s.replace(',', "")
    def remove_articles(text): return regex.sub(r'\b(a|an|the|and)\b', ' ', text)
    def white_space_fix(text): return ' '.join(text.split())
    def remove_punc(text):
        exclude = set(string.punctuation)
        return ''.join(ch for ch in text if ch not in exclude)
    def lower(text): return text.lower()
    return white_space_fix(remove_articles(remove_punc(lower(s))))

def f1_score(prediction, ground_truth):
    prediction_tokens = [ps.stem(w) for w in normalize_answer(prediction).split()]
    ground_truth_tokens = [ps.stem(w) for w in normalize_answer(ground_truth).split()]
    common = Counter(prediction_tokens) & Counter(ground_truth_tokens)
    num_same = sum(common.values())
    if num_same == 0: return 0
    precision = 1.0 * num_same / len(prediction_tokens)
    recall = 1.0 * num_same / len(ground_truth_tokens)
    return (2 * precision * recall) / (precision + recall)

def f1(prediction, ground_truth):
    predictions = [p.strip() for p in prediction.split(',')]
    ground_truths = [g.strip() for g in ground_truth.split(',')]
    return statistics.fmean([max([f1_score(p, gt) for p in predictions]) for gt in ground_truths])

def official(prediction, answer, category):
    answer = str(answer)
    if category == 3: answer = answer.split(';')[0].strip()
    if category in [2, 3, 4]: return f1_score(prediction, answer)
    if category == 1: return f1(prediction, answer)
    if category == 5:
        return 1 if ('no information available' in prediction.lower()
                     or 'not mentioned' in prediction.lower()) else 0
    raise ValueError

# ---- WujiangXu/A-mem utils.py (verbatim subset) ----
def simple_tokenize(text):
    text = str(text)
    return text.lower().replace('.', ' ').replace(',', ' ').replace('!', ' ').replace('?', ' ').split()

def amem_f1(prediction, reference):
    pred_tokens = set(simple_tokenize(prediction)); ref_tokens = set(simple_tokenize(reference))
    common = pred_tokens & ref_tokens
    if not pred_tokens or not ref_tokens: return 0.0
    precision = len(common) / len(pred_tokens); recall = len(common) / len(ref_tokens)
    return 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

def amem_bleu(prediction, reference):
    pred_tokens = word_tokenize(prediction.lower())
    ref_tokens = [word_tokenize(reference.lower())]
    weights_list = [(1,0,0,0),(0.5,0.5,0,0),(0.33,0.33,0.33,0),(0.25,0.25,0.25,0.25)]
    smooth = SmoothingFunction().method1
    out = {}
    for n, w in enumerate(weights_list, start=1):
        try: s = sentence_bleu(ref_tokens, pred_tokens, weights=w, smoothing_function=smooth)
        except Exception: s = 0.0
        out[f'bleu{n}'] = s
    return out

_rouge = rouge_scorer.RougeScorer(['rouge1','rouge2','rougeL'], use_stemmer=True)
def amem_rouge(prediction, reference):
    s = _rouge.score(reference, prediction)
    return {'rouge1_f': s['rouge1'].fmeasure, 'rouge2_f': s['rouge2'].fmeasure, 'rougeL_f': s['rougeL'].fmeasure}

CASES = [
    # (prediction, reference, category) — drawn from real LoCoMo answers and plausible agent replies
    ("mental health", "mental health", 4),
    ("Mental Health.", "mental health", 4),
    ("The charity race raised awareness for mental health.", "mental health", 4),
    ("adoption agencies", "Adoption agencies", 1),
    ("She researched adoption agencies and foster care", "Adoption agencies, foster care", 1),
    ("adoption agencies", "Adoption agencies, foster care", 1),
    ("Psychology", "Psychology, counseling certification", 3),
    ("psychology and counselling", "Psychology, counseling certification; social work", 3),
    ("7 May 2023", "7 May 2023", 2),
    ("8 May 2023", "7 May 2023", 2),
    ("around the 7th of May, 2023", "7 May 2023", 2),
    ("Not mentioned in the conversation", "self-care is important", 5),
    ("No information available", "self-care is important", 5),
    ("self-care is important", "self-care is important", 5),
    ("", "mental health", 4),
    ("skies dying happy ponies", "sky die happi poni", 4),
    ("the a an and cat", "cat", 4),
    ("$18.2M", "18.2 million", 4),
    ("He went running, hopping and falling", "running hopping falling", 1),
    ("she is a teacher", "teacher", 4),
]

parser = argparse.ArgumentParser()
parser.add_argument("--dataset", default=None)
ARGS = parser.parse_args()

def dataset_vocabulary(path):
    """Every token the official scorer would stem, over all 1,986 reference answers."""
    if not path: return []
    words = set()
    for sample in json.load(open(path)):
        for qa in sample["qa"]:
            for key in ("answer", "adversarial_answer"):
                if key in qa:
                    words.update(normalize_answer(str(qa[key])).split())
    return sorted(words)

STEM_WORDS = sorted({w for p, r, _ in CASES for w in normalize_answer(p).split() + normalize_answer(r).split()})
EXTRA_STEMS = ["skies","dying","lying","tying","news","innings","inning","outings","outing",
               "cannings","canning","howe","proceed","exceed","succeed","sky","ties","cries",
               "caresses","ponies","agreed","plastered","motoring","conflated","troubled","sized",
               "hopping","falling","hissing","fizzed","failing","filing","relational","conditional",
               "rational","valenci","hesitanci","digitizer","conformabli","radicalli","differentli",
               "vileli","analogousli","vietnamization","predication","operator","feudalism",
               "decisiveness","hopefulness","callousness","formaliti","sensitiviti","sensibiliti",
               "triplicate","formative","formalize","electriciti","electrical","hopeful","goodness",
               "revival","allowance","inference","airliner","gyroscopic","adjustable","defensible",
               "irritant","replacement","adjustment","dependent","adoption","homologou","communism",
               "activate","angulariti","homologous","effective","bowdlerize","probate","rate","cease",
               "controll","roll","enjoy","happy","agencies","certification","counseling","important"]

DATASET_WORDS = dataset_vocabulary(ARGS.dataset)

def dataset_cases(path):
    """Real reference answers put through four deterministic answer shapes.

    Identity, a verbose sentence wrapper, a truncation, and a mismatch — the four ways a
    knowledge-base agent's reply actually differs from a short gold phrase. Every fourth
    question is taken, so the selection is a property of the dataset rather than a sample.
    """
    if not path: return []
    out = []
    for sample in json.load(open(path)):
        for i, qa in enumerate(sample["qa"]):
            if i % 4: continue
            cat = qa["category"]
            ref = str(qa.get("adversarial_answer") if cat == 5 else qa.get("answer", ""))
            if not ref: continue
            words = ref.split()
            shape = (len(out) // 1) % 4
            if shape == 0: pred = ref
            elif shape == 1: pred = f"Based on the conversation, {ref[0].lower() + ref[1:]}."
            elif shape == 2: pred = " ".join(words[: max(1, len(words) // 2)])
            else: pred = "Not mentioned in the conversation"
            out.append((pred, ref, cat))
    return out[:400]

DATASET_CASES = dataset_cases(ARGS.dataset)

fixture = {
  "_source": {
    "official": "snap-research/locomo@3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376 task_eval/evaluation.py",
    "amem": "WujiangXu/A-mem@0c8039f28fdcc08189a23c07a3437d9d2482f9c2 utils.py",
    "generated_by": "eval/data/locomo-v1/metrics-fixture.py against nltk PorterStemmer and rouge-score",
  },
  "stem_vocabulary": ("hand-written cases only" if not DATASET_WORDS
                      else "every token in all 1,986 LoCoMo reference answers"),
  "stems": {w: ps.stem(w) for w in sorted(set(STEM_WORDS) | set(EXTRA_STEMS) | set(DATASET_WORDS))},
  "normalized": {p: normalize_answer(p) for p, _, _ in CASES},
  "cases": [
    {
      "prediction": p, "reference": r, "category": c,
      "official_f1": official(p, r, c),
      "amem": {"exact_match": int(p.strip().lower() == r.strip().lower()),
               "f1": amem_f1(p, r), **amem_bleu(p, r), **amem_rouge(p, r)} if p and r else
              {"exact_match": 0, "f1": 0.0, "bleu1": 0.0, "bleu2": 0.0, "bleu3": 0.0, "bleu4": 0.0,
               "rouge1_f": 0.0, "rouge2_f": 0.0, "rougeL_f": 0.0},
    } for p, r, c in CASES + DATASET_CASES
  ],
}
print(json.dumps(fixture, indent=2))
