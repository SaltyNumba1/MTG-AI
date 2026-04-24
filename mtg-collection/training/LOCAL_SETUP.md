# Local Setup Guide — MTG Commander AI

After training completes on Colab, follow these steps to run the model locally
on your AMD RX 5700 GPU.

---

## Quick path: download the model from Hugging Face

If you don't want to train your own copy, the model is published at:

**🤗 https://huggingface.co/SaltyNumba1/mistral-commander-lora**

Two files of interest in that repo:

| File | What it is | Use it if… |
|---|---|---|
| `mistral-commander-q4.gguf` | Prebuilt Q4_K_M quantized model (~4 GB) | You just want it to work — drop in and go. |
| `mistral-commander-lora.zip` | Raw LoRA adapter on top of Mistral 7B Instruct v0.2 | You want to merge it yourself or further fine-tune. |

### Option A — Use the prebuilt `.gguf` (recommended)

1. Open the HF repo's **Files and versions** tab.
2. Click `mistral-commander-q4.gguf` → click the download icon (top right of the file viewer).
3. Save to:
   ```
   mtg-collection\training\mistral-commander-q4.gguf
   ```
4. Skip to **Step 2** below.

CLI alternative (requires `huggingface-cli`):
```powershell
pip install -U "huggingface_hub[cli]"
huggingface-cli download SaltyNumba1/mistral-commander-lora mistral-commander-q4.gguf --local-dir mtg-collection\training
```

### Option B — Merge the LoRA yourself (Colab)

1. Download `mistral-commander-lora.zip` from the HF repo.
2. Open `MTG_Mistral_LoRA_Training.ipynb` in Colab.
3. Skip the training cell. Upload `mistral-commander-lora.zip` to the Colab workspace and unzip it where the notebook expects the trained adapter.
4. Run the export cells listed in **Step 1** below (starting from `install_llamacpp`) to merge + quantize + download the `.gguf`.

---

## Using a different base model (Gemma, Llama 3, Qwen, etc.)

The app reads the model name from the `OLLAMA_MODEL` environment variable (default: `mtg-commander`). You have two choices:

### Just use a stock model (no MTG fine-tune)

```powershell
ollama pull gemma:7b
$env:OLLAMA_MODEL = "gemma:7b"   # set before launching MTG Collection.exe
```

Or create `.env` next to the exe with `OLLAMA_MODEL=gemma:7b`. Works immediately, but the model won't be MTG-specialized.

### Fine-tune the new base on the MTG dataset

⚠️ The published LoRA is **Mistral-7B-specific** and cannot be reused on top of Gemma / Llama 3 / etc. — different architectures. To get an MTG-specialized version of another base model you must retrain:

1. Open `MTG_Mistral_LoRA_Training.ipynb` in Colab.
2. Change the base-model identifier from `mistralai/Mistral-7B-Instruct-v0.2` to e.g. `google/gemma-7b-it`.
3. Make sure the LoRA `target_modules` list still matches your chosen base (Mistral, Llama, Gemma all use `q_proj`/`k_proj`/`v_proj`/`o_proj`; double-check via `print(model)`).
4. Re-run training (the dataset generator using Scryfall + EDHREC is reusable as-is) → merge → quantize → download the new `.gguf`.
5. Edit `Modelfile` to point `FROM` at your new `.gguf` and `ollama create <your-model-name> -f Modelfile`.
6. Set `OLLAMA_MODEL=<your-model-name>` and launch the app.

---

## Step 1 — Run Colab export cells (in order)

After the training cell finishes in Colab (or after uploading the prebuilt LoRA
from Hugging Face — see Option B above), run these cells:

1. **`install_llamacpp`** — clones llama.cpp and installs gguf tools
2. **`build_llamacpp`** — compiles the quantize binary (~2 min)
3. **`merge_adapter`** — merges LoRA into base weights (~5 min on A100)
4. **`convert_gguf`** — converts to fp16 then quantizes to Q4_K_M (~10 min)
5. **`download_gguf`** — downloads `mistral-commander-q4.gguf` (~4 GB)

Place the downloaded `.gguf` file in:
```
MTG AI\MTG AI\mtg-collection\training\mistral-commander-q4.gguf
```

---

## Step 2 — Install Ollama

Download and install from: https://ollama.com/download

Verify it's working:
```
ollama list
```

---

## Step 3 — Create the model

From this directory (`mtg-collection\training\`):

```bash
ollama create mtg-commander -f Modelfile
```

This registers your GGUF as a named model Ollama can serve.

---

## Step 4 — Run it

**Interactive chat:**
```bash
ollama run mtg-commander
```

**As an API (for your app):**
```bash
# Start Ollama server (runs on http://localhost:11434)
ollama serve

# Test with curl
curl http://localhost:11434/api/chat -d '{
  "model": "mtg-commander",
  "messages": [{"role": "user", "content": "Build me a Meren of Clan Nel Toth graveyard deck"}]
}'
```

---

## AMD GPU Notes

Ollama uses **Vulkan** on Windows for AMD GPUs — no ROCm required.

- Your RX 5700 (8GB) will fit Q4_K_M Mistral 7B (~4.1 GB VRAM) with room to spare
- Expect ~15–25 tokens/second generation speed
- If Ollama doesn't detect your GPU, set: `OLLAMA_GPU_LAYERS=99`

---

## Troubleshooting

| Problem | Fix |
|---|---|
| GPU not used | Run `ollama run mtg-commander` and check `ollama ps` for GPU layers |
| OOM error | Reduce `num_gpu` in Modelfile (e.g., `PARAMETER num_gpu 20`) |
| Slow (~2 tok/s) | Ollama fell back to CPU — check GPU driver is up to date |
| Bad outputs | The model needs more training data — re-run fetchers and retrain |
