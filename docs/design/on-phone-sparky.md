# On-phone Sparky (draft development build)

The mobile client keeps the existing Kea API assistant as its connected path. A separate, opt-in phone model can answer **general energy education** on supported devices. It is not a replacement for the API's verified account tools. The model receives no household readings, bill, plan, address, or Power Clash record.

## Model and runtime

| Item | Pinned value |
| --- | --- |
| Native runtime | `llama.rn` 0.12.9, using CPU mode first |
| Model | [ggml-org/Qwen3-0.6B-GGUF](https://huggingface.co/ggml-org/Qwen3-0.6B-GGUF), Apache-2.0 |
| File | `Qwen3-0.6B-Q4_0.gguf`, 428,970,080 bytes |
| Revision | `b5f37287796e5be0ea3dab2e7430873fb3f73e49` |
| SHA-256 | `da2572f16c06133561ce56accaa822216f2391ef4d37fba427801cd6736417d4` |

The model downloads only after a user enables on-phone Sparky and taps **Install model on Wi-Fi**. The download goes to a temporary file, then passes an exact-size and SHA-256 check before it is moved into the app's document directory. The app shows download, verification, installed, update, low-space, and unsupported states. A new pinned revision appears as an update rather than silently changing the model.

The current guard requires at least 3 GiB reported RAM, at least 1 GiB available storage, a native `RNLlama` module, and an arm64 Android CPU. These are conservative gates, not proof of acceptable speed or memory pressure. Android 32-bit builds are unsupported by this runtime. The default inference mode uses CPU; device profiling may justify a GPU tier later.

## Build and answer boundaries

Expo Go does not contain the C++ runtime. The app still opens there and explains that the Kea development build is required for on-phone inference. Build the project with Expo's native development-build workflow after installing dependencies. Native packages were added to the Expo config plugin list; generating and testing iOS requires macOS or an EAS build.

When the local model is enabled, installed, and the question is general energy education, Sparky runs on the phone and labels the reply **On this phone · general guidance · no account data**. Questions about a household, bill, meter, tariff, plan, carbon offset, or rewards continue to the existing Kea service. If the service is unavailable, the app shows that account answers cannot be checked offline. This is intentional until there is a customer-scoped, dated, verified fact pack with logout deletion and freshness rules.

## Release gates

- [x] Native dependencies locked; TypeScript, changed-file lint, policy tests and diff check pass.
- [ ] Build and launch native development clients on physical iOS and Android devices.
- [ ] Install and hash-verify the model over Wi-Fi, test cancellation/update/removal, and measure storage and memory on low and high capability devices.
- [ ] Inspect response quality and content boundaries with a fixed question set; verify streaming and app background behavior.
- [ ] Capture device screenshots, frame pacing, and a second teammate's machine run before merge.
- [ ] Add a verified household fact pack before claiming account-specific offline answers.

The browser has a separate inference and caching boundary and is tracked independently from this mobile card.
