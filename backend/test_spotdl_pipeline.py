"""Reproduce exact pipeline spotdl call to diagnose why it finds no audio file."""
import asyncio, json, os, shutil, subprocess, tempfile
from pathlib import Path

DEST_DIR = "/data/music/media/music"
_AUDIO_EXTS = {".mp3", ".m4a", ".aac", ".opus", ".ogg", ".flac"}

async def main():
    query = "Ado - RuLe"

    # Step 1: save
    with tempfile.NamedTemporaryFile(suffix=".spotdl", delete=False) as tf:
        save_path = tf.name
    print(f"save_path: {save_path}")

    def _save():
        return subprocess.run(
            ["spotdl", "save", query, "--save-file", save_path, "--output", "/tmp"],
            capture_output=True, text=True, timeout=60,
        )

    r = await asyncio.to_thread(_save)
    print(f"save exit={r.returncode}")
    print(f"save stdout: {r.stdout[:500]}")
    print(f"save stderr: {r.stderr[:500]}")

    if r.returncode != 0:
        print("SAVE FAILED")
        return

    with open(save_path) as f:
        data = json.load(f)
    songs = data if isinstance(data, list) else data.get("songs", [])
    print(f"save file songs: {len(songs)}")
    if songs:
        print(f"  first song: {songs[0].get('name')} by {songs[0].get('artist')}")

    # Step 2: download
    tmp_dir = tempfile.mkdtemp(dir=DEST_DIR, prefix=".spotdl_")
    print(f"tmp_dir: {tmp_dir}")

    cmd = ["spotdl", "download", save_path, "--output", tmp_dir, "--format", "m4a", "--audio", "youtube-music"]
    print(f"cmd: {' '.join(cmd)}")

    def _dl():
        return subprocess.run(cmd, capture_output=True, text=True, timeout=180)

    r2 = await asyncio.to_thread(_dl)
    print(f"download exit={r2.returncode}")
    print(f"download stdout: {r2.stdout[:1000]}")
    print(f"download stderr: {r2.stderr[:1000]}")

    # Check what's in tmp_dir (recursively)
    print(f"\nContents of {tmp_dir}:")
    for root, dirs, files in os.walk(tmp_dir):
        for fn in files:
            print(f"  {os.path.join(root, fn)}")

    audio_files = [fn for fn in os.listdir(tmp_dir) if Path(fn).suffix.lower() in _AUDIO_EXTS]
    print(f"\nAudio files in root of tmp_dir: {audio_files}")

    # Cleanup
    shutil.rmtree(tmp_dir, ignore_errors=True)
    try:
        os.unlink(save_path)
    except OSError:
        pass

asyncio.run(main())
