#!/usr/bin/env python3
"""Generate the native cinema identity map from the shared contract source."""

from __future__ import annotations

import pathlib
import re


ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "packages/contracts/src/cinema-identities.ts"
OUTPUT = pathlib.Path(__file__).resolve().parents[1] / "Kartiseret/Core/CinemaIdentity.swift"


def swift_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def parse_array(block: str, field: str) -> list[str]:
    match = re.search(rf"{field}:\s*(\[[\s\S]*?\])", block)
    if not match:
        return []
    return re.findall(r'"([^"\\]*(?:\\.[^"\\]*)*)"', match.group(1))


def main() -> None:
    source = SOURCE.read_text()
    data = []
    for block in re.findall(r"\{([\s\S]*?)\n  \}", source):
        fields = {key: value for key, value in re.findall(r'\b(id|displayName|city):\s*"([^"]+)"', block)}
        if not {"id", "displayName", "city"}.issubset(fields):
            continue
        data.append((
            fields["id"], fields["displayName"], fields["city"],
            parse_array(block, "locationKeys"),
            parse_array(block, "cinemaNameKeys"),
            parse_array(block, "screeningCityKeys"),
        ))
    if not data:
        raise SystemExit(f"No cinema identities found in {SOURCE}")

    entries = []
    for cinema_id, name, city, locations, names, cities in data:
        lists = ", ".join
        entries.append(
            "        CinemaIdentity("
            f"id: {swift_string(cinema_id)}, displayName: {swift_string(name)}, city: {swift_string(city)}, "
            f"locationKeys: [{lists(swift_string(v) for v in locations)}], "
            f"cinemaNameKeys: [{lists(swift_string(v) for v in names)}], "
            f"screeningCityKeys: [{lists(swift_string(v) for v in cities)}]"
            "),"
        )

    output = '''// Generated from packages/contracts/src/cinema-identities.ts.
// Run Scripts/generate_cinema_identities.py after changing that contract.
import Foundation

struct CinemaIdentity: Hashable, Identifiable, Sendable {
    let id: String
    let displayName: String
    let city: String
    let locationKeys: [String]
    let cinemaNameKeys: [String]
    let screeningCityKeys: [String]

    static let all: [CinemaIdentity] = [
''' + "\n".join(entries) + '''
    ]

    static func byID(_ id: String) -> CinemaIdentity? {
        all.first { $0.id == id }
    }

    static func forScreening(city: String, cinema: String) -> CinemaIdentity? {
        let normalizedCity = normalize(city)
        let normalizedCinema = normalize(cinema)
        let matches = all.filter { identity in
            identity.screeningCityKeys.contains { normalize($0) == normalizedCity } &&
            identity.cinemaNameKeys.contains { normalize($0) == normalizedCinema }
        }
        return matches.count == 1 ? matches[0] : nil
    }

    static func normalized(_ value: String) -> String {
        normalize(value)
    }

    private static func normalize(_ value: String) -> String {
        value.precomposedStringWithCompatibilityMapping
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: \\.isWhitespace)
            .joined(separator: " ")
            .lowercased(with: Locale(identifier: "en"))
    }
}
'''
    OUTPUT.write_text(output)
    print(f"Generated {OUTPUT} with {len(data)} identities")


if __name__ == "__main__":
    main()
