from __future__ import annotations

from extractors.commands import detect_platforms
from extractors.files import detect_ecosystems, detect_languages
from models import Session

_INFRA_PLATFORMS = frozenset({"docker", "cloud_infra", "ci_cd"})


class TechBreadthScorer:
    """
    Dimensions (sums to 100):
      +40  distinct ecosystems (max 6)
      +30  distinct platforms (max 5)
      +20  distinct languages (max 4)
      +10  infra tools present (docker / cloud / CI)
    """

    def score(self, sessions: list[Session]) -> int:
        if not sessions:
            return 0

        all_ext_keys: set[str] = set()
        all_commands: list[str] = []
        for s in sessions:
            all_ext_keys.update(s.file_extensions.keys())
            all_commands.extend(s.commands)

        # Convert extension keys to fake paths for detect_ecosystems/detect_languages
        fake_paths = [f"f{ext}" for ext in all_ext_keys]
        ecosystems = detect_ecosystems(fake_paths)
        languages = detect_languages(fake_paths)
        platforms = detect_platforms(all_commands)

        result = 0
        result += int(40 * min(len(ecosystems), 6) / 6)
        result += int(30 * min(len(platforms), 5) / 5)
        result += int(20 * min(len(languages), 4) / 4)
        if any(p in _INFRA_PLATFORMS for p in platforms):
            result += 10

        return min(100, result)
