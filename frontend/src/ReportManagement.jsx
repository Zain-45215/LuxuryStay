import { useEffect, useState } from "react";
import "./reports.css";

const roomLabels = {
  available: "Available",
  occupied: "Occupied",
  cleaning: "Cleaning",
  maintenance: "Maintenance",
  other: "Other",
};

const reservationLabels = {
  confirmed: "Confirmed",
  checked_in: "Checked in",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  no_show: "No-show",
  other: "Other",
};

function money(value, currency) {
  const amount = Number(value) / 100;

  if (!Number.isFinite(amount)) return "Unavailable";

  try {
    return new Intl.NumberFormat("en-PK", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency || "Unknown"} ${amount.toFixed(2)}`;
  }
}

function count(value) {
  return Number(value || 0).toLocaleString("en-PK");
}

function csvCell(value) {
  let text = String(value ?? "");

  // Prevent spreadsheet formula execution.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(report) {
  const rows = [
    ["LuxuryStay reports"],
    ["Generated at", report.generatedAt],
    ["Reservation date basis", report.filters.dateBasis],
    ["From", report.filters.from || "All dates"],
    ["To", report.filters.to || "All dates"],
    [],
    ["Current property snapshot"],
    ["Total hotels", report.hotels.total],
    ["Active hotels", report.hotels.active],
    ["Active rooms in active hotels", report.rooms.total],
    [
      "Current occupancy percent",
      report.rooms.occupancyPercent ?? "Not applicable",
    ],
    [],
    ["Current room status", "Rooms"],
    ...Object.entries(report.rooms.status).map(([status, value]) => [
      roomLabels[status] || status,
      value,
    ]),
    [],
    ["Reservation status within selected check-in dates", "Count"],
    ...Object.entries(report.reservations.status).map(([status, value]) => [
      reservationLabels[status] || status,
      value,
    ]),
    [],
    [
      "Currency",
      "Reservations",
      "Room nights",
      "Subtotal",
      "Tax",
      "Booking total",
    ],
    ...report.bookingAmounts.map((item) => [
      item.currency,
      item.reservations,
      item.roomNights,
      (item.subtotalMinor / 100).toFixed(2),
      (item.taxAmountMinor / 100).toFixed(2),
      (item.totalMinor / 100).toFixed(2),
    ]),
    [],
    [
      "Note",
      "Booking totals are not collected payments. Cancelled and no-show reservations are excluded from booking amounts. Additional service charges are not included.",
    ],
  ];

  const csv =
    "\uFEFF" +
    rows.map((row) => row.map(csvCell).join(",")).join("\r\n");

  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" })
  );

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `LuxuryStay-Report-${report.generatedAt.slice(0, 10)}.csv`;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function StatusChart({ title, labels, values, total }) {
  return (
    <section className="rp-panel">
      <h2>{title}</h2>

      <div className="rp-bars">
        {Object.entries(labels).map(([key, label]) => {
          const value = values[key] || 0;
          if (key === "other" && value === 0) return null;

          const percent = total > 0 ? (value / total) * 100 : 0;

          return (
            <div className="rp-bar-row" key={key}>
              <div className="rp-bar-label">
                <span>{label}</span>
                <strong>{count(value)}</strong>
              </div>

              <div className="rp-track" aria-hidden="true">
                <span style={{ width: `${percent}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {total === 0 && <p className="rp-note">No matching records.</p>}
    </section>
  );
}

