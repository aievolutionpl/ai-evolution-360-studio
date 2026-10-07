# Spatial Studio audit — 2026-10-07

Baseline: `d17d423` on `main` (v0.6.0). All 35 existing Node tests passed before changes.

## Existing architecture

Node HTTP serves a vanilla JavaScript desktop UI. `ProjectStore` owns reconstruction state in `project.json`. Spirula extracts frames, reconstructs cameras and trains Gaussian splats; PlayCanvas converts and displays SOG. Existing modules implement photos/INSP, cleanup, camera settings, mesh GLB and Smart Concept Designer export. Preserve these services and endpoints.

The repository already includes a v1 scene manifest, reference assets, frame selection, local/OpenAI analysis, spatial routes and cancellable analysis jobs. Extend these instead of creating a second system.

## Findings and first increment

| Priority | Finding | Change |
| --- | --- | --- |
| High | Assets can only be created from AI detections; no binary import, replacement or download | Add bounded GLB/JPEG/PNG/WebP import, validation, immutable file versions, metadata edits and a usable library UI |
| High | `scene.json` lacks asset inventory and active analysis; output sync occurs only when a scene is read | Add compatible asset/analysis references, reconcile legacy data and sync existing manifests on project saves |
| High | Latest frames/report are published through two independent writes | Commit run files first, then switch a single reference in `scene.json`; read both from that run |
| Medium | AI prompt, response parser and network adapter share one file | Separate prompt/schema and add a provider registry while preserving existing exports |
| Medium | Detection order selects a reference without an explicit best-frame contract | Validate optional 2D observations and choose a reference using visibility and frame quality, with a quality fallback for older results |
| Medium | Job recovery checks only the newest job | Recover every unfinished job; preserve completed results and release active state even on persistence failure |
| Medium | HTTP/file helpers remain in the orchestration server | Extract them into a reusable HTTP module; keep reconstruction behavior intact |

## Image Blaster comparison

Inspected `app/src/types/world.ts`, `modules/scene/useSceneProject.ts`, `utils/worldLoader.ts`, and `.claude/scripts/{project/project-state,asset-pipeline/fal-queue,fal-3d-provider}.mjs` in [Image Blaster](https://github.com/neilsonnn/image-blaster), revision `4acb43ba126a12358f71838d1b1a05e856b10eaf`.

Useful patterns: separate environment/asset/instance data, explicit transform units, independent artifact versions, local artifact loading and isolated provider/job metadata. Adopt these concepts without copying code or replacing Spirula with World Labs. Its React/Three/Spark/Rapier viewer and generation scripts solve later-stage needs; adding those dependencies now would expand the scope without completing the foundational contracts.

## Subsequent increments

1. Object extraction: user-confirmed 2D observations, crop/mask artifacts and provenance; never imply that reference selection is segmentation.
2. Image-to-3D: generation orchestration plus FAL/Hunyuan adapters, durable queue IDs, cancellation, retries and validated downloaded GLB. No generation endpoint or paid call in this increment.
3. Hybrid editor: splat background and GLB instances from `scene.json`, transforms, replacement and undo. Detection does not establish 3D placement or remove furniture from the splat.

## Verification boundary

Run existing tests, regression tests for each changed layer, real HTTP/FFmpeg smoke tests and UI checks. This checkout does not include Spirula GPU binaries or reconstructed private scans; do not claim a new GPU reconstruction or paid AI result without running it.

Verified after implementation: existing regressions and new layer tests; real HTTP/FFmpeg on a synthetic 14-second MP4; GLB/reference import and replacement, conflicts, history, download, token/origin checks, cancellation; browser import, rename, history, filters and a 390-pixel mobile layout without horizontal overflow. `npm audit` reported zero vulnerabilities after updating the vulnerable transitive `sharp` dependency. No paid AI calls or new GPU reconstruction were run.
