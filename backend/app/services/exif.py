from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
from typing import BinaryIO

from PIL import ExifTags, Image

_GPS_TAG_ID = next((tag for tag, name in ExifTags.TAGS.items() if name == "GPSInfo"), None)


def _ratio_to_float(value) -> float | None:
    try:
        return float(value)
    except Exception:
        return None


def _dms_to_decimal(dms, ref) -> float | None:
    try:
        d, m, s = (_ratio_to_float(x) for x in dms)
        if d is None or m is None or s is None:
            return None
        decimal = d + m / 60 + s / 3600
        if ref in ("S", "W"):
            decimal = -decimal
        return decimal
    except Exception:
        return None


def extract_metadata(stream: BinaryIO) -> tuple[tuple[float, float] | None, datetime | None]:
    """Return ((lon, lat), taken_at) extracted from a JPEG/HEIC stream.

    Either or both may be None. Stream must be seekable; caller should reset
    position before/after if it needs to read the bytes again."""
    pos = stream.tell()
    try:
        img = Image.open(stream)
        exif = img._getexif() if hasattr(img, "_getexif") else None
    except Exception:
        stream.seek(pos)
        return None, None

    coords: tuple[float, float] | None = None
    taken_at: datetime | None = None

    if exif:
        tag_id = _GPS_TAG_ID
        gps = exif.get(tag_id) if tag_id is not None else None
        if gps:
            gps_tags = {ExifTags.GPSTAGS.get(k, k): v for k, v in gps.items()}
            lat = _dms_to_decimal(gps_tags.get("GPSLatitude"), gps_tags.get("GPSLatitudeRef"))
            lon = _dms_to_decimal(gps_tags.get("GPSLongitude"), gps_tags.get("GPSLongitudeRef"))
            if lat is not None and lon is not None:
                coords = (lon, lat)

        for tag in ("DateTimeOriginal", "DateTime"):
            raw = exif.get(next((t for t, name in ExifTags.TAGS.items() if name == tag), None))
            if raw:
                try:
                    taken_at = datetime.strptime(raw, "%Y:%m:%d %H:%M:%S").replace(tzinfo=UTC)
                    break
                except (ValueError, TypeError):
                    continue

    stream.seek(pos)
    return coords, taken_at


def strip_non_gps_exif(stream: BinaryIO) -> bytes:
    """Re-encode the image without any EXIF metadata. Returns the new bytes.
    Privacy-by-default: device serials, ICC profiles, etc. removed.

    GPS data was already extracted; we don't re-embed it (the database is
    the source of truth)."""
    pos = stream.tell()
    img = Image.open(stream)
    out = BytesIO()
    fmt = img.format or "JPEG"
    save_kwargs = {}
    if fmt == "JPEG":
        save_kwargs["quality"] = 90
    # No `exif=` parameter → no EXIF in output
    img.save(out, format=fmt, **save_kwargs)
    stream.seek(pos)
    return out.getvalue()