export default function ReportManagement() {
  const [draft, setDraft] = useState({ from: "", to: "" });
  const [filters, setFilters] = useState({ from: "", to: "" });
  const [refresh, setRefresh] = useState(0);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    document.title = "LuxuryStay | Reports & Analytics";

    const controller = new AbortController();

    async function loadReport() {
      setLoading(true);
      setError("");

      try {
        const query = new URLSearchParams();

        if (filters.from) query.set("from", filters.from);
        if (filters.to) query.set("to", filters.to);

        const response = await fetch(`/api/reports/summary?${query}`, {
          credentials: "include",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        const data = await response.json().catch(() => ({
          message: "The report response could not be read.",
        }));

        if (!response.ok || !data.success) {
          throw new Error(
            response.status === 401
              ? "Your session has expired. Please sign in again."
              : data.message || "Unable to load the report."
          );
        }

        if (
          !data.hotels ||
          !data.rooms?.status ||
          !data.reservations?.status ||
          !Array.isArray(data.bookingAmounts)
        ) {
          throw new Error("The report response is incomplete.");
        }

        if (!controller.signal.aborted) {
          setReport(data);
        }
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(requestError.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadReport();

    return () => controller.abort();
  }, [filters, refresh]);

  function applyFilters(event) {
    event.preventDefault();
    setFormError("");

    if (draft.from && draft.to && draft.from > draft.to) {
      setFormError("From date cannot be after the To date.");
      return;
    }

    setFilters({ ...draft });
  }

  function resetFilters() {
    setDraft({ from: "", to: "" });
    setFilters({ from: "", to: "" });
    setFormError("");
  }

  const ready = report && !loading && !error;

  return (
    <section className="rp">
      <div className="rp-heading">
        <div>
          <span className="rp-eyebrow">KNOW YOUR PROPERTIES</span>
          <h1>Reports & analytics</h1>
          <p>Current operations and reservation performance at a glance.</p>
        </div>

        <div className="rp-actions">
          <button
            type="button"
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh
          </button>

          <button
            type="button"
            className="rp-dark"
            disabled={!ready}
            onClick={() => downloadCsv(report)}
          >
            Export CSV ↗
          </button>
        </div>
      </div>

      <form className="rp-filter" onSubmit={applyFilters}>
        <div className="rp-filter-description">
          <strong>Reservation check-in dates</strong>
          <span>Leave both dates empty to include all reservations.</span>
        </div>

        <label>
          From
          <input
            type="date"
            value={draft.from}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                from: event.target.value,
              }))
            }
          />
        </label>

        <label>
          To
          <input
            type="date"
            value={draft.to}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                to: event.target.value,
              }))
            }
          />
        </label>

        <button type="submit" className="rp-dark" disabled={loading}>
          Apply dates
        </button>

        <button type="button" disabled={loading} onClick={resetFilters}>
          Reset
        </button>
      </form>

      {formError && (
        <div className="rp-error" role="alert">{formError}</div>
      )}

      {loading && (
        <div className="rp-empty" role="status">
          Preparing your report…
        </div>
      )}

      {!loading && error && (
        <div className="rp-error" role="alert">{error}</div>
      )}

      {ready && (
        <>
          <p className="rp-period">
            Reservation period:{" "}
            <strong>
              {report.filters.from || "Beginning"} —{" "}
              {report.filters.to || "All future dates"}
            </strong>
            <span>
              Snapshot:{" "}
              {new Date(report.generatedAt).toLocaleString("en-PK", {
                timeZone: "Asia/Karachi",
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              · Pakistan time
            </span>
          </p>

          <div className="rp-stats">
            <article className="rp-stat">
              <span>Active hotels</span>
              <strong>{count(report.hotels.active)}</strong>
              <small>{count(report.hotels.total)} hotels registered</small>
            </article>

            <article className="rp-stat">
              <span>Active rooms</span>
              <strong>{count(report.rooms.total)}</strong>
              <small>Across active hotels, right now</small>
            </article>

            <article className="rp-stat rp-stat-dark">
              <span>Current occupancy</span>
              <strong>
                {report.rooms.occupancyPercent === null
                  ? "—"
                  : `${report.rooms.occupancyPercent}%`}
              </strong>
              <small>
                {count(report.rooms.status.occupied)} occupied rooms
              </small>
            </article>

            <article className="rp-stat">
              <span>Reservations</span>
              <strong>{count(report.reservations.total)}</strong>
              <small>Selected check-in dates · all statuses</small>
            </article>
          </div>

          <p className="rp-note">
            Occupancy uses current room status, not the selected date range.
            Its denominator includes all active rooms in active hotels,
            including rooms under cleaning or maintenance.
          </p>

          <div className="rp-chart-grid">
            <StatusChart
              title="Rooms right now"
              labels={roomLabels}
              values={report.rooms.status}
              total={report.rooms.total}
            />

            <StatusChart
              title="Reservation status"
              labels={reservationLabels}
              values={report.reservations.status}
              total={report.reservations.total}
            />
          </div>

          <section className="rp-panel rp-amounts">
            <span className="rp-eyebrow">RESERVATION VALUE</span>
            <h2>Booking amounts by currency</h2>

            <p className="rp-note">
              Includes confirmed, checked-in and checked-out reservations
              within the selected check-in dates. Excludes cancelled/no-show
              bookings and additional service charges. These amounts do not
              represent collected payments.
            </p>

            {report.bookingAmounts.length === 0 ? (
              <div className="rp-empty">
                No qualifying reservations in this period.
              </div>
            ) : (
              <div
                className="rp-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Booking amounts by currency"
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Currency</th>
                      <th scope="col">Bookings</th>
                      <th scope="col">Room nights</th>
                      <th scope="col">Subtotal</th>
                      <th scope="col">Tax</th>
                      <th scope="col">Booking total</th>
                    </tr>
                  </thead>

                  <tbody>
                    {report.bookingAmounts.map((item) => (
                      <tr key={item.currency || "unknown"}>
                        <th scope="row">{item.currency || "Unknown"}</th>
                        <td>{count(item.reservations)}</td>
                        <td>{count(item.roomNights)}</td>
                        <td>{money(item.subtotalMinor, item.currency)}</td>
                        <td>{money(item.taxAmountMinor, item.currency)}</td>
                        <td>
                          <strong>
                            {money(item.totalMinor, item.currency)}
                          </strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}