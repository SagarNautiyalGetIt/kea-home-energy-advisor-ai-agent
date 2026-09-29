# On-browser Sparky (draft)

The website offers an **opt-in** local model for general energy education. It has no account tools and receives no meter readings, bill upload, plan, address or Power Clash record. The connected Kea assistant remains responsible for household-specific questions and shows its own readiness state.

## Runtime and device fit

The worker uses [Transformers.js 3.8.1](https://huggingface.co/docs/transformers.js/v3.8.1/en/index) with the [Qwen3 0.6B ONNX model](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX). The `q4f16` file is about 570 MB. The source revision is pinned at `b1ece21c06dfce3839272e86b7fa12a985d97a7a`; a changed pin shows an update instead of silently replacing the model. The browser uses its own cache, which it may later evict.

The UI checks for a secure origin, workers, WebGPU adapter and an estimated 850 MB of free browser storage before offering the download. Those checks cannot prove the GPU has enough memory or the model will be fast. The user must enable and select **Load model**; only then does the browser request model files from Hugging Face. If the browser does not support it, the connected service stays available. Local generation runs in a worker so page interaction is not blocked by JavaScript inference.

Generated replies are labelled **On this browser · general guidance · no account data**. The local router only accepts narrow, general education prompts. It sends only the eligible current question to the worker, with no account facts or conversation history. Questions about personal usage, bills, plans, savings, carbon offsets and rewards stay with the authenticated service; if unavailable, the app must show an error, not invent a result.

## Verification checkpoint

- [x] Worker bundle builds; web typecheck and lint pass; safety routing tests pass.
- [ ] Download and run the pinned model in a WebGPU desktop browser; inspect answer quality and any cache or load failures.
- [ ] Repeat on supported Android and iOS browsers; confirm unsupported and low-storage fallbacks.
- [ ] Measure latency, memory use and page responsiveness on lower-capability devices.
- [ ] Verify cancellation, cache removal, model update and logout behavior before merge (the removal path is implemented but not yet browser-tested).
- [ ] Capture browser screenshots and a second-machine run before merge.

This draft does not establish universal offline AI or customer-specific offline answers. Those claims require device evidence and a verified local fact pack, respectively.

## Pre-mortem before release

**Failure statement:** It is 14 days later; browser-local Sparky gave a confident household answer it could not verify, or its model download froze a low-memory device.

- **Tiger — block release:** The general-question router is lexical and can miss personal requests. Review a fixed adversarial prompt set and keep account prompts on the API; the current tests cover only representative cases.
- **Tiger — block release:** A 570 MB file and WebGPU session may exceed a phone's memory even when storage is available. Measure load, generation, cancellation and page responsiveness on supported low-end devices.
- **Tiger — block release:** Cache removal and model-update behavior are browser-dependent. Verify both on the target browsers before promising offline readiness.
- **Paper tiger dismissed for this draft:** The model automatically downloads on page visit. Code starts its worker only after the user opts in and selects **Load model**.
- **Elephant:** None identified for this opt-in, general-guidance draft. Account-specific local inference needs a separate privacy and evidence design decision.
