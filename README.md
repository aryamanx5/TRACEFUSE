# TRACEFUSE

**Follow the money. Find the signal.** Blockchain forensics + open-source intelligence, in your browser.

## How to run it

Copy each line, paste it into the window and press **Enter**.

- **Windows:** use **PowerShell** (Start menu → type "PowerShell").
- **macOS:** use **Terminal** (Spotlight → type "Terminal").

### 1. Install Python and Node.js (one time only)

**Windows**

```powershell
winget install -e --id Python.Python.3.12; winget install -e --id OpenJS.NodeJS.LTS
```

**macOS** (needs [Homebrew](https://brew.sh))

```bash
brew install python@3.12 node
```

Then **close the window and open a new one**.

No winget or Homebrew? Use the installers from [python.org](https://www.python.org/downloads/) and [nodejs.org](https://nodejs.org/) instead. On Windows, tick "Add Python to PATH".

### 2. Download TRACEFUSE

**Windows**

```powershell
Invoke-WebRequest https://github.com/aryamanx5/TRACEFUSE/archive/refs/heads/main.zip -OutFile tracefuse.zip; Expand-Archive tracefuse.zip -DestinationPath . -Force; cd TRACEFUSE-main
```

**macOS**

```bash
curl -L https://github.com/aryamanx5/TRACEFUSE/archive/refs/heads/main.zip -o tracefuse.zip && unzip -oq tracefuse.zip && cd TRACEFUSE-main
```

### 3. Start it

**Windows**

```powershell
.\run.bat
```

**macOS**

```bash
bash run.sh
```

The first start takes a few minutes. After that it starts in seconds.

### 4. Open it

Leave the first window running. Open a second window and paste:

**Windows**

```powershell
Start-Process http://127.0.0.1:8000
```

**macOS**

```bash
open http://127.0.0.1:8000
```

Then click **Enter the investigation → Historical case → Open case in workspace**.

To stop TRACEFUSE, press **Ctrl + C** in the first window.

### Next time

Open a window in the `TRACEFUSE-main` folder and run step 3 again.

## Problems?

**Port 8000 is busy.** Start on port 9000 instead, then open http://127.0.0.1:9000

```powershell
.\run.bat --port 9000
```

```bash
bash run.sh --port 9000
```

**No or slow internet.** Start in offline mode. The Historical case still works.

```powershell
.\run.bat --offline
```

```bash
bash run.sh --offline
```

**"python" or "npm" not found:** do step 1 again, then close and reopen the window.

---
## Deploy it online

One container serves both the web UI and the API, so there is a single thing to deploy.

```bash
docker build -t tracefuse .
docker run -p 8000:8000 -v tracefuse_data:/data tracefuse
```

For Fly.io, `fly.toml` is included (it needs a 1 GB volume named `tracefuse_data`). Keep exactly **one** instance: job state is in memory and SQLite is single-writer. There is no login, so a public instance with real API keys lets anyone spend your provider quotas. Deploy without keys, or add `TRACEFUSE_OFFLINE=1`, for a safe public demo.

---
Developers: features, tests and data are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
