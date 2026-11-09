import { useEffect, useState } from "react";

const emptyForm = {
  hotel: "",
  roomNumber: "",
  floor: "Ground",
  roomType: "standard",
  bedType: "double",
  numberOfBeds: "1",
  capacity: "2",
  price: "",
};

const roomTypes = [
  "standard",
  "deluxe",
  "executive",
  "suite",
  "presidential",
];

const bedTypes = ["single", "double", "twin", "queen", "king"];

async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  const data = await response.json().catch(() => ({
    message: "Unable to read the server response.",
  }));

  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Your session has expired. Please sign out and log in again."
        : data.message || "Request failed."
    );
  }

  return data;
}

function title(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatPrice(room) {
  const amount = room.pricePerNightMinor / 100;
  const currency = room.hotel?.currency;

  if (!currency) {
    return `${amount.toFixed(2)} — currency unavailable`;
  }

  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export default function RoomManagement() {
  const [hotels, setHotels] = useState([]);
  const [hotelLoading, setHotelLoading] = useState(true);
  const [hotelError, setHotelError] = useState("");
  const [hotelRefresh, setHotelRefresh] = useState(0);

  const [rooms, setRooms] = useState([]);
  const [page, setPage] = useState(1);
  const [filterHotel, setFilterHotel] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pagination, setPagination] = useState({
    total: 0,
    pages: 0,
    page: 1,
  });

  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedHotel = hotels.find((hotel) => hotel._id === form.hotel);

  useEffect(() => {
    const controller = new AbortController();

    async function loadHotels() {
      setHotelLoading(true);
      setHotelError("");

      try {
        const allHotels = [];
        let currentPage = 1;
        let pages = 1;

        do {
          const data = await request(
            `/hotels?page=${currentPage}&limit=100`,
            { signal: controller.signal }
          );

          allHotels.push(...data.hotels);
          pages = data.pagination.pages;
          currentPage += 1;
        } while (
          currentPage <= pages &&
          !controller.signal.aborted
        );

        if (!controller.signal.aborted) {
          const uniqueHotels = [
            ...new Map(allHotels.map((hotel) => [hotel._id, hotel])).values(),
          ];

          setHotels(uniqueHotels);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setHotelError(error.message);
        }
      } finally {
        if (!controller.signal.aborted) setHotelLoading(false);
      }
    }

    loadHotels();

    return () => controller.abort();
  }, [hotelRefresh]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadRooms() {
      setLoading(true);
      setLoadError("");

      const query = new URLSearchParams({
        page: String(page),
        limit: "10",
      });

      if (filterHotel) query.set("hotel", filterHotel);

      try {
        const data = await request(`/rooms?${query}`, {
          signal: controller.signal,
        });

        if (!controller.signal.aborted) {
          setRooms(data.rooms);
          setPagination(data.pagination);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error.message);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadRooms();

    return () => controller.abort();
  }, [page, filterHotel, refresh]);

  function updateField(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: name === "roomNumber" ? value.toUpperCase() : value,
    }));
  }

  async function saveRoom(event) {
    event.preventDefault();

    if (saving) return;

    setSaveError("");
    setNotice("");

    if (!selectedHotel?.isActive) {
      setSaveError("Please select an active hotel.");
      return;
    }

    if (!form.roomNumber.trim()) {
      setSaveError("Please enter a room number.");
      return;
    }

    // Convert the typed decimal amount to integer minor units.
    const priceText = form.price.trim();

    if (!/^\d+(\.\d{1,2})?$/.test(priceText)) {
      setSaveError("Enter a valid price with up to two decimal places.");
      return;
    }

    const [whole, fraction = ""] = priceText.split(".");
    const pricePerNightMinor =
      Number(whole) * 100 + Number(fraction.padEnd(2, "0"));

    if (!Number.isSafeInteger(pricePerNightMinor)) {
      setSaveError("The entered price is too large.");
      return;
    }

    const numberOfBeds = Number(form.numberOfBeds);
    const capacity = Number(form.capacity);

    if (
      !Number.isInteger(numberOfBeds) ||
      numberOfBeds < 1 ||
      numberOfBeds > 10 ||
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 20
    ) {
      setSaveError("Beds must be 1–10 and guest capacity must be 1–20.");
      return;
    }

    setSaving(true);

    try {
      const data = await request("/rooms", {
        method: "POST",
        body: JSON.stringify({
          hotel: form.hotel,
          roomNumber: form.roomNumber.trim(),
          floor: form.floor.trim(),
          roomType: form.roomType,
          bedType: form.bedType,
          numberOfBeds,
          capacity,
          pricePerNightMinor,
        }),
      });

      setNotice(`Room ${data.room.roomNumber} was created successfully.`);
      setForm({ ...emptyForm, hotel: form.hotel });
      setFilterHotel(form.hotel);
      setPage(1);
      setRefresh((value) => value + 1);
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rm-page">
      <style>{`
        .rm-page { color: #284332; }
        .rm-heading {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 20px;
          margin-bottom: 25px;
        }
        .rm-page h1 {
          font: 33px Georgia, serif;
          margin: 0 0 10px;
        }
        .rm-page h2 {
          font: 23px Georgia, serif;
          margin: 0 0 20px;
        }
        .rm-heading p, .rm-note {
          font-size: 12px;
          line-height: 1.7;
          color: #75816d;
          margin: 0;
        }
        .rm-total {
          padding: 15px 20px;
          background: #e6ecde;
          border-radius: 12px;
          min-width: 110px;
          text-align: center;
        }
        .rm-total strong { display: block; font-size: 28px; }
        .rm-total span { font-size: 11px; color: #67795c; }
        .rm-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.3fr) minmax(300px, 1fr);
          gap: 22px;
          align-items: start;
        }
        .rm-card {
          background: #fff;
          border: 1px solid #e0e6d9;
          border-radius: 16px;
          padding: 23px;
          min-width: 0;
        }
        .rm-page button {
          border: 1px solid #dbe3d3;
          border-radius: 8px;
          background: #edf2e6;
          color: #345338;
          padding: 10px 14px;
          font-size: 12px;
        }
        .rm-page button:disabled { opacity: .55; cursor: not-allowed; }
        .rm-page label {
          display: block;
          font-size: 12px;
          color: #40533b;
          font-weight: 600;
          margin: 0;
        }
        .rm-page input, .rm-page select {
          display: block;
          width: 100%;
          min-width: 0;
          margin-top: 8px;
          border: 1px solid #dce4d3;
          border-radius: 8px;
          padding: 11px 12px;
          background: #fcfdf9;
          color: #304c35;
          font: inherit;
          font-size: 13px;
        }
        .rm-page fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
        .rm-fields {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 17px;
        }
        .rm-wide { grid-column: 1 / -1; }
        .rm-page .rm-save {
          width: 100%;
          background: #244e35;
          color: #fff;
          border: 0;
          padding: 14px;
          margin-top: 20px;
        }
        .rm-toolbar {
          display: flex;
          gap: 12px;
          align-items: flex-end;
          margin-bottom: 22px;
        }
        .rm-toolbar label { flex: 1; }
        .rm-message {
          padding: 13px 15px;
          border-radius: 9px;
          font-size: 12px;
          line-height: 1.7;
          margin-bottom: 18px;
        }
        .rm-success { color: #35613d; background: #e6f1e3; }
        .rm-error { color: #8d4331; background: #fff0e9; }
        .rm-empty {
          text-align: center;
          padding: 35px 16px;
          border: 1px dashed #dce3d3;
          border-radius: 10px;
          color: #708065;
          font-size: 13px;
          line-height: 1.8;
        }
        .rm-room {
          border-top: 1px solid #e9ede3;
          padding: 18px 0;
        }
        .rm-room-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }
        .rm-room h3 { font-size: 16px; margin: 0 0 6px; }
        .rm-room p {
          font-size: 12px;
          line-height: 1.7;
          color: #74816b;
          margin: 6px 0;
        }
        .rm-status {
          background: #edf1e6;
          color: #5f7450;
          padding: 5px 8px;
          border-radius: 6px;
          font-size: 10px;
          text-transform: capitalize;
          white-space: nowrap;
        }
        .rm-price {
          font-size: 16px;
          font-weight: 700;
          color: #34573c;
          margin-top: 13px;
        }
        .rm-price small {
          font-size: 10px;
          color: #79876e;
          font-weight: 400;
        }
        .rm-pagination {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          border-top: 1px solid #e9ede3;
          padding-top: 18px;
          font-size: 11px;
        }
        .rm-form-note { margin-top: 15px; }
        @media (max-width: 1150px) {
          .rm-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 520px) {
          .rm-fields { grid-template-columns: 1fr; }
          .rm-card { padding: 18px; }
          .rm-heading { align-items: flex-start; }
          .rm-page h1 { font-size: 28px; }
          .rm-total { min-width: 85px; padding: 12px; }
        }
      `}</style>

      <div className="rm-heading">
        <div>
          <h1>Room management</h1>
          <p>Manage room inventory and nightly prices for your hotels.</p>
        </div>
        <div className="rm-total">
          <strong>{loading || loadError ? "—" : pagination.total}</strong>
          <span>{filterHotel ? "Filtered rooms" : "Total rooms"}</span>
        </div>
      </div>

      {notice && (
        <div className="rm-message rm-success" role="status">
          {notice}
        </div>
      )}

      {hotelError && (
        <div className="rm-message rm-error" role="alert">
          {hotelError}{" "}
          <button
            type="button"
            disabled={hotelLoading}
            onClick={() => setHotelRefresh((value) => value + 1)}
          >
            Retry hotels
          </button>
        </div>
      )}

      <div className="rm-grid">
        <section className="rm-card" aria-labelledby="room-list-title">
          <h2 id="room-list-title">Your rooms</h2>

          <div className="rm-toolbar">
            <label>
              Filter by hotel
              <select
                value={filterHotel}
                disabled={hotelLoading || saving}
                onChange={(event) => {
                  setFilterHotel(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All hotels</option>
                {hotels.map((hotel) => (
                  <option key={hotel._id} value={hotel._id}>
                    {hotel.name}
                    {hotel.isActive ? "" : " (Inactive)"}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              disabled={loading || saving}
              onClick={() => setRefresh((value) => value + 1)}
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="rm-empty" role="status">
              Loading rooms…
            </div>
          ) : loadError ? (
            <div className="rm-message rm-error" role="alert">
              {loadError}
            </div>
          ) : rooms.length === 0 ? (
            <div className="rm-empty">
              No rooms found. Use the Add Room form to create a room.
            </div>
          ) : (
            <>
              {rooms.map((room) => (
                <article key={room._id} className="rm-room">
                  <div className="rm-room-top">
                    <div>
                      <h3>Room {room.roomNumber}</h3>
                      <p>{room.hotel?.name || "Hotel unavailable"}</p>
                    </div>

                    <span className="rm-status">
                      {room.isActive ? room.status : "Inactive"}
                    </span>
                  </div>

                  <p>
                    {title(room.roomType)} · {title(room.bedType)} bed
                  </p>
                  <p>
                    Floor: {room.floor || "—"} · Beds: {room.numberOfBeds}
                    {" · "}Guests: {room.capacity}
                  </p>

                  <div className="rm-price">
                    {formatPrice(room)} <small>/ night</small>
                  </div>
                </article>
              ))}

              <div className="rm-pagination">
                <button
                  type="button"
                  disabled={page <= 1 || saving}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Previous
                </button>

                <span>
                  {pagination.page} / {pagination.pages}
                </span>

                <button
                  type="button"
                  disabled={page >= pagination.pages || saving}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </section>

        <section className="rm-card" aria-labelledby="add-room-title">
          <h2 id="add-room-title">Add room</h2>

          {hotelLoading ? (
            <div className="rm-empty" role="status">
              Loading hotels…
            </div>
          ) : hotelError ? (
            <p className="rm-note">
              Reload the hotel list before creating a room.
            </p>
          ) : !hotels.some((hotel) => hotel.isActive) ? (
            <div className="rm-empty">
              No active hotels found. Open Hotels in the sidebar and
              create a hotel first.
            </div>
          ) : (
            <form onSubmit={saveRoom}>
              {saveError && (
                <div className="rm-message rm-error" role="alert">
                  {saveError}
                </div>
              )}

              <fieldset disabled={saving}>
                <div className="rm-fields">
                  <label className="rm-wide">
                    Hotel *
                    <select
                      name="hotel"
                      value={form.hotel}
                      onChange={updateField}
                      required
                    >
                      <option value="">Select a hotel</option>
                      {hotels
                        .filter((hotel) => hotel.isActive)
                        .map((hotel) => (
                          <option key={hotel._id} value={hotel._id}>
                            {hotel.name} — {hotel.currency}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label>
                    Room number *
                    <input
                      name="roomNumber"
                      value={form.roomNumber}
                      onChange={updateField}
                      placeholder="101"
                      maxLength={20}
                      required
                    />
                  </label>

                  <label>
                    Floor
                    <input
                      name="floor"
                      value={form.floor}
                      onChange={updateField}
                      maxLength={30}
                    />
                  </label>

                  <label>
                    Room type
                    <select
                      name="roomType"
                      value={form.roomType}
                      onChange={updateField}
                    >
                      {roomTypes.map((type) => (
                        <option key={type} value={type}>
                          {title(type)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Bed type
                    <select
                      name="bedType"
                      value={form.bedType}
                      onChange={updateField}
                    >
                      {bedTypes.map((type) => (
                        <option key={type} value={type}>
                          {title(type)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Number of beds *
                    <input
                      name="numberOfBeds"
                      type="number"
                      min="1"
                      max="10"
                      step="1"
                      value={form.numberOfBeds}
                      onChange={updateField}
                      required
                    />
                  </label>

                  <label>
                    Guest capacity *
                    <input
                      name="capacity"
                      type="number"
                      min="1"
                      max="20"
                      step="1"
                      value={form.capacity}
                      onChange={updateField}
                      required
                    />
                  </label>

                  <label className="rm-wide">
                    Price per night
                    {selectedHotel ? ` (${selectedHotel.currency})` : ""} *
                    <input
                      name="price"
                      type="text"
                      inputMode="decimal"
                      value={form.price}
                      onChange={updateField}
                      placeholder="12500.00"
                      maxLength={16}
                      required
                    />
                  </label>
                </div>

                <p className="rm-note rm-form-note">
                  New rooms start as available. Booking-date availability
                  will be managed through reservations.
                </p>

                <button type="submit" className="rm-save">
                  {saving ? "Saving room…" : "+ Create room"}
                </button>
              </fieldset>
            </form>
          )}
        </section>
      </div>
    </section>
  );
}