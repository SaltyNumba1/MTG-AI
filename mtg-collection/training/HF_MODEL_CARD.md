---
license: apache-2.0
base_model: mistralai/Mistral-7B-Instruct-v0.2
tags:
  - mtg
  - magic-the-gathering
  - commander
  - edh
  - deckbuilding
  - lora
  - peft
  - gguf
  - llama-cpp
  - ollama
language:
  - en
library_name: peft
pipeline_tag: text-generation
---

# Model Card for mistral-commander-lora

A Mistral-7B-Instruct fine-tune (LoRA + GGUF) specialized for **Magic: The Gathering Commander (EDH) deckbuilding**. Given a commander and a JSON list of owned cards, it returns a 99-card decklist that respects color identity, the singleton rule, and basic Commander deckbuilding heuristics.

This is the model that powers the [MTG Collection desktop app](https://github.com/SaltyNumba1/MTG-AI).

## Model Details

### Model Description

`mistral-commander-lora` is a parameter-efficient fine-tune of Mistral-7B-Instruct-v0.2 trained on synthetic Commander deckbuilding examples generated from Scryfall card data. The repo ships three artifacts so users can plug it in however they like:

| File | Size | Use |
|---|---|---|
| `mistral-commander-q4.gguf` | ~4.37 GB | Drop-in Q4_K_M quantized model for [Ollama](https://ollama.com) / `llama.cpp`. No training step required. |
| `mistral-commander-lora.zip` | small | Raw PEFT/LoRA adapter (`adapter_model.safetensors` + `adapter_config.json`) for users who want to merge into their own base or stack with other adapters. |
| `adapter_config.json` | tiny | LoRA hyperparameters (rank, alpha, target modules). |

- **Developed by:** SaltyNumba1
- **Model type:** Causal LM (Mistral architecture), LoRA adapter + Q4_K_M GGUF
- **Language(s) (NLP):** English (with MTG card-name proper nouns)
- **License:** Apache 2.0 (inherits from Mistral-7B-Instruct-v0.2)
- **Finetuned from model:** [`mistralai/Mistral-7B-Instruct-v0.2`](https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.2)

### Model Sources

- **Repository (app):** https://github.com/SaltyNumba1/MTG-AI
- **Model repo:** https://huggingface.co/SaltyNumba1/mistral-commander-lora
- **Card data source:** [Scryfall](https://scryfall.com) bulk data (`oracle-cards`)

## Uses

### Direct Use

Generate 99-card Commander decks from a user-supplied collection. Typical prompt shape:

```
You are an expert MTG Commander deckbuilder.
Commander: <name> (color identity: <WUBRG>)
Owned cards (JSON): [{"name": "...", "type_line": "...", "mana_cost": "..."}, ...]
Return a 99-card decklist as JSON, respecting color identity and singleton.
```

Best consumed via Ollama with the included `Modelfile`, named `mtg-commander`:

```bash
ollama create mtg-commander -f Modelfile
ollama run mtg-commander
```

### Downstream Use

- Backbone for any MTG deckbuilding tool, draft assistant, or card-recommendation UI.
- Fine-tune further on a specific format (Pioneer, Modern, cEDH) by continuing LoRA training.
- Merge the adapter into the base for distribution as a single weight set.

### Out-of-Scope Use

- **Not a rules engine.** It does not enforce the comprehensive rules, banlists, or precise interaction timing — always validate generated decks against a real engine (e.g., Scryfall's banlist API, Moxfield, Archidekt).
- **Not a tournament-legal deck optimizer.** Output reflects training-data heuristics, not metagame-aware tuning.
- Not for general-purpose chat, code, or non-MTG tasks — performance outside MTG context is no better than the base model and may be worse.
- Not for generating or reasoning about real-world legal, medical, or financial advice.

## Bias, Risks, and Limitations

- **Card-pool recency:** Trained on a snapshot of Scryfall data. Cards printed after the snapshot date are unknown to the model and may be hallucinated or omitted. Re-run the dataset pipeline to refresh.
- **Hallucination of card names/text:** Like all LLMs, the model may invent plausible-sounding card names that do not exist. The companion app validates output against Scryfall and discards invalid entries.
- **Color identity / singleton mistakes:** The model usually respects color identity and singleton, but not 100% of the time. Downstream validation is required.
- **Bias toward popular / staple cards:** Training data reflects the broader Commander community's preferences, which over-represents staples (Sol Ring, Arcane Signet, etc.) and under-represents niche or budget alternatives.
- **English-only:** Non-English card names are not supported.

### Recommendations

Always pipe model output through a deterministic validator (color identity, banlist, singleton, owned-collection check) before presenting decks to a user. The MTG Collection app does this automatically.

## How to Get Started with the Model

### Option A — Use the prebuilt GGUF with Ollama (easiest)

```bash
# Download just the GGUF
huggingface-cli download SaltyNumba1/mistral-commander-lora \
  mistral-commander-q4.gguf --local-dir .

# Build the Ollama model (Modelfile lives in the app repo)
ollama create mtg-commander -f Modelfile
ollama run mtg-commander
```

### Option B — Use the LoRA with `transformers` + `peft`

```python
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

base_id = "mistralai/Mistral-7B-Instruct-v0.2"
adapter_id = "SaltyNumba1/mistral-commander-lora"

tok = AutoTokenizer.from_pretrained(base_id)
model = AutoModelForCausalLM.from_pretrained(base_id, device_map="auto", torch_dtype="auto")
model = PeftModel.from_pretrained(model, adapter_id)

prompt = "Commander: Atraxa, Praetors' Voice\nOwned cards: [...]\nReturn a 99-card deck."
out = model.generate(**tok(prompt, return_tensors="pt").to(model.device), max_new_tokens=2048)
print(tok.decode(out[0], skip_special_tokens=True))
```

### Option C — Merge LoRA → GGUF yourself

See the Colab notebook in the [MTG-AI repo](https://github.com/SaltyNumba1/MTG-AI) under `mtg-collection/training/`.

## Training Details

### Training Data

Synthetic Commander deck examples generated from Scryfall's `oracle-cards` bulk download. Each example consists of:
- A randomly-chosen legendary creature (commander).
- A simulated "owned collection" sampled from the legal card pool for that color identity.
- A target 99-card deck built from heuristics (mana curve, ramp/draw/removal/wincon mix, land-count targets, color-identity legality, singleton).

Dataset generator and seed scripts live in `mtg-collection/training/` of the app repo. The dataset itself is not published on HF (regeneratable from Scryfall + the included scripts).

### Training Procedure

#### Preprocessing

- Card text cleaned (reminder text stripped where redundant, mana symbols normalized).
- Examples formatted as Mistral-Instruct `[INST] ... [/INST]` turns.
- Long examples truncated to fit the base model's 8K context.

#### Training Hyperparameters

- **Method:** LoRA (PEFT) on attention + MLP projections
- **Rank / alpha:** see `adapter_config.json` in this repo
- **Training regime:** bf16 mixed precision
- **Optimizer:** AdamW
- **Hardware:** single Google Colab GPU (A100 / T4 depending on session)

#### Speeds, Sizes, Times

- Adapter file: a few hundred MB uncompressed, packaged as `mistral-commander-lora.zip`.
- Quantized GGUF (Q4_K_M): ~4.37 GB.
- Training time: a few hours on Colab (varies with dataset size).

## Evaluation

### Testing Data, Factors & Metrics

#### Testing Data

Held-out synthetic prompts plus manual prompts using popular commanders (Atraxa, Edgar Markov, Korvold, etc.) against curated personal collections.

#### Factors

- Color identity legality
- Singleton legality
- Owned-collection containment (does the deck use only cards the user has?)
- Reasonable mana curve and land count (~36–38 lands)
- Inclusion of role staples (ramp, draw, removal, wincons)

#### Metrics

Reported informally for the v1 release:

| Metric | Approximate |
|---|---|
| Color-identity legal decks | high (validator backstop catches the rest) |
| Singleton-legal | high |
| 99-card output count (no padding required) | majority |
| Subjective "playable" rating on staple commanders | usable as a starting point; expect manual edits |

### Results

#### Summary

The model is intended as a **deckbuilding assistant**, not an oracle. It produces coherent starting points that human players (and the validator) refine. It is not benchmarked against established deckbuilding bots.

## Environmental Impact

- **Hardware Type:** Google Colab GPU (T4 / A100, varies per session)
- **Hours used:** a few hours per training run
- **Cloud Provider:** Google Colab
- **Compute Region:** Unknown (Colab-assigned)
- **Carbon Emitted:** Small relative to base model pre-training; not separately measured. Estimate via the [ML CO2 calculator](https://mlco2.github.io/impact#compute) if needed.

## Technical Specifications

### Model Architecture and Objective

Mistral-7B decoder-only transformer, instruction-tuned base, LoRA-adapted for MTG Commander deck generation. Objective: next-token prediction on instruction/response pairs where the response is a JSON decklist.

### Compute Infrastructure

#### Hardware

Google Colab (single GPU per run).

#### Software

- `transformers`, `peft`, `bitsandbytes`, `trl`, `accelerate`
- `llama.cpp` for GGUF conversion / quantization (Q4_K_M)
- [Ollama](https://ollama.com) for serving in the desktop app

## Citation

**BibTeX:**

```bibtex
@misc{mistral-commander-lora,
  title  = {mistral-commander-lora: a LoRA fine-tune of Mistral-7B-Instruct for MTG Commander deckbuilding},
  author = {SaltyNumba1},
  year   = {2026},
  url    = {https://huggingface.co/SaltyNumba1/mistral-commander-lora}
}
```

**APA:**

SaltyNumba1. (2026). *mistral-commander-lora: a LoRA fine-tune of Mistral-7B-Instruct for MTG Commander deckbuilding* [Model]. Hugging Face. https://huggingface.co/SaltyNumba1/mistral-commander-lora

## Glossary

- **Commander / EDH:** A 100-card MTG format with one legendary "commander" defining color identity; all other cards are singleton.
- **Color identity:** The set of WUBRG colors that appear anywhere in a card's mana cost or rules text.
- **Singleton:** Each non-basic card may appear at most once in the deck.
- **LoRA:** Low-Rank Adaptation, a parameter-efficient fine-tuning method.
- **GGUF:** llama.cpp's model container format; used by Ollama.
- **Q4_K_M:** A 4-bit quantization scheme with good quality/size tradeoff.

## More Information

- App and full pipeline: https://github.com/SaltyNumba1/MTG-AI
- Card data: https://scryfall.com/docs/api/bulk-data

## Model Card Authors

SaltyNumba1

## Model Card Contact

Open an issue on the [MTG-AI GitHub repo](https://github.com/SaltyNumba1/MTG-AI/issues).
