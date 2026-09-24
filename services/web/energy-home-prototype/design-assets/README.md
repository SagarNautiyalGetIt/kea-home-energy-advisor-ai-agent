# Design Assets — Kea Energy Home

This folder contains high-resolution 3D models, architectural renders, and generative prompt specifications used for the Kea Energy Home prototype.

## Assets Overview

| Asset Name                   | Resolution / Format    | Description                                                                                                                                                                                                                                             |
| ---------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kea-home-transparent.png`   | 4224 × 2304 PNG (RGBA) | Final approved 3D architectural cutaway model with transparent alpha background. Includes rooftop photovoltaic panels, wall-mounted Kea battery, open garage with electric sedan and charger, grid service connection, and integrated conduit channels. |
| `kea-home-studio-render.png` | 2816 × 1536 PNG (RGB)  | Original full studio render of the contemporary pitched-gable home before background extraction.                                                                                                                                                        |
| `concept-v1-render.png`      | 1536 × 1024 PNG (RGBA) | Initial concept exploration render for the 3D home energy cutaway scene.                                                                                                                                                                                |
| `concept-v1-prompt.txt`      | Text Specification     | Complete generative prompt engineering specification defining camera perspective (30° elevated three-quarter), architectural materials, lighting fill, battery branding, and conduit pathways.                                                          |

### Web Runtime Assets

The web application's runtime assets (transparent model, vector favicon, and Geist typography suite) are located in `public/assets/` and `public/favicon.svg`.

## Provenance and license

Some PNG files retain signed C2PA/Content Credentials metadata describing generative-media creation or processing. The metadata is intentionally preserved. See [`docs/ASSET_PROVENANCE.md`](../docs/ASSET_PROVENANCE.md) for the manifest and provenance boundary.

Project assets are released under the repository's MIT License. Geist font files remain under SIL OFL 1.1.
