"""Temp-file janitor — prevents the /tmp leak that filled the host disk.

The analysis + download paths write audio files to /tmp inside the container.
Normal flow unlinks them, but a crash/kill between write and unlink leaks the
file. Those jobs run every few minutes, so leaks accumulate forever (7.6 GB of
orphaned tmp*.flac was found filling the host disk). This hourly sweep removes
stale temp files as a safety net independent of the per-job cleanup.
"""
import glob
import logging
import os
import time

log = logging.getLogger(__name__)

# Patterns of files the pipeline writes to /tmp.
_PATTERNS = ("/tmp/tmp*", "/tmp/*.spotdl")
# Only treat known audio extensions (plus .spotdl) as deletable, so we never
# touch something unrelated that happens to match tmp*.
_AUDIO_EXTS = (".flac", ".mp3", ".m4a", ".ogg", ".opus", ".wav", ".spotdl")
_MAX_AGE_SECONDS = 6 * 3600


def cleanup_tmp() -> None:
    cutoff = time.time() - _MAX_AGE_SECONDS
    removed = 0
    freed = 0
    for pattern in _PATTERNS:
        for path in glob.glob(pattern):
            try:
                if not os.path.isfile(path):
                    continue
                # .spotdl matches via the second pattern regardless of ext;
                # for tmp* require an audio extension to stay conservative.
                if not path.endswith(_AUDIO_EXTS):
                    continue
                if os.path.getmtime(path) >= cutoff:
                    continue
                size = os.path.getsize(path)
                os.remove(path)
                removed += 1
                freed += size
            except OSError:
                pass
    if removed:
        log.info("tmp_janitor: removed %d stale temp files (%.1f MB)",
                 removed, freed / 1_048_576)
