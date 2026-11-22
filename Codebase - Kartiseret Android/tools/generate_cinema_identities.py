#!/usr/bin/env python3
"""Generate the Android cinema identity lookup from the shared contract source."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "packages/contracts/src/cinema-identities.ts"
OUTPUT = Path(__file__).resolve().parents[1] / "app/src/main/java/com/jj/kartiseret/CinemaIdentities.kt"


def records(source: str) -> list[tuple[str, str, str, list[str], list[str]]]:
    start = source.index("export const CINEMA_IDENTITIES")
    array_start = source.index("[", source.index("=", start))
    depth = 0
    quoted = False
    escaped = False
    current = ""
    result: list[str] = []
    for character in source[array_start + 1 :]:
        if quoted:
            current += character
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                quoted = False
            continue
        if character == '"':
            quoted = True
            current += character
        elif character == "{":
            if depth == 0:
                current = "{"
            else:
                current += character
            depth += 1
        elif character == "}":
            depth -= 1
            current += character
            if depth == 0:
                result.append(current)
                current = ""
        elif depth > 0:
            current += character
        elif character == "]":
            break

    parsed = []
    for block in result:
        fields = {}
        for key in ("id", "displayName", "city"):
            match = re.search(rf'\b{key}:\s*"((?:[^"\\]|\\.)*)"', block)
            if not match:
                raise ValueError(f"Cinema record is missing {key}: {block[:100]}")
            fields[key] = match.group(1)
        names = re.search(r"cinemaNameKeys:\s*\[(.*?)\]", block, re.S)
        if not names:
            raise ValueError("Cinema record is missing cinemaNameKeys")
        keys = re.findall(r'"((?:[^"\\]|\\.)*)"', names.group(1))
        screening_cities = re.search(r"screeningCityKeys:\s*\[(.*?)\]", block, re.S)
        if not screening_cities:
            raise ValueError("Cinema record is missing screeningCityKeys")
        city_keys = re.findall(r'"((?:[^"\\]|\\.)*)"', screening_cities.group(1))
        parsed.append((fields["id"], fields["displayName"], fields["city"], keys, city_keys))
    return parsed


def main() -> None:
    rows = records(SOURCE.read_text())
    entries = ",\n".join(
        f"    CinemaIdentity({json.dumps(identity)}, {json.dumps(name)}, {json.dumps(city)}, listOf({', '.join(json.dumps(item) for item in keys)}), listOf({', '.join(json.dumps(item) for item in screening_cities)}))"
        for identity, name, city, keys, screening_cities in rows
    )
    OUTPUT.write_text(
        "package com.jj.kartiseret\n\n"
        "data class CinemaIdentity(val id: String, val displayName: String, val city: String, val nameKeys: List<String>, val screeningCityKeys: List<String>)\n\n"
        "object CinemaIdentities {\n"
        f"    val all = listOf(\n{entries}\n    )\n"
        "    fun forScreening(city: String, name: String): CinemaIdentity? = all.filter { identity ->\n"
        "        identity.screeningCityKeys.any { it.normalizeCinemaKey() == city.normalizeCinemaKey() } && identity.nameKeys.any { key ->\n"
        "            key.normalizeCinemaKey() == name.normalizeCinemaKey()\n"
        "        }\n"
        "    }.singleOrNull()\n"
        "    fun byId(id: String): CinemaIdentity? = all.firstOrNull { it.id == id }\n"
        "    private fun String.normalizeCinemaKey() = java.text.Normalizer.normalize(this, java.text.Normalizer.Form.NFKC).trim().replace(Regex(\"\\\\s+\"), \" \" ).lowercase(java.util.Locale.ENGLISH)\n"
        "}\n"
    )
    print(f"Wrote {len(rows)} cinema identities to {OUTPUT}")


if __name__ == "__main__":
    main()
