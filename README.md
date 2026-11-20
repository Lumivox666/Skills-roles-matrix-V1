# TCG Machines — Skills & Roles Matrix (Railway edition v1.3)

**Flat-root GitHub package** of the actual branded Skills & Roles Matrix, not a static picture. It includes the original TCG Machines logo and **137 BOM-derived candidate skills** from INASS, SA, SSA, CAB, and MA, organized into Scanner / Conveyor / Chassis, plus **14 editable role groups**. Skills, role assignments, verified-independent gold stars, training requests, SOP statuses, Required SOPs, and full-screen TV mode are retained.

The app is a **single Node.js process with no external npm dependencies** and a file-based shared JSON store. It requires **one Railway service, one attached volume, and one replica**. Do not deploy multiple replicas with a single JSON file.

## Deploy to Railway from GitHub

1. Create a **private GitHub repository** and upload all the files in this ZIP directly to the **repository root** (not inside an extra folder). Do not upload `data/` or your live `tcg_matrix_data.json` file.
2. In Railway, create a project / service from that GitHub repository. Railway detects the root `package.json` and executes `npm start` (equivalent to `node server.js`). No build step, `npm install`, or Dockerfile is required.
3. **Attach a Railway volume** to the same service. Set the mount path to **`/app/data`**. Other absolute mount paths also work: the server uses Railway's automatic `RAILWAY_VOLUME_MOUNT_PATH` variable. **Attach the volume before the first start.** The app intentionally refuses to run on Railway without a volume so qualifications cannot be silently lost on redeploy. The data is seeded into the volume *at runtime* on first launch.
4. Set Railway **Service → Variables → `APP_PASSWORD`** to a strong private password of **at least 12 characters**. Don't add a password to a file or GitHub. This gives the pilot a shared login page. Recommended: set **`SESSION_SECRET`** to another long random value so sign-ins survive restarts. Railway automatically sets `PORT` and `RAILWAY_VOLUME_MOUNT_PATH` for you; **do not hardcode either**.
5. In Railway service settings, set **Healthcheck Path** to **`/api/health`**. The server reports healthy only if its storage directory is accessible.
6. Generate a public domain under **Railway → Service → Settings → Networking → Public Networking / Generate Domain**. Visit it over HTTPS and sign in using `APP_PASSWORD`.
7. Use `https://YOUR-DOMAIN/#tv` for the **full-screen TV dashboard**. After signing in on that TV browser once, it can load TV mode. The session lasts up to seven days; sign in again if it expires.

**Important:** Railway's older `railway.toml` config-as-code format is being deprecated; this package doesn't depend on it. Configuration is handled by the standard Node `package.json` and the Railway settings noted above.

## Where your data goes

- The server looks for `RAILWAY_VOLUME_MOUNT_PATH` first. For a volume mounted at `/app/data`, the primary file is **`/app/data/tcg_matrix_data.json`**.
- A **new/empty volume** initializes from the packaged `tcg_matrix_seed.json`. An **existing volume** is read as-is. An invalid existing file causes a startup error instead of a silent reset.
- Saves use a temporary file and atomic rename on the same volume. Each save also creates `tcg_matrix_previous.json` (most recent pre-change version).
- The first edit of each UTC day creates a dated pre-change snapshot under `/app/data/backups/`. The latest **14 daily snapshots** are retained.
- A current-state JSON download is available from the signed-in browser at **`/api/backup`**. Export a backup before major edits or deployments. Railway volume backups are also recommended.
- The repository's seed data will **not overwrite your stored volume data** on later GitHub commits or Railway redeploys. Changes to packaged seed JSON do *not* automatically migrate existing live data.

## Local testing

Node.js 20+ is needed. Extract all files together. On Windows, run `START_LOCAL_WINDOWS.bat`; on Mac/Linux, run `bash START_LOCAL_MAC_LINUX.sh`. The launcher asks for a local access password. Or use a terminal:

```sh
# macOS / Linux
export APP_PASSWORD='your-private-test-password'
node server.js
```

```powershell
# PowerShell
$env:APP_PASSWORD='your-private-test-password'
node server.js
```

Open `http://localhost:3000`. The local data is stored in a generated `data/` folder, which is ignored by Git. With a password, the server binds to your LAN so other devices on the same private Wi-Fi can connect using the host PC's LAN IP address. Without a password it binds only to `127.0.0.1`. Set `DATA_DIR=/some/absolute/folder` to test saving to another path. You can also provide `PORT=3001` for a different port.

The server must stay running for the app to be available.

## About sign-offs and SOPs

- A **gold star** means the person has been **signed off as fully capable of performing that skill independently**, not merely attended training.
- No real employee qualifications are pre-awarded in the seeded app.
- SOP statuses start **Not checked** until a manager confirms whether a usable SOP exists. A status of **Missing** makes the skill appear in the Required SOPs list.
- BOM items are **proposed competencies**, not automatically approved work instructions, and module-specific items should be reviewed by the team.
- Roles and responsibilities are editable; the app flags unqualified assignments rather than blocking them.

## Security and production limits

This is suitable for a **controlled pilot**, not a full enterprise authentication system. The single shared password has no per-user permissions or non-repudiable individual sign-off identity. Do not upload private employee reviews or sensitive HR material. Use only HTTPS through Railway. There is basic login rate limiting and a seven-day signed, HTTP-only cookie. Use one instance / one replica; this JSON store is not designed for horizontal scaling or concurrent database migrations. Treat the Railway volume as your source of truth and keep backups. For broader company-wide use, add individual accounts/permissions and a database first.

## Troubleshooting

- **Deploy fails with 'Volume NOT attached'**: attach the volume to this service and set mount path `/app/data`.
- **Deploy fails with 'APP_PASSWORD is required'**: set `APP_PASSWORD` in the service's variables and redeploy.
- **502 / no response**: inspect Railway deployment logs. The server listens on Railway's injected `PORT` and binds to `0.0.0.0` when `APP_PASSWORD` is set.
- **Healthcheck fails**: set `/api/health`, check the volume mount and write permissions.
- **After redeploy, it looks like the seed again**: check that the same persistent volume remains attached to the *same service*, and check its mount path. Do not delete the volume.
- **Unable to save**: check service logs, available volume space, and if someone else edited concurrently. The app uses revisions to avoid overwriting another person's changes; use the JSON backup and reload when prompted.
- **Sign out**: use the small Sign out link in the app or visit `/logout`.

### Flat repository structure

All files in this archive are at the **root**: `index.html`, `server.js`, `package.json`, `README.md`, `.gitignore`, the TCG logo/icon, the seed JSON, BOM reference CSVs, and optional local starter scripts. The **only folders created at runtime** are the persistent data directory and its backups, neither of which belongs in GitHub.
