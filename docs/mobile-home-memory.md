# Native Home memory compatibility

Issue #342; reported on Realme Pad 2 Lite, Android 14, using Expo Go.

Three requester screenshots show one failure: `ExponentFileSystem.readAsStringAsync` rejects with `java.lang.OutOfMemoryError` while loading `tripo-home-native.glb`. Personal screenshots remain local and are not included in this repository or PR.

## Allocation fix

The installed Fiber native FileLoader reads the entire 54,435,480-byte asset as base64, then constructs a binary buffer. Its minimum base64 character count is 72,580,640, before string representation, transport and buffer copies. The repair does not patch Fiber, Three or global loaders.

`home-model-loader.native.ts` downloads the asset to disk and opens it read-only through the installed Expo File API. The scoped native loader reads the small GLB header/JSON and supplies only requested buffer views through a GLTF parser plugin. Each native read is capped at 256 KiB and file handles close on success or failure. No full-model string, base64 representation, full BIN copy or whole-file ArrayBuffer is constructed.

The house already displays a MeshBasicMaterial. Native parsing uses the glTF unlit material path and omits the unused normal attribute and two normal/ORM texture dependencies. The actual source regression compares exact position, UV and index bytes and verifies only the base-colour image is requested. Both realistic and holographic appearances retain the same source geometry and base colour. Neither GLB nor the original Bloub is modified.

One resource coalesces Home loading across scene mounts. Download/parse failures settle into the existing unavailable-model message without throwing through a render boundary or automatically retrying a memory failure. The GL canvas mounts only after model parsing succeeds; the outer dashboard, readings and navigation remain independent.

## Render size and device limits

Web uses a DPR bounded by 1.5 and 1,200,000 render pixels. The installed Fiber native Canvas overrides the supplied DPR with the device's PixelRatio; a DPR prop alone would not implement the budget. The native adapter therefore sizes the physical GL view within the same pixel budget, then scales its visual box to fill the original scene area. It remeasures on layout/orientation/window changes. Orbit handling remains on the full-size parent. Multisample antialiasing is disabled for this scene.

The untouched source still contains 1,872,276 triangles and a large base-colour texture. This fixes the demonstrated allocation waste and limits framebuffer work, but cannot promise full-detail rendering on every GPU. Unsupported/failing devices must retain functional readings and navigation. A lower-detail derivative is a separate art/performance decision if physical testing still shows limits; no unapproved geometry simplification was introduced here.

## Verification

Automated regressions run the actual installed GLTFLoader against the real Home asset with FileLoader disabled. They test concurrent request isolation, source preservation, unused view exclusion, chunk limits, malformed/download failures, manager accounting, shared-resource failure handling and phone/tablet/landscape/resized render surfaces.

Physical acceptance: reload the repair Expo project on the Realme tablet and an Android phone/iOS device; log in, open Home, wait for reveal, rotate/zoom, toggle equipment highlights and appearance, switch tabs repeatedly, background/foreground and exercise available orientations. Check that no red memory error appears, source colours/highlights remain correct, the visually scaled scene fills its frame, touch coordinates remain correct and readings/navigation remain usable. Record device models and OS versions. Bundle exports are not physical memory/frame-time evidence; second-machine and approving review gates remain open before merge.

Requester confirmation on 4 October 2026: Realme Pad 2 Lite, Android 14, Expo Go reload — “The house appears and rotates” in response to the no-red-memory-error check. This establishes the reported tablet failure is resolved for that observed interaction. It does not establish all other devices, long-session memory/frame time, appearance/highlight checks or iOS acceptance.

API: no changes; OpenAPI remains unchanged. Local runtime uses explicitly synthetic fixtures, with persistence/alerts/voice disabled and live AI unavailable.

Installed API reference: [Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/).
