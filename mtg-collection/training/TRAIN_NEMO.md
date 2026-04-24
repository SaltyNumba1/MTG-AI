# Train v2 — Mistral-Nemo-12B QLoRA runbook

End-to-end guide to train `mtg-commander-nemo` from `mistralai/Mistral-Nemo-Instruct-2407`.

The actual training happens in **`MTG_Nemo_LoRA_Training.ipynb`** — open it in Google Colab and run top-to-bottom. This document covers what to do **before** opening the notebook and what to do **after** it finishes.

---

## Prerequisites

1. **Dataset v3 built locally** — see [`DATASET_V3.md`](./DATASET_V3.md). You need:
   - `data/processed_v3/chat_train.jsonl`
   - `data/processed_v3/chat_eval.jsonl`

2. **Hugging Face account** with the gated Mistral-Nemo license accepted:
   - Visit <https://huggingface.co/mistralai/Mistral-Nemo-Instruct-2407>
   - Click **Agree and access repository** (instant approval).

3. **HF Read token** at <https://huggingface.co/settings/tokens> — create one with **Read** scope, save the `hf_...` string.

4. **Google Drive with ~30 GB free** for checkpoints + final GGUF.

5. **Colab Pro recommended** — A100-80 (best, ~10–15 hr single session), A100-40 (~15–25 hr), L4 (~25–40 hr split sessions), T4 (~40–60 hr many sessions). Free Colab works on T4 but disconnects more aggressively.

---

## Step 1 — Upload dataset to Drive

```
MyDrive/
  mtg-training/
    dataset_v3/
      chat_train.jsonl   ← from data/processed_v3/
      chat_eval.jsonl    ← from data/processed_v3/
```

Easiest: drag-and-drop in <https://drive.google.com>. The whole `processed_v3` folder is small (a few hundred MB at v3 target sizes).

## Step 2 — Open the notebook in Colab

1. Open <https://colab.research.google.com>.
2. **File → Upload notebook** → pick `mtg-collection/training/MTG_Nemo_LoRA_Training.ipynb` from this repo. Or open it directly from GitHub (File → Open → GitHub tab).
3. **Runtime → Change runtime type → GPU** → pick the best one available (Pro: try A100 first, fall back to L4 if unavailable).
4. Run cells 1 → 13 in order.

The notebook **auto-detects your GPU** and chooses QLoRA-4bit (T4/L4) or bf16 LoRA (A100), the right context length, LoRA rank, and batch size. No manual tweaking needed for a first run.

## Step 3 — Survive Colab disconnects

Checkpoints save to Drive every 250 steps. If you get kicked off:

1. Reconnect to a runtime (same or different GPU is fine — but stay within the same VRAM tier; switching from QLoRA to bf16 mid-run isn't supported).
2. Re-run cells 1 → 7 (mount, install, login, detect GPU, configure).
3. Re-run cell 8 (`trainer.train(...)`) — it auto-resumes from the latest `checkpoint-XXXX/` in Drive.

Total wall-clock time should be roughly the same as an uninterrupted run; Colab's free idle disconnects can cost you 30–60 min of progress per disconnect at most.

## Step 4 — After training

The notebook handles all of this automatically (cells 9–12):

| Cell | Output |
|---|---|
| 9  | Smoke-test prompt — sanity check the adapter |
| 10 | Merge LoRA into base bf16 weights |
| 11 | Convert merged model → GGUF F16 → quantize to Q4_K_M (~7.5 GB) |
| 12 | (Optional) push GGUF + adapter to a new HF repo |

Final artifact: **`/content/drive/MyDrive/mtg-training/runs/nemo-v2-sft/gguf/mtg-commander-nemo-q4_k_m.gguf`**

## Step 5 — Install on your local machine

Download the GGUF from Drive (or HF if you uploaded it), then:

```powershell
# From mtg-collection/training/
# 1. Edit Modelfile so FROM points at the new GGUF
#    Change: FROM ./mistral-commander-q4.gguf
#    To:     FROM ./mtg-commander-nemo-q4_k_m.gguf
# 2. Bump num_ctx so the app can stuff in big collections (Nemo supports 128K)
#    PARAMETER num_ctx 32768   # safe default; raise if you want more
# 3. Build:
ollama create mtg-commander-nemo -f Modelfile
# 4. Test:
ollama run mtg-commander-nemo "Build a 99-card Atraxa deck"
```

## Step 6 — Point the desktop app at the new model

PowerShell session (one-shot):

```powershell
$env:OLLAMA_MODEL = 'mtg-commander-nemo'
& "C:\path\to\MTG Collection.exe"
```

Or persistent — drop a `.env` file next to `MTG Collection.exe` containing:

```
OLLAMA_MODEL=mtg-commander-nemo
```

The v1 model (`mtg-commander`) stays installed as a fallback. To revert, `unset` the env var or remove the `.env` line.

---

## Troubleshooting

**`OutOfMemoryError` on the model load cell.**
You're on a smaller GPU than the profile expects. Confirm cell 3 picked the right profile for your VRAM. If on a T4 and still OOM, lower `PROFILE['max_seq_len']` to 2048.

**`401 Unauthorized` when downloading the base model.**
You haven't accepted the gated license, or your HF token doesn't have Read scope. Re-do prerequisites 2 + 3.

**`bitsandbytes` import errors.**
Pin: `pip install bitsandbytes==0.44.1`. Newer versions occasionally regress on Colab kernels.

**Training loss stuck near zero from step 1.**
The chat template may not be applied — print `train_ds[0]['text']` in cell 6 and confirm it's wrapped in Nemo's `[INST]` markers. If it's raw role labels, your `transformers` version is too old; upgrade.

**`convert_hf_to_gguf.py` errors on Mistral-Nemo.**
You need a recent `llama.cpp` (post Aug 2024). The notebook clones `--depth=1` from main, which should be fresh enough. If it's broken, try the `b3666` tag or later.

**Final GGUF is way too big or too small.**
Q4_K_M for a 12B model should land around 7.0–7.8 GB. <5 GB or >9 GB means quantization didn't run on the right file — check cell 11 paths.
