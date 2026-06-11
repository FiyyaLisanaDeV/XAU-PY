from datetime import datetime, timezone
from pathlib import Path

from backend.app.economic_calendar import load_calendar_events, parse_mt5_html_export


EXPORT_HTML = """<!doctype html>
<html><body><table><tbody>
<tr><td colspan="9" class="week-days">Wednesday, 17 June</td></tr>
<tr>
  <td class="country"><div class="EU"></div></td><td>09:00</td><td>EUR</td>
  <td>CPI y/y</td><td>High</td><td>May</td><td></td><td>2.6%</td><td>2.6%</td>
</tr>
<tr>
  <td class="country"><div class="US"></div></td><td>12:30</td><td>USD</td>
  <td>Retail Sales m/m</td><td>Medium</td><td>May</td><td></td><td>-0.1%</td><td>0.5%</td>
</tr>
<tr>
  <td class="country"><div class="US"></div></td><td>14:00</td><td>USD</td>
  <td>Low impact event</td><td>Low</td><td>May</td><td></td><td></td><td></td>
</tr>
</tbody></table></body></html>"""


def test_parse_mt5_html_export_filters_medium_and_high(tmp_path: Path):
    export_path = tmp_path / "Economic calendar.htm"
    export_path.write_text(EXPORT_HTML, encoding="utf-16")

    events = parse_mt5_html_export(
        export_path,
        now=datetime(2026, 6, 12, tzinfo=timezone.utc),
    )

    assert [event.title for event in events] == ["CPI y/y", "Retail Sales m/m"]
    assert events[0].time == "2026-06-17T09:00:00+00:00"
    assert events[0].country == "Eurozone"
    assert events[0].affected_symbols == ["EURUSD"]
    assert events[1].affected_symbols == ["XAUUSD", "EURUSD"]


def test_load_calendar_uses_latest_html_export(tmp_path: Path):
    export_dir = tmp_path / "Calender Export"
    export_dir.mkdir()
    (export_dir / "Economic calendar.htm").write_text(EXPORT_HTML, encoding="utf-16")

    response = load_calendar_events(
        path=tmp_path / "missing.json",
        html_export_dir=export_dir,
        now=datetime(2026, 6, 12, tzinfo=timezone.utc),
    )

    assert response.configured is True
    assert response.source == "mt5_html_export"
    assert response.timezone == "UTC"
    assert len(response.events) == 2
