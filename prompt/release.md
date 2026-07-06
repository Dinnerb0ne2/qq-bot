# Release prompt

Cut a new release of qq-bot. Follow this exactly.

## How releases work (context)

A release is driven entirely by pushing a `vX.Y.Z` git tag. qq-bot is a deployable
service (`package.json` is `"private": true` — nothing is published to npm), so the
**Docker image is the release artifact**. The **git tag is the single source of truth**
for the version: the image tags and the GitHub Release are derived from it, and
`package.json`'s `version` is *not* read by the pipeline.

One GitHub Actions workflow — `.github/workflows/release.yml` — runs three jobs in
sequence, each gated on the previous via `needs:` so a failure stops the chain:

- **typecheck** (`tsc --noEmit`) — never build or release a tree that doesn't compile.
  It is the only correctness gate (there is no test suite or linter).
- **docker** (`needs: typecheck`) — build a `linux/amd64` image and push it to
  `ghcr.io/isomoes/qq-bot`, tagged `X.Y.Z`, `X.Y`, and `latest`. A prerelease tag
  (`v1.0.0-rc1`, `-beta`, …) skips `latest`.
- **release** (`needs: docker`) — extract the `## X.Y.Z` block from `CHANGELOG.md` and cut
  a GitHub Release with it as the body (falling back to auto-generated notes if that
  section — or the file — is absent). Because it `needs: docker`, a failed build never
  leaves a Release for a version that has no image.

No secrets are needed: both the ghcr push and the Release authenticate with the built-in
`GITHUB_TOKEN`. So the agent's job is only: write the changelog section, commit, tag, push.

> Requires **Node 22** and **pnpm** (pinned to `pnpm@11.3.0` via `package.json`'s
> `packageManager` field — run it through corepack) locally to gate the typecheck.

## Steps

Let `X.Y.Z` be the new version (decide the bump from the commits: feat → minor,
fix/chore/docs → patch).

1. **Find the baseline.** The last release is the top `## a.b.c` heading in `CHANGELOG.md`.
   List commits since it:
   ```
   git log <last-version-hash>..HEAD --pretty=format:'%h %an %s'
   ```
   (The bottom entry of each changelog section carries its commit hash — use it as the
   range start.)
   _First release / no `CHANGELOG.md` yet:_ create the file and list the full history
   (`git log --pretty=format:'%h %an %s'`).

2. **Add a `## X.Y.Z` section to `CHANGELOG.md`** directly above the previous version
   section (create the file if it doesn't exist yet). Format per line:
   `- <type>: <commit message> (@who) <hash>`, newest commit first. `<type>` is the
   conventional-commit prefix of the commit (`feat` · `fix` · `docs` · `chore` · `ci` ·
   `refactor` · `perf` · `test` · `build`); qq-bot commits are plain (no emoji), so use the
   prefix as-is. Skip purely-mechanical commits if noise (use judgement).

3. **(Optional) Bump `package.json`'s `version`** to `X.Y.Z` for tree hygiene:
   ```
   npm pkg set version="X.Y.Z"
   ```
   The pipeline does **not** read this field (the tag is authoritative and CI does not
   re-stamp it), so it is cosmetic — but keeping it in sync with the latest tag avoids
   confusion.

4. **Gate on typecheck** (the docker job will fail otherwise, but failing locally is faster
   and clearer):
   ```
   pnpm install --frozen-lockfile   # if deps aren't installed
   pnpm typecheck
   ```

5. **Commit** the changelog (and version bump) together:
   ```
   git add -A
   git commit -m "chore: release X.Y.Z"
   ```

6. **Tag** (annotated) and **push** the commit then the tag:
   ```
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```
   Push `main` before the tag so the tagged commit's history is on the branch.

7. **Confirm** the workflow ran and all three jobs passed:
   ```
   gh run list --limit 5
   ```
   Optionally `gh run watch <id>`. Then sanity-check the artifacts:
   ```
   gh release view vX.Y.Z
   docker pull ghcr.io/isomoes/qq-bot:X.Y.Z   # confirms the image is pullable
   ```
   Common failures: typecheck errors, or the `## X.Y.Z` changelog section
   missing/misnamed (the Release then uses auto-generated notes — a warning, not a hard
   failure).

## First release (v0.1.0)

The `## 0.1.0` section and `package.json` version are already staged in-repo but no tag
exists yet, so the first release collapses to: make sure `main` is pushed, then tag and
push `v0.1.0` (steps 6–7). No new changelog section is needed.

## If a release needs to be re-cut (build failed after tag push)

Because the `release` job `needs: docker`, a failed **typecheck** or **docker** build
leaves only the tag — no image on ghcr and no GitHub Release
(`gh release view vX.Y.Z` will 404; check the run with `gh run list`). Recovery options:

- **Easiest — bump to the next patch** and release again; a skipped version number is fine.
- **Reuse the same version** — fix the cause, then move the tag onto the fix. The workflow
  is idempotent (re-running for an existing tag refreshes the Release rather than failing),
  so re-pushing the moved tag re-runs the whole chain cleanly:
  ```
  git commit ...                                       # the fix
  git push origin :vX.Y.Z && git tag -d vX.Y.Z         # drop remote + local tag
  git tag -a vX.Y.Z -m vX.Y.Z                          # re-tag on the fixed commit
  git push origin main && git push origin vX.Y.Z       # re-triggers typecheck → docker → release
  ```

## Notes

- **No npm publish, no secrets.** Unlike a library, qq-bot ships as a container. The ghcr
  push and the Release both use the built-in `GITHUB_TOKEN` — there is nothing to configure
  (no `NPM_TOKEN`, no OIDC trusted publishing).
- **ghcr visibility.** The pushed package inherits the repo's visibility. To allow anonymous
  `docker pull ghcr.io/isomoes/qq-bot`, make the package public once: repo → Packages → the
  `qq-bot` package → Package settings → Change visibility.
- **`latest` and prereleases.** `docker/metadata-action` tags `latest` only for the highest
  non-prerelease semver, so `v1.0.0-rc1` / `-beta` intentionally do not move `latest`.
- **Changelog section naming is exact.** The `release` job greps for a literal `## X.Y.Z`
  heading (the `v` stripped from the tag). A mismatch silently falls back to auto-generated
  notes — verify the heading matches the tag.
- **Image contents.** The multi-stage `Dockerfile` ships only Node, the two runtime deps
  (`dotenv`, `qq-official-bot`), and compiled `dist/` — the TypeScript toolchain stays in the
  builder. The build runs `pnpm build` (`tsc`), so the image also fails on type errors; CI
  gates explicitly first for a faster, clearer signal.
- Provenance/SBOM attestation is disabled in the build so the package's architecture list
  stays clean (a single `amd64` entry, no `unknown/unknown` entries).
