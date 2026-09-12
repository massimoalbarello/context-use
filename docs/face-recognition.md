# Face recognition

Image assets `depicts` person entities. Asset details expose each linked person and whether the
assignment is automatic or confirmed. On person pages, **Appears in** shows compact image cards
beside **Mentioned by**, using the same effective links. Cropped faces are derived files, not assets
or separate people.

## Using it

Assign a portrait with one visible face to a person entity. It becomes the recognition reference
automatically and checks existing images, including unknown faces. Group portraits do not enroll a
reference automatically. Unknown faces do not create entities, and automatic matches never become
training references.

Uploads commit their original bytes and metadata before starting recognition. Recognition runs one
image at a time without a queue. Images arriving while it is busy remain unprocessed. Retry an image
from its detail page, or use **Settings → Face recognition → Process images** to scan failed,
unprocessed, interrupted, and older-model images. Stopping the scan stops after its current request;
there is no scheduled work to resume after an app restart.

On image details, **Process image** sits above **Download**. Click a face box to review it; unmatched
boxes show **Unknown**. Review supports confirming, changing the person, leaving unidentified,
and dismissing a false detection. **Show dismissed faces** restores
their boxes for review. Confirmed regions survive re-analysis. If a detector cannot safely associate
a new region with an existing correction, the old decision stays visible for
review rather than transferring to another face. Changing a reference's identity retires that
reference. Retrying the image cannot undo that correction.

The threshold is cosine similarity, not a probability. A higher value requires a closer match.
**Save threshold** affects subsequent matching; **Save & re-match** also recalculates existing
automatic assignments from stored embeddings, without running image inference. User decisions remain
fixed. Thresholds belong to an owner and embedding space; a different model space starts with its own
default instead of inheriting a potentially incompatible number.

## Boundaries and storage

- `models/faces` owns observations, embedding compatibility, cosine matching and conservative region
  reconciliation. Embeddings must share an explicit space identifier and dimensions to be compared.
- `lib/face-analysis/FaceAnalyzer` is the inference port: owner identity, image bytes and cancellation
  go in; regions, scores, embeddings and JPEG crops come back. It knows nothing about entities,
  database IDs, matching thresholds, links, HTTP routes or retries.
- `LocalFaceAnalyzer` adapts a native subprocess to that port. Each analysis releases the process and
  its model memory on completion; verified model files are reused. The subprocess uses OpenCV,
  YuNet and SFace INT8, reads only request scratch files, and returns results through a line protocol.
- `services/assets` owns processing, portrait enrollment and matching. It uses repository contracts
  and storage interfaces. HTTP and MCP portrait assignment share this asset workflow.
- `repositories/faces` publishes each analysis transactionally, preserves human annotations, and
  rejects stale attempts and matches computed against replaced embeddings. It owns a dedicated
  synchronous SQLite connection: publications never yield while holding a write lock, and contention
  with canonical writes is retried between complete transactions. The `asset_depicts_entity` view
  defines effective links once for asset reads and person image lists.

Originals remain in the existing asset store. Crops live under
`DATA_FOLDER/face-crops/<owner>/<asset>/<crop>.jpg` and are served only through owner-authorized routes.
Replacement analysis deletes obsolete unprotected crops after committing. Referenced or annotated
regions keep the evidence needed to display the decision. Model files and disposable request scratch
files live under `DATA_FOLDER/runtime/face-analysis`; neither becomes a searchable asset.

## Changing models or execution locations

`analysisVersion` identifies the whole detection/preprocessing pipeline. `embeddingSpace` identifies
comparable recognition outputs, independently of vector length. A weight, alignment or normalization
change that affects compatibility needs a new space identifier. Embedding revisions also prevent a
match computed from an old reference from being saved after it changes, even within one space.

A newer analyzer marks old analyses for explicit reprocessing. Immutable originals remain available
for re-embedding; preserved annotations remain useful without their original model. Old automatic
links remain identifiable as automatic until that image is reprocessed or re-matched. There is no
cross-space comparison, automatic clustering, model ensemble or concurrent rollout mechanism.

A future remote adapter can implement the same face capability on another nibrun instance. Routing,
authentication, request ownership, timeouts and byte transfer belong in that adapter and its composition
root configuration. It must preserve the port's ownership and cancellation semantics and validate the
returned model/space descriptor. Context Use continues to own originals, annotations, references,
thresholds and links. Other future capabilities should get their own narrow domain contracts rather
than being forced through the face protocol. Add shared execution infrastructure only when multiple
implementations demonstrate a useful common boundary.

## Building and running

For source development, install CMake 3.24+ and a C++ toolchain, then run:

```sh
bun run dev
```

Development startup automatically builds the analyzer before starting the backend. The first native
build downloads and compiles pinned OpenCV 4.10. Later startups use CMake's incremental build cache.
Full output is saved in `.cache/face-build-host/build.log`, including failures hidden by workspace
output truncation. To run just the build with all output visible, use
`bun --filter @repo/backend --elide-lines=0 build:faces:local`.
`bun run build:local` includes the host analyzer in the standalone app. The normal Linux build uses
Docker to compile a static x86-64 analyzer and embeds it in the Bun binary, so deployment does not
need Python, pip, a compiler or system OpenCV. The Linux native artifact is cached by Docker.
Standalone builds use Bun’s low-memory mode.
The adapter reclaims temporary buffers before inference and releases the child afterward; on Linux it
also asks the kernel to prefer terminating the disposable analyzer under memory pressure.

The first analysis downloads pinned YuNet/SFace INT8 weights (about 10 MB combined) and verifies SHA-256
before loading them. Once cached, inference needs no network connection. Missing or invalid models,
decoding errors and timeouts are recoverable analysis failures; the saved upload still succeeds.
The adapter currently accepts JPEG, PNG and WebP up to 20 MiB and 16 megapixels, bounds detections to
100 faces, limits crops and response sizes, and times out analysis after 90 seconds. Detection handles
rotated faces and returns coordinates relative to the EXIF-oriented image shown by the browser.

Third-party notices are in `third-party/faces` and travel inside the compiled artifact. The native
model integrations are new implementations; face-library was used as a feasibility reference.
