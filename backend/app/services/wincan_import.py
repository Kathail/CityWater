"""Parse WinCan-style CCTV survey exports.

WinCan VX exports XML; older versions exported MDB. Our parser accepts:
1. The native XML format (looks for survey/observations under common element
   names — covering both upper-case PASCAL and lowercase variants).
2. A flattened JSON shape mirroring our internal CCTV envelope, useful when
   the operator already converted the survey or another vendor produced a
   compatible document.

We deliberately keep the parser permissive: if the survey is missing
optional fields, the import still succeeds with the inspection's `data`
populated as far as possible. Strict CCTV cross-rules (unknown PACP codes,
distance > length_surveyed_m) still apply via `cctv_validation`.
"""

from __future__ import annotations

import json
from typing import Any, BinaryIO

# defusedxml hardens against billion-laughs / external-entity attacks in
# tenant-uploaded WinCAN XML. Public API matches stdlib xml.etree.
from defusedxml import ElementTree as ET  # noqa: N817 — `ET` is the canonical alias

from app.errors import ValidationError


def parse(stream: BinaryIO, *, content_type: str | None = None) -> dict[str, Any]:
    raw = stream.read()
    if not raw:
        raise ValidationError("empty file", code="empty_file")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise ValidationError("file is not UTF-8", code="bad_encoding") from e
    stripped = text.lstrip()
    if stripped.startswith("<"):
        return _parse_xml(stripped)
    if stripped.startswith("{"):
        return _parse_json(stripped)
    if content_type and "json" in content_type:
        return _parse_json(stripped)
    raise ValidationError("could not detect format (expected XML or JSON)", code="unknown_format")


def _parse_json(text: str) -> dict[str, Any]:
    try:
        obj = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValidationError(f"invalid JSON: {e.msg}", code="bad_json") from e
    if not isinstance(obj, dict):
        raise ValidationError("expected JSON object", code="bad_format")
    return _normalize(obj)


def _parse_xml(text: str) -> dict[str, Any]:
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        raise ValidationError(f"invalid XML: {e}", code="bad_xml") from e

    # Find a survey-ish element. WinCan VX uses <Section> or <Inspection>;
    # generic exports may put everything at the root.
    survey = root
    for child in root.iter():
        tag = _local(child.tag).lower()
        if tag in {"section", "inspection", "survey"}:
            survey = child
            break

    obj: dict[str, Any] = {}
    obj["standard"] = _text(survey, ("standard", "Standard")) or "PACP"
    obj["version"] = _text(survey, ("version", "Version")) or "7.0"
    obj["upstream_mh"] = _text(survey, ("upstreammh", "upstream_mh", "UpstreamMH", "FromMH"))
    obj["downstream_mh"] = _text(survey, ("downstreammh", "downstream_mh", "DownstreamMH", "ToMH"))
    obj["direction"] = (_text(survey, ("direction", "Direction")) or "").strip().lower() or None
    obj["length_surveyed_m"] = _text(survey, ("lengthsurveyed", "length_surveyed_m", "LengthSurveyed"))
    obj["length_total_m"] = _text(survey, ("lengthtotal", "length_total_m", "LengthTotal"))
    obj["media_url"] = _text(survey, ("mediaurl", "media_url", "MediaURL"))

    observations: list[dict[str, Any]] = []
    for obs_el in _iter_observations(survey):
        observations.append(
            {
                "distance_m": _text(obs_el, ("distance", "distance_m", "Distance")),
                "code": (_text(obs_el, ("code", "Code")) or "").strip(),
                "value_1": _text(obs_el, ("value1", "value_1", "Value1")),
                "value_2": _text(obs_el, ("value2", "value_2", "Value2")),
                "clock_from": _int(_text(obs_el, ("clockfrom", "clock_from", "ClockFrom"))),
                "clock_to": _int(_text(obs_el, ("clockto", "clock_to", "ClockTo"))),
                "joint": _bool(_text(obs_el, ("joint", "Joint"))),
                "continuous": _bool(_text(obs_el, ("continuous", "Continuous"))),
                "severity": _int(_text(obs_el, ("severity", "Severity"))),
                "remarks": _text(obs_el, ("remarks", "Remarks", "Comment", "Note")),
                "photo_s3_key": _text(obs_el, ("photo", "photo_s3_key", "Photo")),
            }
        )
    obj["observations"] = observations

    ratings_el = _find(survey, ("ratings", "Ratings"))
    if ratings_el is not None:
        obj["ratings"] = {
            "structural_qr": _int(_text(ratings_el, ("structuralqr", "Structural_QR"))),
            "om_qr": _int(_text(ratings_el, ("omqr", "OM_QR"))),
            "structural_total": _int(_text(ratings_el, ("structuraltotal", "Structural_Total"))),
            "om_total": _int(_text(ratings_el, ("omtotal", "OM_Total"))),
        }

    return _normalize(obj)


def _normalize(obj: dict[str, Any]) -> dict[str, Any]:
    """Drop None values + coerce numeric strings; passes through to CctvData."""
    return {k: v for k, v in obj.items() if v not in (None, "")}


def _local(tag: str) -> str:
    """Strip XML namespace if present."""
    return tag.split("}", 1)[-1]


def _text(el: ET.Element, names: tuple[str, ...]) -> str | None:
    target = _find(el, names)
    if target is None:
        # Try attribute lookup
        for name in names:
            v = el.get(name)
            if v is not None and v != "":
                return v
        return None
    if target.text is None:
        return None
    s = target.text.strip()
    return s or None


def _find(el: ET.Element, names: tuple[str, ...]) -> ET.Element | None:
    """Recursive case-insensitive descendant search by local name. ElementTree's
    XPath doesn't support local-name() predicates so we iter() ourselves."""
    wanted = {n.lower() for n in names}
    for child in el.iter():
        if child is el:
            continue
        if _local(child.tag).lower() in wanted:
            return child
    return None


def _iter_observations(el: ET.Element) -> list[ET.Element]:
    out: list[ET.Element] = []
    for child in el.iter():
        local = _local(child.tag).lower()
        if local in {"observation", "obs", "defect"}:
            out.append(child)
    return out


def _int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _bool(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "y"}
