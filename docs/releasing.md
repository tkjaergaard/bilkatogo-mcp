# Releasing

Releases go to npm as `bilkatogo-mcp` through a release PR, using [release-please](https://github.com/googleapis/release-please) in `.github/workflows/release.yml`.

## How a release happens

1. Merge PRs into `main`. The repo only allows squash merges, and the squash commit takes the PR title, so each PR becomes one commit and one changelog line. PR titles follow [Conventional Commits](https://www.conventionalcommits.org), which decide the next version:
   - `fix:` gives a patch release (0.1.0 → 0.1.1).
   - `feat:` gives a minor release (0.1.0 → 0.2.0).
   - `feat!:`, or a `BREAKING CHANGE:` footer, would give a major release. Before 1.0.0 it gives a minor release instead (`bump-minor-pre-major`).
   - `chore:`, `docs:`, `test:`, `ci:` and `refactor:` don't release anything on their own.
2. After each merge, the workflow opens or updates a PR titled `chore(main): release x.y.z`. It bumps the version in `package.json` and `package-lock.json` and adds the changes to `CHANGELOG.md`.
3. Merge that PR when you want to ship. GitHub may first ask you to approve its CI run, because a bot opened it, and `main` requires the `check` job to pass. The workflow then tags `vx.y.z`, creates the GitHub release and stages the package on npm in two jobs:
   - **build** installs the dependencies, runs `npm run check` and `npm pack` (whose `prepack` builds `dist/`). It has no right to publish.
   - **publish** gets only the packed tarball and runs `npm stage publish` on it. It installs nothing, so no dependency's install script runs where the publish token exists.
4. Approve the staged release with your passkey: on npmjs.com under **Staged Packages**, or with `npm stage list` and `npm stage approve <id>`. Only then does it reach npm. The trusted publisher is only allowed to stage, so a compromised workflow can't publish on its own.

Users on `npx -y bilkatogo-mcp@latest` get the release the next time their MCP client starts the server.

The build job runs `npm run check` again on the release commit before anything is staged.

## One-time setup

npm's trusted publishing lets the workflow publish without an npm token. It can only be set up for a package that already exists on npm, so the first release is published by hand.

1. In the GitHub repo, open **Settings → Actions → General** and turn on **Allow GitHub Actions to create and approve pull requests**. release-please needs it to open the release PR.
2. Merge the PR that adds the release workflow. The workflow may open a release PR straight away, listing the whole history; close it.
3. Publish 0.1.0 by hand from an up-to-date `main`, with two-factor authentication on your npm account:
   ```sh
   git switch main && git pull
   npm login
   npm publish
   ```
4. Mark that commit as the 0.1.0 release, so release-please counts from it:
   ```sh
   gh release create v0.1.0 --target "$(git rev-parse HEAD)" --title v0.1.0 --notes "First release on npm."
   ```
5. On [npmjs.com](https://www.npmjs.com/package/bilkatogo-mcp), open the package's **Settings → Trusted publishing**, choose GitHub Actions and enter owner `tkjaergaard`, repository `bilkatogo-mcp` and workflow `release.yml`, with no environment. Under **Allowed actions**, leave both "Allow npm publish" and "Allow npm dist-tag" unticked, so the workflow can only stage. Then, under **Publishing access**, choose **Require two-factor authentication and disallow bypass 2fa tokens**. npm validates the connection on the first staged release; it has to happen within two days of setting it up.
6. Run the Release workflow once by hand (**Actions → Release → Run workflow**), so the next release PR counts from v0.1.0.
7. Protect `main` with a ruleset (**Settings → Rules → Rulesets**): require a pull request and the `check` status check, and block force pushes and deletion. Then nothing, not even a workflow, reaches `main` without a PR.

## Notes

- Every action in the release workflow is pinned to a commit, so a moved tag can't change what runs. To update one, look up the new release's commit and update the SHA and its version comment.

- Each release staged by the workflow carries a provenance statement: a signed record, in the public Sigstore transparency log, of the commit and workflow that built it.
- To release a specific version, add a `Release-As: x.y.z` footer to a commit on `main`.
