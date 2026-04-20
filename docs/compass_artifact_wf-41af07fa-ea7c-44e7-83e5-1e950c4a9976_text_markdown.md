# Ship your node_modules: Azure Functions Node.js deployment decoded

**Pre-building node_modules in CI and including them in the zip is the officially recommended approach** for deploying Azure Functions v4 Node.js on Windows Consumption Plan via GitHub Actions. Azure-side npm install (remote build) is an alternative but is architecturally incompatible with `WEBSITE_RUN_FROM_PACKAGE=1` — and this exact settings conflict is the root cause of both your failed experiments. Microsoft's own GitHub Actions template runs `npm install` in the workflow and deploys the full directory with dependencies included. Your manual zip with node_modules isn't a workaround; it's the correct pattern.

---

## Why both experiments failed: a settings conflict silently kills builds

Your two failed approaches share one root cause: **`WEBSITE_RUN_FROM_PACKAGE=1` and `SCM_DO_BUILD_DURING_DEPLOYMENT=true` are mutually exclusive**, and Microsoft explicitly documents this. When `WEBSITE_RUN_FROM_PACKAGE=1` is set, the zip is mounted to wwwroot as a **read-only filesystem**. Any remote build step (Kudu or Oryx running `npm install`) physically cannot write `node_modules/` to a read-only mount. The build step is **silently ignored** — no error, no warning in the deployment logs, just a broken app.

Microsoft's exact words: *"Run From Package (WEBSITE_RUN_FROM_PACKAGE=1) is incompatible with deployment customization option (SCM_DO_BUILD_DURING_DEPLOYMENT=true), the build step will be ignored during deployment."*

**Experiment 1 failure** (functions-action → 0 functions, all 404s): `Azure/functions-action@v1.5.2` does not respect `.gitignore` — but it doesn't need to. Since `actions/checkout` only retrieves tracked files from your repo, `node_modules/` simply doesn't exist in the working directory. The action zips whatever is present, which is your 770KB source-only code. Without `@azure/functions` in `node_modules`, the v4 programming model cannot register any functions. The action defaults both `scm-do-build-during-deployment` and `enable-oryx-build` to **false**, so no remote build occurs either. Result: a deployed zip with zero loadable functions.

**Experiment 2 failure** (remote build → 503): Even after removing `WEBSITE_RUN_FROM_PACKAGE` and setting `SCM_DO_BUILD_DURING_DEPLOYMENT=true` with `ENABLE_ORYX_BUILD=true`, the 503 persists because **`ENABLE_ORYX_BUILD` is a Linux-only setting**. On Windows Consumption, Oryx doesn't exist — Kudu handles builds natively. If there was a residual `WEBSITE_RUN_FROM_PACKAGE` value cached or set by a previous deployment tool, the build would be silently skipped. Additionally, the `--build-remote` flag is designed for `func azure functionapp publish`, not for the GitHub Action's deployment API. The combination of misconfigured settings and Windows-incompatible Oryx flags produced a deployed app missing all dependencies.

---

## The official Microsoft template already includes node_modules

Microsoft's own GitHub Actions workflow template for Node.js Azure Functions, published at `learn.microsoft.com/en-us/azure/azure-functions/functions-how-to-github-actions`, runs `npm install` in the CI workflow and deploys the entire directory — including the resulting `node_modules` folder — via `Azure/functions-action@v1`. No remote build flags are set. The template:

```yaml
- name: 'Resolve Project Dependencies Using Npm'
  shell: pwsh
  run: |
    pushd './${{ env.AZURE_FUNCTIONAPP_PACKAGE_PATH }}'
    npm install
    npm run build --if-present
    npm run test --if-present
    popd

- name: 'Run Azure Functions Action'
  uses: Azure/functions-action@v1
  with:
    app-name: ${{ env.AZURE_FUNCTIONAPP_NAME }}
    package: ${{ env.AZURE_FUNCTIONAPP_PACKAGE_PATH }}
    publish-profile: ${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}
```

This confirms that **shipping node_modules is the documented, intended pattern** — not an anti-pattern. Microsoft's best practices documentation reinforces this: *"Run your functions as a package file when possible. Reduces cold-start times, particularly for JavaScript functions with large npm package trees."* The `WEBSITE_RUN_FROM_PACKAGE=1` setting is "highly recommended" for Windows Consumption specifically because it mounts a pre-built package for fastest cold starts.

---

## The correct settings matrix for every scenario

The right configuration depends entirely on whether you build in CI or on the server. You must pick one — never both.

**For Windows Consumption with CI-built zip (recommended):**

| Setting | Value |
|---|---|
| `WEBSITE_RUN_FROM_PACKAGE` | `1` |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | Not set or `false` |
| `ENABLE_ORYX_BUILD` | Not set (irrelevant on Windows) |
| `FUNCTIONS_WORKER_RUNTIME` | `node` |
| `WEBSITE_NODE_DEFAULT_VERSION` | `~20` or `~22` |

**For Windows Consumption with remote build (alternative, not recommended):**

