from __future__ import annotations

import csv
import io
from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import Any


def render_csv_lines(headers: Sequence[str], rows: Iterable[Sequence[Any]]) -> Iterable[str]:
    """Yield CSV text incrementally so callers can stream large reports.

    The buffer is reset between rows to avoid memory growth — each `yield`
    returns a self-contained chunk safe to flush to the wire.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(list(headers))
    yield buffer.getvalue()
    buffer.seek(0)
    buffer.truncate()
    for row in rows:
        writer.writerow(["" if v is None else v for v in row])
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate()


def render_pdf(
    *,
    title: str,
    subtitle: str,
    headers: Sequence[str],
    rows: Sequence[Sequence[Any]],
    tenant_name: str,
    generated_at: datetime,
) -> bytes:
    """Render a simple branded report PDF via ReportLab."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        title=title,
        author=tenant_name,
    )
    styles = getSampleStyleSheet()
    header_style = ParagraphStyle(
        "tenantHeader",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#475569"),
        spaceAfter=4,
    )
    title_style = ParagraphStyle(
        "reportTitle",
        parent=styles["Title"],
        fontSize=18,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=4,
    )
    subtitle_style = ParagraphStyle(
        "reportSubtitle",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#64748b"),
        spaceAfter=12,
    )

    story: list[Any] = [
        Paragraph(tenant_name, header_style),
        Paragraph(title, title_style),
        Paragraph(subtitle, subtitle_style),
        Paragraph(
            f"Generated {generated_at.isoformat(timespec='seconds')}",
            subtitle_style,
        ),
    ]

    if rows:
        data: list[list[Any]] = [list(headers)] + [["" if v is None else v for v in row] for row in rows]
        table = Table(data, repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    (
                        "ROWBACKGROUNDS",
                        (0, 1),
                        (-1, -1),
                        [
                            colors.white,
                            colors.HexColor("#f8fafc"),
                        ],
                    ),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(table)
    else:
        story.append(Paragraph("No data for the selected filters.", subtitle_style))

    story.append(Spacer(1, 12))
    doc.build(story)
    return buffer.getvalue()
