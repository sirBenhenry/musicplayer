import os, subprocess

# Find any m4a/mp3 files modified in the last 10 minutes
result = subprocess.run(
    ["find", "/", "-name", "*.m4a", "-newer", "/tmp/spotdl_test/Ado - RuLe.m4a",
     "-not", "-path", "/proc/*", "-not", "-path", "/sys/*"],
    capture_output=True, text=True, timeout=30
)
print("=== m4a files newer than test download ===")
print(result.stdout[:2000])
print(result.stderr[:500])

# Also check spotdl leftover dirs
result2 = subprocess.run(
    ["find", "/data/music/media/music", "-maxdepth", "2", "-name", "*.m4a"],
    capture_output=True, text=True, timeout=10
)
print("\n=== All m4a in music dir ===")
print(result2.stdout[:2000])
