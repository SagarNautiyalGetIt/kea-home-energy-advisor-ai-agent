# Asset provenance

## Manifest

| Asset                                      | Purpose                                          | Notes                                                             |
| ------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------- |
| `design-assets/kea-home-transparent.png`   | High-resolution transparent architectural source | Byte-identical to the runtime house image                         |
| `public/assets/kea-home.png`               | Runtime architectural image                      | Kept in `public/` so Vite serves a stable asset path              |
| `design-assets/kea-home-studio-render.png` | Studio-background presentation render            | Used as the repository hero image                                 |
| `design-assets/concept-v1-render.png`      | Early concept exploration                        | Retained to show the design iteration                             |
| `design-assets/concept-v1-prompt.txt`      | Reproducible visual specification                | Documents composition, lighting, materials, and conduit placement |
| `public/assets/geist-*.otf`                | Runtime typography                               | Geist, licensed under SIL OFL 1.1                                 |

## Content Credentials

Some PNG files contain signed C2PA/Content Credentials metadata indicating generative-media creation or processing by services including OpenAI, Google, or PixelBin. The metadata is preserved rather than stripped so downstream users can inspect the media history.

Content Credentials describe media provenance. They do not create Git commits, GitHub contributors, or maintainership claims.

## Licensing

The project's assets and specifications are released under MIT. Geist remains under SIL OFL 1.1. See the root `LICENSE`, `THIRD_PARTY_NOTICES.md`, and `public/assets/OFL.txt`.

When redistributing the project, retain the copyright and license notices required by the applicable licenses.
