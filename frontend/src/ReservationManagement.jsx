import { useEffect, useRef, useState } from "react";

const EMPTY_FORM = {
  hotel: "",
  room: "",
  guestName: "",
  guestEmail: "",
  guestPhone: "",
  numberOfGuests: "1",
  checkInDate: "",
  checkOutDate: "",
  specialRequests: "",
};

const STATUS_LABELS = {
  confirmed: "Confirmed",
  checked_in: "Checked in",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  no_show: "No show",
};

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.success) {
    throw new Error(
      data?.message ||
        (response.status === 401
          ? "Please log in again."
          : "Request failed. Check that the backend is running.")
    );
  }

  return data;
}

// Read all pages so dropdowns are not limited to the first 100 records.
async function loadAll(path, key, signal) {
  const records = new Map();
  let page = 1;
  let pages = 1;

  do {
    const separator = path.includes("?") ? "&" : "?";
    const data = await api(
      `${path}${separator}page=${page}&limit=100`,
      { signal }
    );

    if (!Array.isArray(data[key])) {
      throw new Error("The server returned an unexpected response.");
    }

    data[key].forEach((item) => records.set(item._id, item));
    pages = data.pagination?.pages || 0;
    page += 1;
  } while (page <= pages);

  return [...records.values()];
}

function money(amount, currency = "PKR") {
  if (!Number.isSafeInteger(amount)) return "—";

  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
  }).format(amount / 100);
}

function todayIn(timezone = "Asia/Karachi") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

