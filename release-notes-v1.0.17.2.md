# MTG Collection v1.0.17.2

## Adaptive GPU Retry + CPU Fallback Fix

### What Changed

- Added adaptive startup retries for llama-server GPU layers:
  - `--n-gpu-layers 99`
  - `--n-gpu-layers 60`
  - `--n-gpu-layers 40`
  - `--n-gpu-layers 20`
  - `--n-gpu-layers 0` (CPU fallback)
- Added OOM detection from `llama-server.log` tail so the app can decide when to retry with fewer GPU layers.
- Updated llama startup flow so backend startup still runs in parallel while adaptive retries complete.
- Updated startup wait logic to await adaptive llama initialization before health polling.

### Why This Matters

Some laptop GPUs do not have enough free VRAM to satisfy high offload settings. Previously, forcing high `n_gpu_layers` could cause llama-server to fail and exit without ever reaching CPU fallback. This release ensures the app keeps stepping down until it can run.

### Validation

Observed expected startup behavior on constrained VRAM hardware:

1. 99 GPU layers: OOM
2. 60 GPU layers: OOM
3. 40 GPU layers: OOM
4. 20 GPU layers: OOM
5. 0 GPU layers (CPU): model loads and `/health` reports ready

### Notes

- This fix is implemented in frontend Electron startup logic.
- Release artifacts should be rebuilt from this tag before publishing binaries.
