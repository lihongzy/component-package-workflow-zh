# wucaishi-generative-react-skill

Codex skill for Wucaishi component package workflow, HTML-to-React component generation, build version confirmation, and Aliyun OSS upload.

## Install

Run with npx:

```bash
npx wucaishi-generative-react-skill@latest
```

The installer copies this skill into:

```text
~/.codex/skills/component-package-workflow-zh
```

If `CODEX_HOME` is set, it installs into:

```text
$CODEX_HOME/skills/component-package-workflow-zh
```

## Included Skills

- `component-package-workflow-zh`
- `react-component-spec-zh`
- `html-template-to-react-components-zh`
- `build-version-confirm-zh`
- `upload-aliyun-oss-zh`

## Installer Options

```bash
npx wucaishi-generative-react-skill@latest -- --help
npx wucaishi-generative-react-skill@latest -- --target /path/to/skills/component-package-workflow-zh
npx wucaishi-generative-react-skill@latest -- --no-backup
```

By default, if a target skill already exists, the installer creates a timestamped backup next to it before replacing it.

## Publish

```bash
npm login
npm pack --dry-run
npm publish
```

Before publishing, inspect the package contents and make sure no local credentials, tokens, or machine-specific files are included.
