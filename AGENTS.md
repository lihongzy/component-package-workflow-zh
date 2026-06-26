# Agent Notes

This repository publishes the Codex skill npm package `wucaishi-generative-react-skill`.

## Package Purpose

The npm package is a CLI installer. It does not publish a React component. It installs the skill files into the user's Codex skills directory:

```text
~/.codex/skills/component-package-workflow-zh
```

The package entrypoint is:

```text
bin/install.mjs
```

## Publish By Tag

Publishing is handled by GitHub Actions.

When the user asks to package, bump version, release, publish, or tag a release, the agent must handle version alignment automatically. Do not ask the user to manually make `package.json.version` and the git tag match.

When preparing a release:

1. Update `package.json.version`.
2. Commit the change.
3. Push the commit.
4. Create and push a matching tag.

Example:

```bash
npm version patch
git push
git push origin v0.1.1
```

The tag must match `package.json.version`. For example, tag `v0.1.1` requires:

```json
{
  "version": "0.1.1"
}
```

Agent release rules:

- If the user asks for a patch/minor/major release, run the matching version bump command or edit `package.json.version` accordingly.
- If the user only says "打包", "升级版本", "发版", "发布", or "打 tag", choose a conservative patch bump unless they specify another version.
- After changing `package.json.version`, use the resulting version to create the git tag in the exact format `v{version}`.
- Before creating or pushing a tag, verify `package.json.version` and the intended tag match exactly.
- If a matching tag already exists locally or remotely, do not reuse it. Bump to a new version or ask the user which new version to use.
- Never tell the user to manually align `package.json.version` and the tag. The agent should make or propose the concrete version change and tag.
- npm versions are immutable. Do not attempt to republish the same version after a successful publish.

The publish workflow is:

```text
.github/workflows/npm-publish.yml
```

It runs on `v*` tag pushes, checks syntax, previews package contents with `npm pack --dry-run`, and publishes with `npm publish`.

The publish workflow is idempotent for already-published versions. Before publishing, it checks whether `package@version` already exists on npm. If it exists, the workflow skips syntax check, package preview, and publish, then exits successfully. This prevents a later push of an already published tag, such as `v1.0.0`, from failing only because npm versions are immutable.

Required GitHub secret:

```text
NPM_TOKEN
```

The token must have permission to publish this npm package. If npm requires publishing 2FA, use a granular token that can publish this package and bypass 2FA.

## Revoke By Deleting Tag

Deleting a git tag is treated as a request to revoke the matching npm version.

Example:

```bash
git push origin :refs/tags/v0.1.1
```

The revoke workflow is:

```text
.github/workflows/npm-revoke-on-tag-delete.yml
```

It runs on deleted `v*` tags and derives the npm version from the deleted tag.

Important npm constraints:

- Deleting a git tag does not automatically remove a package from npm unless the revoke workflow runs successfully.
- npm package versions are immutable. Once `package@version` has been published, that exact version cannot be reused, even after unpublish.
- `npm unpublish package@version` only works when the package/version satisfies npm's unpublish policy.
- If unpublish fails, the workflow falls back to `npm deprecate package@version "message"` so users see a warning.
- After unpublish or deprecate, the workflow tries to move the `latest` dist-tag to the highest remaining package version, so `npx package@latest` does not keep resolving to the revoked version when another version exists.

Do not tell users that deleting a tag always guarantees complete npm removal. Say: "Deleting the tag triggers the revoke workflow; it will unpublish if npm policy allows it, otherwise it will deprecate that version and try to move latest to the previous available version."

Required GitHub secret for revoke:

```text
NPM_TOKEN
```

The token must have permission to unpublish or deprecate this package.

## Local Publish Commands

Manual publish:

```bash
npm pack --dry-run
npm publish
```

Manual publish with OTP:

```bash
npm publish --otp=123456
```

Manual revoke:

```bash
npm unpublish wucaishi-generative-react-skill@0.1.1
```

Manual deprecate fallback:

```bash
npm deprecate wucaishi-generative-react-skill@0.1.1 "This version was revoked by deleting its release tag."
```

## Safety Rules For Agents

- Never commit `.npmrc` with a real token.
- Never print npm tokens in final responses.
- Keep `.npmrc` ignored by git and npm packaging.
- Before publishing, run `npm pack --dry-run` and inspect package contents.
- Do not publish the same version twice; bump `package.json.version` before every new npm release.
- Do not use destructive git commands to fix tag or release issues unless the user explicitly asks.
