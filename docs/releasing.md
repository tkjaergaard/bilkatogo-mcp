# Releasing

Releases go to npm as `bilkatogo-mcp` through a release PR, using [release-please](https://github.com/googleapis/release-please) in `.github/workflows/release.yml`.

## How a release happens

1. Merge PRs into `main` as usual. Their commit messages follow [Conventional Commits](https://www.conventionalcommits.org), which decide the next version:
   - `fix:` gives a patch release (0.1.0 → 0.1.1).
   - `feat:` gives a minor release (0.1.0 → 0.2.0).
   - `feat!:`, or a `BREAKING CHANGE:` footer, would give a major release. Before 1.0.0 it gives a minor release instead (`bump-minor-pre-major`).
   - `chore:`, `docs:`, `test:`, `ci:` and `refactor:` don't release anything on their own.
2. After each merge, the workflow opens or updates a PR titled `chore(main): release x.y.z`. It bumps the version in `package.json` and `package-lock.json` and adds the changes to `CHANGELOG.md`.
3. Merge that PR when you want to ship. The workflow then tags `vx.y.z`, creates the GitHub release, runs `npm run check` and publishes to npm. `npm publish` runs `prepack`, which builds `dist/`.

Users on `npx -y bilkatogo-mcp@latest` get the release the next time their MCP client starts the server.

The release PR is opened by the workflow's own token, so GitHub doesn't run CI on it. The publish job runs `npm run check` before it publishes instead.

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
5. On [npmjs.com](https://www.npmjs.com/package/bilkatogo-mcp), open the package's **Settings → Trusted publishing**, choose GitHub Actions and enter owner `tkjaergaard`, repository `bilkatogo-mcp` and workflow `release.yml`. Then, under **Publishing access**, choose **Require two-factor authentication and disallow tokens**.
6. Run the Release workflow once by hand (**Actions → Release → Run workflow**), so the next release PR counts from v0.1.0.

## Notes

- npm attaches a provenance statement (a signed record of the commit and workflow that built the release) only when the repo is public. From a private repo, trusted publishing still works, without provenance.
- To release a specific version, add a `Release-As: x.y.z` footer to a commit on `main`.
