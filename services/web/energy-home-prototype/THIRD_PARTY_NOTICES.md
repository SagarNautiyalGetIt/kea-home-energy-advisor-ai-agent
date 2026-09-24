# Third-party notices

Kea Energy Home is released under MIT; its copyright and permission notices are in [LICENSE](LICENSE). The following third-party software, fonts, services, and data sources retain their own terms.

## Runtime libraries

| Component              | Use                          | License                                                     |
| ---------------------- | ---------------------------- | ----------------------------------------------------------- |
| React and React DOM    | UI runtime                   | MIT                                                         |
| Vite and TypeScript    | Build and type checking      | MIT / Apache-2.0                                            |
| GSAP and `@gsap/react` | Motion and flow animation    | [GSAP Standard License](https://gsap.com/standard-license/) |
| SunCalc                | Solar and lunar calculations | BSD-2-Clause                                                |
| Lucide React           | Interface icons              | ISC                                                         |

The exact dependency graph and versions are recorded in `package-lock.json`.

## Fonts

The bundled Geist font files are copyright the Geist Project Authors and are distributed under the SIL Open Font License 1.1. A copy is included at [`public/assets/OFL.txt`](public/assets/OFL.txt).

## External data services

- Weather data: [Open-Meteo](https://open-meteo.com/), with provider terms and attribution shown in the application.
- Geocoding: Open-Meteo geocoding with [GeoNames](https://www.geonames.org/) attribution.

Provider terms may change independently of this repository. Review them before commercial or high-volume deployment.

## Media provenance

Some included PNG files retain signed C2PA/Content Credentials metadata recording generative-media creation or processing. This metadata is intentionally preserved. It does not create a GitHub contributor or change the repository's commit authorship. See [Asset provenance](docs/ASSET_PROVENANCE.md).
