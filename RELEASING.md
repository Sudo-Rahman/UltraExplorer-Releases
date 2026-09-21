# Publishing an Ultra Explorer release

The release pipeline runs entirely in this public repository. Creating the private source tag does
not consume GitHub Actions minutes by itself; a maintainer starts the public workflow manually.

1. Confirm that `package.json`, `Cargo.toml`, and `apps/desktop/src-tauri/tauri.conf.json` on the
   private `main` branch all contain the release version.
2. Create and push an annotated version tag in the private repository:

   ```bash
   git switch main
   git pull --ff-only
   git tag -a v0.1.0 -m "Ultra Explorer 0.1.0"
   git push origin v0.1.0
   ```

3. Open **Actions → Publish release → Run workflow** in `UltraExplorer-Releases`.
4. Enter the private tag, such as `v0.1.0`, and choose whether it is a prerelease.

The public workflow checks out that exact private tag, verifies that its commit belongs to private
`main`, validates all canonical version files, and runs the complete CI. Only after every check and
platform build succeeds does it publish the container image and create the matching public tag and
GitHub Release.
