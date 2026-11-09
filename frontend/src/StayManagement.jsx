import { useEffect, useRef, useState } from "react";

const STATUS_OPTIONS = [
  { value: "confirmed", label: "Awaiting check-in" },
  { value: "checked_in", label: "Currently staying" },
  { value: "checked_out", label: "Checked out" },
];

async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.success) {
    throw new Error(
      data?.message ||
        (response.status === 401
          ? "Please log in again."
          : "Request failed. Please try again.")
    );
  }

  return data;
}

function money(amount, currency = "PKR") {
  if (!Number.isSafeInteger(amount)) return "—";

  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
  }).format(amount / 100);
}

function dateLabel(value) {
  if (!value) return "—";

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function timestampLabel(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(date);
}

export default function StayManagement() {
  const [status, setStatus] = useState("confirmed");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [reservations, setReservations] = useState([]);
  const [pagination, setPagination] = useState({
    total: 0,
    pages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);

  const actionLock = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadReservations() {
      setLoading(true);
      setLoadError("");
      setReservations([]);

      try {
        const params = new URLSearchParams({
          status,
          page: String(page),
          limit: "10",
        });

        const data = await request(`/reservations?${params}`, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        const pages = Math.max(1, data.pagination?.pages || 1);

        if (page > pages) {
          setPage(pages);
          return;
        }

        setReservations(data.reservations || []);
        setPagination({
          total: data.pagination?.total || 0,
          pages,
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadReservations();

    return () => controller.abort();
  }, [status, page, refresh]);

  function changeStatus(value) {
    if (actionLock.current) return;

    setStatus(value);
    setPage(1);
    setSelected(null);
    setActionError("");
    setSuccess("");
  }

  function openAction(reservation) {
    if (actionLock.current) return;

    setSelected(reservation);
    setActionError("");
    setSuccess("");
  }

  async function confirmAction() {
    if (!selected || actionLock.current) return;

    const action =
      selected.status === "confirmed" ? "check-in" : "check-out";

    actionLock.current = true;
    setBusy(true);
    setActionError("");
    setSuccess("");

    try {
      const data = await request(
        `/stays/${selected._id}/${action}`,
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      );

      if (!mounted.current) return;

      setSuccess(data.message);
      setSelected(null);
      setRefresh((value) => value + 1);
    } catch (error) {
      if (mounted.current) {
        setActionError(error.message);
      }
    } finally {
      actionLock.current = false;

      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  return (
    <section className="stay-page">
      <style>{`
        .stay-page {
          color: #203b30;
          width: 100%;
        }

        .stay-page * {
          box-sizing: border-box;
        }

        .stay-heading,
        .stay-card-head,
        .stay-card-bottom,
        .stay-pagination,
        .stay-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }

        .stay-heading {
          margin-bottom: 24px;
        }

        .stay-page h2 {
          color: #173f2e;
          font-size: 28px;
          margin: 0 0 8px;
        }

        .stay-page h3 {
          color: #173f2e;
          font-size: 19px;
          margin: 5px 0;
        }

        .stay-page p {
          margin: 0;
          line-height: 1.6;
        }

        .stay-muted {
          color: #627369;
          font-size: 14px;
        }

        .stay-page button {
          width: auto;
          margin: 0;
          padding: 11px 17px;
          border: 1px solid #d8e2db;
          border-radius: 10px;
          background: #fff;
          color: #234633;
          font: inherit;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
        }

        .stay-page button:hover:not(:disabled) {
          background: #edf4ef;
        }

        .stay-page button:focus-visible {
          outline: 3px solid #b28a40;
          outline-offset: 3px;
        }

        .stay-page button:disabled {
          opacity: .55;
          cursor: not-allowed;
        }

        .stay-page button.stay-primary {
          background: #1c5139;
          color: #fff;
          border-color: #1c5139;
        }

        .stay-page button.stay-primary:hover:not(:disabled) {
          background: #143f2b;
        }

        .stay-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 20px;
        }

        .stay-tabs button.stay-active {
          background: #1c5139;
          border-color: #1c5139;
          color: white;
        }

        .stay-message {
          padding: 15px 18px;
          border-radius: 12px;
          margin-bottom: 18px;
          line-height: 1.6;
        }

        .stay-success {
          background: #eaf6ed;
          color: #215333;
          border: 1px solid #c8e5cf;
        }

        .stay-error {
          background: #fff0ee;
          color: #963a31;
          border: 1px solid #f0c9c4;
        }

        .stay-list {
          display: grid;
          gap: 16px;
        }

        .stay-card,
        .stay-empty {
          background: #fff;
          border: 1px solid #e0e7df;
          border-radius: 17px;
          padding: 23px;
        }

        .stay-reference {
          font-size: 12px;
          color: #786039;
          font-weight: 700;
          overflow-wrap: anywhere;
        }

        .stay-badge {
          border-radius: 30px;
          padding: 7px 12px;
          background: #eff3ef;
          font-size: 12px;
          font-weight: 700;
        }

        .stay-badge.confirmed {
          background: #fff2d8;
          color: #805a13;
        }

        .stay-badge.checked_in {
          background: #e6f3e9;
          color: #24643c;
        }

        .stay-details {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 18px;
          margin: 22px 0;
          padding: 19px 0;
          border-top: 1px solid #edf0e9;
          border-bottom: 1px solid #edf0e9;
        }

        .stay-details dt {
          color: #68796e;
          font-size: 12px;
          margin-bottom: 6px;
        }

        .stay-details dd {
          font-weight: 600;
          font-size: 14px;
          margin: 0;
          overflow-wrap: anywhere;
        }

        .stay-note {
          padding: 12px 0;
          color: #67766c;
          font-size: 13px;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .stay-confirm {
          margin-top: 18px;
          padding: 18px;
          border-radius: 12px;
          background: #f6f3e9;
          border: 1px solid #e6dcc4;
        }

        .stay-confirm p {
          margin-bottom: 14px;
          font-size: 14px;
        }

        .stay-actions {
          justify-content: flex-start;
        }

        .stay-pagination {
          margin-top: 22px;
        }

        .stay-empty {
          text-align: center;
          padding: 45px 20px;
        }

        @media (max-width: 700px) {
          .stay-details {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .stay-card {
            padding: 18px;
          }

          .stay-page h2 {
            font-size: 24px;
          }
        }
      `}</style>

      <div className="stay-heading">
        <div>
          <h2>Check-in / Check-out</h2>
          <p className="stay-muted">
            Manage arrivals, current guests and completed stays.
          </p>
        </div>

        <button
          type="button"
          disabled={loading || busy}
          onClick={() => {
            setSelected(null);
            setActionError("");
            setRefresh((value) => value + 1);
          }}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="stay-tabs" aria-label="Filter stays">
        {STATUS_OPTIONS.map((option) => (
          <button
            type="button"
            key={option.value}
            className={status === option.value ? "stay-active" : ""}
            aria-pressed={status === option.value}
            disabled={busy}
            onClick={() => changeStatus(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {success && (
        <div className="stay-message stay-success" role="status">
          {success}
        </div>
      )}

      {loadError && (
        <div className="stay-message stay-error" role="alert">
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="stay-empty" role="status">
          Loading reservations...
        </div>
      ) : !loadError && reservations.length === 0 ? (
        <div className="stay-empty">
          <h3>No reservations found</h3>
          <p className="stay-muted">
            {status === "confirmed"
              ? "Create a reservation from the Reservations page first."
              : "There are no stays in this category yet."}
          </p>
        </div>
      ) : !loadError ? (
        <>
          <div className="stay-list">
            {reservations.map((reservation) => {
              const isSelected = selected?._id === reservation._id;
              const isCheckIn = reservation.status === "confirmed";
              const actionable =
                isCheckIn || reservation.status === "checked_in";
              const actionLabel = isCheckIn ? "Check in" : "Check out";
              const statusLabel = STATUS_OPTIONS.find(
                (option) => option.value === reservation.status
              )?.label;

              return (
                <article className="stay-card" key={reservation._id}>
                  <div className="stay-card-head">
                    <div>
                      <div className="stay-reference">
                        {reservation.bookingReference}
                      </div>
                      <h3>{reservation.guestName}</h3>
                      <p className="stay-muted">
                        {reservation.hotel?.name || "Hotel unavailable"}
                        {" · Room "}
                        {reservation.room?.roomNumber || "—"}
                      </p>
                    </div>

                    <span className={`stay-badge ${reservation.status}`}>
                      {statusLabel || reservation.status}
                    </span>
                  </div>

                  <dl className="stay-details">
                    <div>
                      <dt>Arrival date</dt>
                      <dd>{dateLabel(reservation.checkInDate)}</dd>
                    </div>
                    <div>
                      <dt>Departure date</dt>
                      <dd>{dateLabel(reservation.checkOutDate)}</dd>
                    </div>
                    <div>
                      <dt>Guests / Nights</dt>
                      <dd>
                        {reservation.numberOfGuests} guests ·{" "}
                        {reservation.nights} nights
                      </dd>
                    </div>
                    <div>
                      <dt>Booked room total</dt>
                      <dd>
                        {money(
                          reservation.totalMinor,
                          reservation.currency
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Phone</dt>
                      <dd>{reservation.guestPhone || "—"}</dd>
                    </div>
                    <div>
                      <dt>Email</dt>
                      <dd>{reservation.guestEmail || "—"}</dd>
                    </div>
                    <div>
                      <dt>Checked in (Pakistan time)</dt>
                      <dd>{timestampLabel(reservation.checkedInAt)}</dd>
                    </div>
                    <div>
                      <dt>Checked out (Pakistan time)</dt>
                      <dd>{timestampLabel(reservation.checkedOutAt)}</dd>
                    </div>
                  </dl>

                  {reservation.specialRequests && (
                    <p className="stay-note">
                      Guest requests: {reservation.specialRequests}
                    </p>
                  )}

                  <div className="stay-card-bottom">
                    <p className="stay-muted">
                      {isCheckIn
                        ? "Room readiness and arrival dates are checked when you confirm."
                        : reservation.status === "checked_in"
                          ? "Checking out marks the room for cleaning."
                          : "This stay has been completed."}
                    </p>

                    {actionable && !isSelected && (
                      <button
                        type="button"
                        className="stay-primary"
                        disabled={busy}
                        onClick={() => openAction(reservation)}
                      >
                        {actionLabel}
                      </button>
                    )}
                  </div>

                  {isSelected && (
                    <div className="stay-confirm">
                      <p>
                        <strong>
                          {actionLabel} {reservation.guestName}?
                        </strong>{" "}
                        {isCheckIn
                          ? "The reservation will become checked in and the room will become occupied."
                          : "The stay will be completed and the room will require cleaning. This action does not record a payment or change the booked charges."}
                      </p>

                      {actionError && (
                        <div
                          className="stay-message stay-error"
                          role="alert"
                        >
                          {actionError}
                        </div>
                      )}

                      <div className="stay-actions">
                        <button
                          type="button"
                          className="stay-primary"
                          disabled={busy}
                          onClick={confirmAction}
                        >
                          {busy ? "Processing..." : `Confirm ${actionLabel}`}
                        </button>

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setSelected(null);
                            setActionError("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="stay-pagination">
            <p className="stay-muted">
              {pagination.total} reservations · Page {page} of{" "}
              {pagination.pages}
            </p>

            <div className="stay-actions">
              <button
                type="button"
                disabled={page <= 1 || busy}
                onClick={() => {
                  setSelected(null);
                  setPage((value) => value - 1);
                }}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= pagination.pages || busy}
                onClick={() => {
                  setSelected(null);
                  setPage((value) => value + 1);
                }}
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}