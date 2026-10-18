"""Records docs/media/card-view-demo.gif from a real Obsidian window.

Why not `Page.captureScreenshot`: Obsidian 1.14 keeps the last painted surface when its window is
not the foreground window, so CDP screenshots (and Windows `PrintWindow`) return the same frozen
image over and over. The window has to be visible on screen for the frames to move; this script
therefore refuses to write a GIF whose frames do not change, instead of shipping a still.

Usage
-----
1. Start Obsidian with remote debugging on the test vault, window in front:

       "C:\\Program Files\\Obsidian\\Obsidian.exe" --remote-debugging-port=9223 ^
           --user-data-dir="%TEMP%\\obsidian-capture" "D:\\...\\test-vault"

2. Run this script; it drives the card view over CDP and captures the window with PrintWindow:

       python scripts/capture-side-panel-gif.py

3. It writes docs/media/card-view-demo.gif and prints the frame-difference statistics.
   A `max RMS < 1` means the window was not painting: bring Obsidian to the front and re-run.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

PORT = 9223
TITLE_HINT = "test-vault"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "media", "card-view-demo.gif")

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32


# --- CDP ---------------------------------------------------------------------------------------

def page_target() -> dict:
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=5) as response:
        targets = json.load(response)
    pages = [t for t in targets if t["type"] == "page" and "obsidian.md" in t.get("url", "")]
    if not pages:
        sys.exit(f"no Obsidian page on port {PORT} — see the usage note at the top of this file")
    return pages[0]


class Cdp:
    def __init__(self) -> None:
        import websocket  # websocket-client

        self.id = 0
        self.ws = websocket.create_connection(page_target()["webSocketDebuggerUrl"],
                                              timeout=60, suppress_origin=True)

    def call(self, method: str, **params):
        self.id += 1
        self.ws.send(json.dumps({"id": self.id, "method": method, "params": params}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == self.id:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message.get("result", {})

    def ev(self, expression: str):
        result = self.call("Runtime.evaluate", expression=expression, returnByValue=True,
                           awaitPromise=True, userGesture=True)
        if result.get("exceptionDetails"):
            raise RuntimeError(json.dumps(result["exceptionDetails"])[:400])
        return result["result"].get("value")


# --- window capture ----------------------------------------------------------------------------

class BitmapInfoHeader(ctypes.Structure):
    _fields_ = [("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG),
                ("biPlanes", wt.WORD), ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
                ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", wt.LONG),
                ("biYPelsPerMeter", wt.LONG), ("biClrUsed", wt.DWORD),
                ("biClrImportant", wt.DWORD)]


def find_window() -> int:
    found: list[int] = []
    enum_proc = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)

    def visit(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            length = user32.GetWindowTextLengthW(hwnd)
            buffer = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buffer, length + 1)
            if TITLE_HINT in buffer.value and "Obsidian" in buffer.value:
                found.append(hwnd)
        return True

    user32.EnumWindows(enum_proc(visit), 0)
    if not found:
        sys.exit("Obsidian window not found — is it open on the test vault?")
    return found[0]


def grab(hwnd: int):
    from PIL import Image

    rect = wt.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    width, height = rect.right - rect.left, rect.bottom - rect.top
    window_dc = user32.GetWindowDC(hwnd)
    memory_dc = gdi32.CreateCompatibleDC(window_dc)
    bitmap = gdi32.CreateCompatibleBitmap(window_dc, width, height)
    gdi32.SelectObject(memory_dc, bitmap)
    user32.PrintWindow(hwnd, memory_dc, 2)  # PW_RENDERFULLCONTENT
    header = BitmapInfoHeader()
    header.biSize = ctypes.sizeof(header)
    header.biWidth, header.biHeight = width, -height
    header.biPlanes, header.biBitCount, header.biCompression = 1, 32, 0
    buffer = ctypes.create_string_buffer(width * height * 4)
    gdi32.GetDIBits(memory_dc, bitmap, 0, height, buffer, ctypes.byref(header), 0)
    gdi32.DeleteObject(bitmap)
    gdi32.DeleteDC(memory_dc)
    user32.ReleaseDC(hwnd, window_dc)
    return Image.frombuffer("RGBA", (width, height), buffer, "raw", "BGRA", 0, 1).convert("RGB")


# --- scenario ----------------------------------------------------------------------------------

def main() -> None:
    cdp = Cdp()
    hwnd = find_window()
    frames_dir = tempfile.mkdtemp(prefix="tvs-gif-")
    state = {"n": 0}

    def frame(count: int = 1, gap: float = 0.16) -> None:
        for _ in range(count):
            grab(hwnd).save(os.path.join(frames_dir, f"f{state['n']:03d}.png"))
            state["n"] += 1
            time.sleep(gap)

    def open_note(path: str) -> None:
        cdp.ev(f"""(async () => {{
          const file = app.vault.getAbstractFileByPath({path!r});
          await app.workspace.getLeaf(true).openFile(file);
          await new Promise(r => setTimeout(r, 700));
          return true;
        }})()""")

    open_note("Projects/Ideas/6.md")
    cdp.ev("""(async () => { await app.commands.executeCommandById('trello-vault-sync:open-card-view');
      await new Promise(r => setTimeout(r, 2500)); return true; })()""")
    time.sleep(1.2)
    frame(5)
    open_note("Projects/Ideas/7.md")   # the panel follows the active note
    frame(8, 0.14)
    cdp.ev("""(() => { const b = document.querySelector('.tvs-card-view__description .tvs-card-view__edit');
      if (b) b.click(); return Boolean(b); })()""")
    time.sleep(0.3)
    frame(4)
    cdp.ev("""(() => { const t = document.querySelector('.tvs-card-view__description textarea');
      if (!t) return false; t.focus(); t.value = ''; return true; })()""")
    for index, character in enumerate("Description edited from the panel."):
        cdp.call("Input.insertText", text=character)
        if index % 3 == 0:
            frame(1, 0.09)
        else:
            time.sleep(0.05)
    frame(3)
    cdp.ev("""(() => { const b = document.querySelector('.tvs-card-view__description .tvs-card-view__buttons .mod-cta');
      if (b) b.click(); return true; })()""")
    frame(9)

    deltas = _deltas(frames_dir)
    print(f"frames: {state['n']}  RMS diffs: min {min(deltas):.2f} max {max(deltas):.2f} "
          f"avg {sum(deltas) / len(deltas):.2f}")
    if max(deltas) < 1.0:
        shutil.rmtree(frames_dir, ignore_errors=True)
        sys.exit("frames are frozen (max RMS < 1): bring the Obsidian window to the front and re-run")

    subprocess.run(["ffmpeg", "-y", "-framerate", "5", "-i", os.path.join(frames_dir, "f%03d.png"),
                    "-vf", "fps=8,scale=800:-1:flags=lanczos,split[a][b];"
                           "[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer",
                    "-loop", "0", OUT], check=True, capture_output=True)
    shutil.rmtree(frames_dir, ignore_errors=True)
    print(f"written: {OUT} ({os.path.getsize(OUT) // 1024} KB)")


def _deltas(frames_dir: str) -> list[float]:
    from PIL import Image

    files = sorted(f for f in os.listdir(frames_dir) if f.endswith(".png"))
    previous: list[int] | None = None
    out: list[float] = []
    for name in files:
        pixels = list(Image.open(os.path.join(frames_dir, name)).convert("L").resize((160, 100)).getdata())
        if previous is not None:
            out.append(sum(abs(a - b) for a, b in zip(pixels, previous)) / len(pixels))
        previous = pixels
    return out or [0.0]


if __name__ == "__main__":
    main()
