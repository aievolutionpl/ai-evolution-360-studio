# Third-party software

AI Evolution 360 Studio integrates existing engines; it is not a new reconstruction engine or renderer.

| Component | Upstream | License | Pinned source |
|---|---|---|---|
| Spirula Studio | https://github.com/harry7557558/spirula-studio | GPL-3.0 | d8e6a267f906261ba3207f55317c67a20081620b |
| SplatTransform | https://github.com/playcanvas/splat-transform | MIT | afbc281d765d50185f6182f23abd9c6720b3b998 (3.6.6) |
| SuperSplat Viewer | https://github.com/playcanvas/supersplat-viewer | MIT | 733ad5743a718c840960eab7656f45446d8370f1 (1.35.2) |

Setup downloads Spirula v2026.9.24 from its official release. Source for that binary is available at the corresponding upstream tag. The source pin above records the locally compiled engine used in end-to-end tests; binary-release parity has not been established.

PlayCanvas dependencies retain their own licenses. Keep upstream licenses and notices when redistributing them. FFmpeg/ffprobe are external prerequisites; licensing depends on the installed build. No third-party executable or source is bundled here.

Original integration code: Copyright (c) 2026 AI Evolution Polska, GPL-3.0-only; see LICENSE. Screenshots show our interface and synthetic QA content. Insta360 is a third-party trademark; this is an independent community project.