export default function ReservationManagement() {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [hotels, setHotels] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [reservations, setReservations] = useState([]);

  const [hotelLoading, setHotelLoading] = useState(true);
  const [roomLoading, setRoomLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);

  const [hotelError, setHotelError] = useState("");
  const [roomError, setRoomError] = useState("");
  const [listError, setListError] = useState("");
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");

  const [filterHotel, setFilterHotel] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    total: 0,
    pages: 0,
  });

  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const mutationLock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();

    setHotelLoading(true);
    setHotelError("");

    loadAll("/hotels", "hotels", controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setHotels(items);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setHotelError(error.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setHotelLoading(false);
      });

    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();

    setRooms([]);
    setRoomError("");

    if (!form.hotel) {
      setRoomLoading(false);
      return () => controller.abort();
    }

    setRoomLoading(true);

    loadAll(
      `/rooms?hotel=${encodeURIComponent(form.hotel)}&active=true`,
      "rooms",
      controller.signal
    )
      .then((items) => {
        if (!controller.signal.aborted) {
          setRooms(items.filter((room) => room.status !== "maintenance"));
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setRoomError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRoomLoading(false);
      });

    return () => controller.abort();
  }, [form.hotel, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({
      page: String(page),
      limit: "10",
    });

    if (filterHotel) query.set("hotel", filterHotel);
    if (filterStatus) query.set("status", filterStatus);

    setListLoading(true);
    setListError("");

    api(`/reservations?${query}`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;

        const lastPage = Math.max(1, data.pagination.pages);
        if (page > lastPage) {
          setPage(lastPage);
          return;
        }

        setReservations(data.reservations);
        setPagination(data.pagination);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setListError(error.message);
          setReservations([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });

    return () => controller.abort();
  }, [page, filterHotel, filterStatus, refresh]);

  const selectedHotel = hotels.find((hotel) => hotel._id === form.hotel);
  const selectedRoom = rooms.find((room) => room._id === form.room);

  const nights =
    form.checkInDate && form.checkOutDate
      ? (Date.parse(`${form.checkOutDate}T00:00:00Z`) -
          Date.parse(`${form.checkInDate}T00:00:00Z`)) /
        86400000
      : 0;

  function change(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "hotel" ? { room: "" } : {}),
    }));
  }

  async function createReservation(event) {
    event.preventDefault();
    if (mutationLock.current) return;

    setActionError("");
    setSuccess("");

    if (!selectedHotel?.isActive || !selectedRoom) {
      setActionError("Please select an active hotel and room.");
      return;
    }

    if (!Number.isInteger(nights) || nights < 1 || nights > 365) {
      setActionError("Select a stay between 1 and 365 nights.");
      return;
    }

    if (form.checkInDate < todayIn(selectedHotel.timezone)) {
      setActionError("Check-in date cannot be in the past.");
      return;
    }

    const guestCount = Number(form.numberOfGuests);

    if (
      !Number.isInteger(guestCount) ||
      guestCount < 1 ||
      guestCount > selectedRoom.capacity
    ) {
      setActionError(
        `This room allows between 1 and ${selectedRoom.capacity} guests.`
      );
      return;
    }

    mutationLock.current = true;
    setSaving(true);

    try {
      const data = await api("/reservations", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          guestName: form.guestName.trim(),
          guestEmail: form.guestEmail.trim(),
          guestPhone: form.guestPhone.trim(),
          specialRequests: form.specialRequests.trim(),
          numberOfGuests: guestCount,
        }),
      });

      setSuccess(`Booking created: ${data.reservation.bookingReference}`);
      setForm({ ...EMPTY_FORM, hotel: form.hotel });
      setFilterHotel(form.hotel);
      setFilterStatus("");
      setPage(1);
      setRefresh((value) => value + 1);
    } catch (error) {
      setActionError(error.message);
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  }

  async function cancelReservation(event) {
    event.preventDefault();
    if (!cancelTarget || mutationLock.current) return;

    mutationLock.current = true;
    setCancelling(true);
    setActionError("");
    setSuccess("");

    try {
      await api(`/reservations/${cancelTarget._id}/cancel`, {
        method: "PATCH",
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });

      setSuccess(`Booking ${cancelTarget.bookingReference} cancelled.`);
      setCancelTarget(null);
      setCancelReason("");
      setRefresh((value) => value + 1);
    } catch (error) {
      setActionError(error.message);
    } finally {
      mutationLock.current = false;
      setCancelling(false);
    }
  }

  const busy = saving || cancelling;

  return (
    <section className="rsv-page">
      <style>{`
        .rsv-page { color:#20392f; }
        .rsv-page * { box-sizing:border-box; }
        .rsv-heading,.rsv-toolbar,.rsv-card-top,.rsv-pagination {
          display:flex; align-items:center; justify-content:space-between;
          gap:16px; flex-wrap:wrap;
        }
        .rsv-heading { margin-bottom:24px; }
        .rsv-page h2 { margin:0 0 8px; font-size:28px; color:#173d2f; }
        .rsv-page h3 { margin:0 0 8px; font-size:20px; }
        .rsv-page p { margin:0; color:#64736b; line-height:1.6; }
        .rsv-panel {
          background:#fff; padding:26px; border:1px solid #e0e7df;
          border-radius:20px; margin-bottom:24px;
          box-shadow:0 8px 30px #173d2f05;
        }
        .rsv-grid {
          display:grid; grid-template-columns:repeat(2,minmax(0,1fr));
          gap:18px; margin-top:24px;
        }
        .rsv-page label {
          display:flex; flex-direction:column; gap:8px;
          font-size:13px; font-weight:600; color:#354d40;
          margin:0;
        }
        .rsv-page input,.rsv-page select,.rsv-page textarea {
          width:100%; padding:12px 14px; border:1px solid #d7e0d6;
          border-radius:10px; background:#fafcf9; color:#20392f;
          font:inherit; min-height:46px; margin:0;
        }
        .rsv-page textarea { resize:vertical; min-height:90px; }
        .rsv-page input:focus,.rsv-page select:focus,.rsv-page textarea:focus {
          outline:2px solid #427855; outline-offset:2px;
        }
        .rsv-wide { grid-column:1/-1; }
        .rsv-page button {
          font:inherit; cursor:pointer; border-radius:10px;
          padding:11px 17px; font-weight:600; border:1px solid #d5dfd5;
          background:#fff; color:#234735;
        }
        .rsv-page button:focus-visible {
          outline:3px solid #af893d; outline-offset:3px;
        }
        .rsv-page button:disabled { opacity:.55; cursor:not-allowed; }
        .rsv-page .rsv-primary {
          background:#194632; color:white; border-color:#194632;
        }
        .rsv-page .rsv-danger {
          color:#9b302b; background:#fff5f3; border-color:#f0ccc7;
        }
        .rsv-page fieldset { border:0; padding:0; margin:0; min-width:0; }
        .rsv-note {
          padding:14px 16px; border-radius:12px; background:#f1f5ee;
          color:#3b5d46; font-size:13px; line-height:1.7;
        }
        .rsv-message { padding:14px 18px; border-radius:12px; margin-bottom:18px; }
        .rsv-error { background:#fff0ee; color:#972e29; }
        .rsv-success { background:#eaf5e9; color:#285a33; }
        .rsv-filters { display:flex; gap:12px; flex-wrap:wrap; }
        .rsv-filters label { min-width:170px; flex:1; }
        .rsv-card { border:1px solid #e0e7df; border-radius:15px; padding:20px; margin-top:16px; }
        .rsv-reference { font-size:12px; color:#6b786d; overflow-wrap:anywhere; }
        .rsv-card h4 { font-size:18px; margin:6px 0; }
        .rsv-badge { padding:6px 11px; border-radius:20px; background:#edf2e9; font-size:12px; font-weight:700; }
        .rsv-badge.cancelled,.rsv-badge.no_show { background:#fcece8; color:#943b32; }
        .rsv-badge.checked_in { background:#e5efff; color:#245699; }
        .rsv-details { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; margin:20px 0; }
        .rsv-details dt { color:#718074; font-size:12px; margin-bottom:6px; }
        .rsv-details dd { margin:0; font-size:14px; overflow-wrap:anywhere; }
        .rsv-pagination { margin-top:22px; font-size:13px; }
        .rsv-pagination div { display:flex; gap:10px; }
        .rsv-empty { text-align:center; padding:36px 15px; }
        .rsv-cancel { border-color:#ebc8be; background:#fffaf8; }
        .rsv-actions { display:flex; gap:10px; margin-top:18px; flex-wrap:wrap; }
        @media(max-width:650px) {
          .rsv-grid,.rsv-details { grid-template-columns:1fr; }
          .rsv-panel { padding:18px; }
          .rsv-page h2 { font-size:24px; }
          .rsv-filters { width:100%; }
        }
      `}</style>

      <div className="rsv-heading">
        <div>
          <h2>Reservations</h2>
          <p>Plan each arrival and manage your guest bookings.</p>
        </div>
        <button
          type="button"
          disabled={busy || listLoading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh
        </button>
      </div>

      {success && (
        <div className="rsv-message rsv-success" role="status">
          {success}
        </div>
      )}

      {actionError && (
        <div className="rsv-message rsv-error" role="alert">
          {actionError}
        </div>
      )}

      <div className="rsv-panel">
        <h3>Create a reservation</h3>
        <p>Select a property, room and dates, then enter guest details.</p>

        {hotelError && <p role="alert">{hotelError}</p>}
        {roomError && <p role="alert">{roomError}</p>}

        <form onSubmit={createReservation}>
          <fieldset disabled={busy}>
            <div className="rsv-grid">
              <label>
                Hotel
                <select
                  name="hotel"
                  value={form.hotel}
                  onChange={change}
                  required
                  disabled={hotelLoading || busy}
                >
                  <option value="">
                    {hotelLoading ? "Loading hotels..." : "Select hotel"}
                  </option>
                  {hotels.filter((hotel) => hotel.isActive).map((hotel) => (
                    <option key={hotel._id} value={hotel._id}>
                      {hotel.name} — {hotel.city}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Room
                <select
                  name="room"
                  value={form.room}
                  onChange={change}
                  required
                  disabled={!form.hotel || roomLoading || busy}
                >
                  <option value="">
                    {roomLoading ? "Loading rooms..." : "Select room"}
                  </option>
                  {rooms.map((room) => (
                    <option key={room._id} value={room._id}>
                      {room.roomNumber} · {room.roomType} ·{" "}
                      {money(room.pricePerNightMinor, selectedHotel?.currency)}
                      /night
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Guest name
                <input
                  name="guestName"
                  value={form.guestName}
                  onChange={change}
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="Full name"
                />
              </label>

              <label>
                Phone number
                <input
                  name="guestPhone"
                  type="tel"
                  value={form.guestPhone}
                  onChange={change}
                  required
                  maxLength={25}
                  placeholder="03XX XXXXXXX"
                />
              </label>

              <label>
                Email — optional
                <input
                  name="guestEmail"
                  type="email"
                  value={form.guestEmail}
                  onChange={change}
                  maxLength={254}
                  placeholder="guest@example.com"
                />
              </label>

              <label>
                Number of guests
                <input
                  name="numberOfGuests"
                  type="number"
                  value={form.numberOfGuests}
                  onChange={change}
                  required
                  min={1}
                  max={selectedRoom?.capacity || 20}
                  step={1}
                />
              </label>

              <label>
                Check-in date
                <input
                  name="checkInDate"
                  type="date"
                  value={form.checkInDate}
                  onChange={change}
                  required
                  min={todayIn(selectedHotel?.timezone)}
                />
              </label>

              <label>
                Check-out date
                <input
                  name="checkOutDate"
                  type="date"
                  value={form.checkOutDate}
                  onChange={change}
                  required
                  min={form.checkInDate || todayIn(selectedHotel?.timezone)}
                />
              </label>

              <label className="rsv-wide">
                Special requests — optional
                <textarea
                  name="specialRequests"
                  value={form.specialRequests}
                  onChange={change}
                  maxLength={2000}
                  placeholder="Arrival notes or guest preferences"
                />
              </label>

              <div className="rsv-note rsv-wide">
                {selectedRoom && (
                  <>
                    Room capacity: {selectedRoom.capacity} guests.
                    {" "}Nightly rate:{" "}
                    {money(
                      selectedRoom.pricePerNightMinor,
                      selectedHotel?.currency
                    )}.
                    {" "}
                  </>
                )}
                {nights > 0 && nights <= 365 && (
                  <strong>{nights} night(s). </strong>
                )}
                Date availability is checked when you create the booking.
                The saved booking will show the final total including tax.
              </div>

              <div className="rsv-wide">
                <button
                  className="rsv-primary"
                  type="submit"
                  disabled={
                    busy ||
                    hotelLoading ||
                    roomLoading ||
                    !selectedRoom ||
                    Boolean(hotelError || roomError)
                  }
                >
                  {saving ? "Creating reservation..." : "Create reservation"}
                </button>
              </div>
            </div>
          </fieldset>
        </form>
      </div>

      {cancelTarget && (
        <div className="rsv-panel rsv-cancel">
          <h3>Cancel reservation?</h3>
          <p>
            {cancelTarget.guestName} · {cancelTarget.bookingReference}
          </p>
          <form onSubmit={cancelReservation}>
            <label style={{ marginTop: 16 }}>
              Cancellation reason — optional
              <textarea
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                maxLength={500}
                disabled={busy}
              />
            </label>
            <div className="rsv-actions">
              <button className="rsv-danger" type="submit" disabled={busy}>
                {cancelling ? "Cancelling..." : "Confirm cancellation"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCancelTarget(null)}
              >
                Keep reservation
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="rsv-panel">
        <div className="rsv-toolbar">
          <div>
            <h3>Booking list</h3>
            <p>
              {listLoading
                ? "Loading reservations..."
                : listError
                  ? "List unavailable"
                  : `${pagination.total} reservation(s)`}
            </p>
          </div>

          <div className="rsv-filters">
            <label>
              Hotel filter
              <select
                value={filterHotel}
                onChange={(event) => {
                  setFilterHotel(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All hotels</option>
                {hotels.map((hotel) => (
                  <option key={hotel._id} value={hotel._id}>
                    {hotel.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Status filter
              <select
                value={filterStatus}
                onChange={(event) => {
                  setFilterStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {listError && (
          <div className="rsv-message rsv-error" role="alert">
            {listError}
          </div>
        )}

        {listLoading ? (
          <p className="rsv-empty" role="status">Loading booking list...</p>
        ) : !listError && reservations.length === 0 ? (
          <div className="rsv-empty">
            <h3>No reservations found</h3>
            <p>Create a booking above or change the filters.</p>
          </div>
        ) : (
          reservations.map((reservation) => (
            <article className="rsv-card" key={reservation._id}>
              <div className="rsv-card-top">
                <div>
                  <div className="rsv-reference">
                    {reservation.bookingReference}
                  </div>
                  <h4>{reservation.guestName}</h4>
                  <p>
                    {reservation.hotel?.name || "Hotel unavailable"}
                    {" · Room "}
                    {reservation.room?.roomNumber || "—"}
                  </p>
                </div>
                <span className={`rsv-badge ${reservation.status}`}>
                  {STATUS_LABELS[reservation.status] || reservation.status}
                </span>
              </div>

              <dl className="rsv-details">
                <div>
                  <dt>Check-in / Check-out</dt>
                  <dd>
                    {reservation.checkInDate} → {reservation.checkOutDate}
                  </dd>
                </div>
                <div>
                  <dt>Stay</dt>
                  <dd>
                    {reservation.nights} night(s) ·{" "}
                    {reservation.numberOfGuests} guest(s)
                  </dd>
                </div>
                <div>
                  <dt>Total including tax</dt>
                  <dd>
                    <strong>
                      {money(reservation.totalMinor, reservation.currency)}
                    </strong>
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
                  <dt>Tax</dt>
                  <dd>
                    {money(reservation.taxAmountMinor, reservation.currency)}
                  </dd>
                </div>
              </dl>

              {reservation.specialRequests && (
                <p>Requests: {reservation.specialRequests}</p>
              )}

              {reservation.cancellationReason && (
                <p>Cancellation reason: {reservation.cancellationReason}</p>
              )}

              {reservation.status === "confirmed" && (
                <div className="rsv-actions">
                  <button
                    type="button"
                    className="rsv-danger"
                    disabled={busy}
                    onClick={() => {
                      setCancelTarget(reservation);
                      setCancelReason("");
                      setActionError("");
                      setSuccess("");
                    }}
                  >
                    Cancel reservation
                  </button>
                </div>
              )}
            </article>
          ))
        )}

        {!listError && (
          <div className="rsv-pagination">
            <span>
              Page {page} of {Math.max(1, pagination.pages)}
            </span>
            <div>
              <button
                type="button"
                disabled={listLoading || page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={listLoading || page >= pagination.pages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}