| Setting | Value |
|---|---|
| `WEBSITE_RUN_FROM_PACKAGE` | **Must be removed entirely** |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` |
| `ENABLE_ORYX_BUILD` | Not set (this is Linux-only) |

**For Linux Premium/Dedicated with remote build:**

| Setting | Value |
|---|---|
| `WEBSITE_RUN_FROM_PACKAGE` | **Must be removed entirely** |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` |
| `ENABLE_ORYX_BUILD` | `true` |

The **known broken combination** — `WEBSITE_RUN_FROM_PACKAGE=1` plus `SCM_DO_BUILD_DURING_DEPLOYMENT=true` on any platform — produces silent build skipping, missing dependencies, and 503 errors. This is exactly what happened in your experiments.

---

## A production-ready GitHub Actions workflow for your setup

For your specific scenario (92 functions, 61MB with node_modules, Windows Consumption Y1), here is the confirmed working pattern that addresses the `actions/upload-artifact` timeout issue with large `node_modules` directories, based on Elio Struyf's (Microsoft MVP) confirmed fix from September 2024:

```yaml
name: Deploy Azure Functions
on:
  push:
    branches: [main]

env:
  AZURE_FUNCTIONAPP_NAME: 'your-function-app'
  AZURE_FUNCTIONAPP_PACKAGE_PATH: '.'
  NODE_VERSION: '20.x'

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
      - name: Install and build
        shell: pwsh
        run: |
          pushd './${{ env.AZURE_FUNCTIONAPP_PACKAGE_PATH }}'
          npm ci
          npm run build --if-present
          popd
      - name: Upload artifact excluding node_modules
        uses: actions/upload-artifact@v4
        with:
          name: node-app
          path: |
            .
            !./node_modules
            !./.git

  deploy:
    runs-on: windows-latest
    needs: build
    steps:
      - name: Download artifact
        uses: actions/download-artifact@v4
        with:
          name: node-app
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
      - name: Install production dependencies only
        run: npm i --omit=dev
      - name: Deploy to Azure Functions
        uses: Azure/functions-action@v1
        with:
          app-name: ${{ env.AZURE_FUNCTIONAPP_NAME }}
          package: ${{ env.AZURE_FUNCTIONAPP_PACKAGE_PATH }}
          publish-profile: ${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}
```

An even simpler single-job alternative avoids the artifact upload problem entirely:

```yaml
jobs:
  deploy:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install, build, prune
        run: |
          npm ci
          npm run build --if-present
          npm prune --production
      - name: Deploy to Azure Functions
        uses: Azure/functions-action@v1
        with:
          app-name: ${{ env.AZURE_FUNCTIONAPP_NAME }}
          package: '.'
          publish-profile: ${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}
```

The key technique is `npm prune --production`, which strips dev dependencies after build, reducing the deployed node_modules to only production dependencies. **Use `windows-latest` runner** to match the target OS — building on `ubuntu-latest` and deploying to Windows can break native `.node` modules (confirmed failure mode documented in September 2025).

---

## Would switching to Linux fix remote build? Yes, but with caveats

Switching to Linux Consumption Plan would make Oryx remote build work more reliably — Oryx is purpose-built for Linux and is the primary, well-tested path for server-side builds. Core Tools and VS Code automatically configure `ENABLE_ORYX_BUILD=true` and `SCM_DO_BUILD_DURING_DEPLOYMENT=true` when deploying to Linux. However, three significant caveats apply:

- **Linux Consumption is being deprecated.** After September 30, 2025, no new features or language stack support. Full retirement by September 30, 2028. Microsoft recommends migrating to **Flex Consumption Plan**.
- **`WEBSITE_RUN_FROM_PACKAGE=1` is not supported** on Linux Consumption — only `=<blob_URL>` works. This changes your deployment pipeline.
- **Remote builds have a 1.5 GB memory limit** on the build container, and multiple community reports document intermittent 503 errors during Linux Consumption deployments.

The pre-built zip pattern works identically on both Windows and Linux (Premium/Dedicated) and sidesteps all remote build issues entirely. Given that Linux Consumption is sunsetting, there's little reason to switch platforms just to enable remote build when the CI-built approach is more reliable.

---

## Conclusion

Your `az functionapp deployment source config-zip` with a 61MB pre-built zip is not a workaround — it's the canonical deployment pattern Microsoft documents and recommends. The failures you experienced trace directly to **`WEBSITE_RUN_FROM_PACKAGE=1` silently blocking remote builds** and **the GitHub Action deploying a zip without node_modules** when no `npm install` step exists in the workflow.

For your 92-function app on Windows Consumption Y1, the proven path is: run `npm ci` → `npm run build` → `npm prune --production` in GitHub Actions on a `windows-latest` runner, then deploy via `Azure/functions-action@v1` with `WEBSITE_RUN_FROM_PACKAGE=1` and both build flags left at their defaults (false). The 61MB package size is well within normal range — Microsoft explicitly optimizes for this pattern with reduced cold starts from package mounting. No platform switch or remote build configuration is needed.