# Supplied Tripo smart home model

`tripo-home-meshopt.glb` is the unchanged user-supplied
`tripo_pbr_model_a507f781-da22-4422-9ced-92edc628c304_meshopt.glb` from Downloads.
SHA-256: `cc68960a6e088183673f6ac041201fcef6677971e97a0d23257538706fc61069`.
17,659,540 bytes; one mesh/material; 988,348 vertices; 1,872,276 triangles.
The unchanged source is retained in `FRIDAY/Design/Media/Kea Energy`.
Embedded metadata establishes no third-party license; this document invents none.

Web uses Three's meshopt decoder. Hermes has no WebAssembly: the native module
selects `tripo-home-native.glb`, a losslessly decompressed equivalent with the same
quantized geometry, texture bytes, nodes and materials. It is 54,435,480 bytes,
SHA-256 `ac9d2871e87e2f28cfe2099dccd2b3b2b2255f38b8449fdf74a111311e31c6c2`.
Regenerate with `node scripts/prepare-home-model.mjs <source.glb> <native-output.glb>`.
The asset regression checks all seven decoded buffer views and model/texture metadata.

Both appearances use this model: unlit textures by default; persisted holographic
material selected in Settings. The fused mesh has no equipment identities.
Surface highlights and world-space paths use hand-authored illustrative anchors.
Orbit is bounded to yaw 0–63 degrees, elevation 15–40 degrees and zoom 0.9–1.18.
Sky, clouds, sun/moon, energy paths and highlights share the camera. No flat capsule.
Demand rendering has a capped 30 fps flow clock paused on hidden/reduced-motion screens.

Flow colours, direction and timing reference the user's private
[kea-energy-home](https://github.com/nair-akash/kea-energy-home) at
`3880b83179b32e3411517405ed8da6c030dbd462`, adapted to world-space curves.
Only mapped live power can drive measured flow; daily kWh never supplies watts.
The separately labelled illustrative preview carries no live readings.
Card hues are a lightweight native SVG adaptation of the shared
[React Bits Aurora reference](https://reactbits.dev/backgrounds/aurora), with semantic
colours and one animation clock per card group.

Replaced asset: `smart_home_energy_system1.glb`, 39,520,644 bytes, one mesh/material,
965,716 vertices, 1,499,995 triangles; SHA-256
`5ed47bbc107dea69c95dc91e605feb610ebe861407a670e39a697b838b012b5e`.
Its app and Vault copies were removed at the user's request after replacement render
and hash verification. The exact original remains recoverable from commit `b5aa62f`.
Native memory, load time and frame time remain device acceptance gates.
