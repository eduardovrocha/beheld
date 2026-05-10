from __future__ import annotations

from collections import Counter

from extractors.commands import extract_platforms
from extractors.files import extract_ecosystems, extract_languages
from models import Session

INFRA_PLATFORMS = {"docker", "cloud_infra", "ci_cd"}


def compute_tech_breadth(sessions: list[Session]) -> int:
    """
    Dimensions (sums to 100):
      +40  distinct ecosystems (max 6)
      +30  distinct platforms (max 5)
      +20  distinct languages (max 4)
      +10  infra tools present (docker / cloud / CI)
    """
    if not sessions:
        return 0

    all_extensions: Counter = Counter()
    all_commands: list[str] = []
    for s in sessions:
        all_extensions.update(s.file_extensions)
        all_commands.extend(s.commands)

    ecosystems = extract_ecosystems(all_extensions)
    languages = extract_languages(all_extensions)
    platforms = extract_platforms(all_commands)

    score = 0

    # 1. Distinct ecosystems (max 6)
    score += int(40 * min(len(ecosystems), 6) / 6)

    # 2. Distinct platforms (max 5)
    score += int(30 * min(len(platforms), 5) / 5)

    # 3. Distinct languages (max 4)
    score += int(20 * min(len(languages), 4) / 4)

    # 4. Infra tools
    if any(p in INFRA_PLATFORMS for p in platforms):
        score += 10

    return min(100, score)
