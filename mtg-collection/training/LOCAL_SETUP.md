# Local Setup Guide — MTG Commander AI

After training completes on Colab, follow these steps to run the model locally
on your AMD RX 5700 GPU.

---

## Step 1 — Run Colab export cells (in order)

After the training cell finishes in Colab, run these cells:

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
