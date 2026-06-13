import os, glob

# Check /tmp for audio files
print("=== /tmp audio files ===")
for ext in ['m4a', 'mp3', 'opus', 'flac', 'ogg']:
    for f in glob.glob(f'/tmp/*.{ext}'):
        print(f)

# Check /data/music/media/music root for recent m4a files
print("\n=== /data/music/media/music/*.m4a ===")
for f in glob.glob('/data/music/media/music/*.m4a'):
    print(f)

# Check if spotdl save file embeds output path
import json, glob as g
for sf in g.glob('/tmp/*.spotdl'):
    print(f"\n=== {sf} ===")
    with open(sf) as fh:
        data = json.load(fh)
    if isinstance(data, dict):
        print("  output:", data.get('output'))
        songs = data.get('songs', [])
        print(f"  songs: {len(songs)}")
        if songs:
            print("  first:", songs[0].get('name'), songs[0].get('output_path', 'NO output_path'))
    elif isinstance(data, list):
        print(f"  list of {len(data)}")
        if data:
            print("  first:", data[0].get('name'), data[0].get('output_path', 'NO output_path'))
