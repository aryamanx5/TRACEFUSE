# TRACEFUSE

**Follow the money. Find the signal.** Blockchain forensics + open-source intelligence, in your browser.

## How to run it

**1. Install these two (one time only)**

- **Python 3.11 or newer**: [python.org/downloads](https://www.python.org/downloads/). On Windows, tick **"Add Python to PATH"** during install.
- **Node.js (LTS)**: [nodejs.org](https://nodejs.org/)

**2. Download TRACEFUSE**

On GitHub, click **Code → Download ZIP**, then unzip it.

**3. Start it**

- **Windows:** open the unzipped folder and double-click **`run.bat`**.
- **macOS:** open **Terminal**, type `cd ` (with a space), drag the unzipped folder into the window, press Enter, then run:

  ```bash
  bash run.sh
  ```

The first start takes a few minutes. After that it starts in seconds.

**4. Open it**

Go to **http://127.0.0.1:8000** in your browser.
Try **Enter the investigation → Historical case → Open case in workspace**.

To stop it, press **Ctrl + C** in the window, or close the window.

## Problems?

- **"Python/npm not found"**: install step 1, then close and reopen the window.
- **Port 8000 is busy**: Windows `run.bat --port 9000`, macOS `bash run.sh --port 9000`, then open http://127.0.0.1:9000
- **No or slow internet**: add `--offline`. The Historical case still works.

---
Developers: features, tests and data are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
