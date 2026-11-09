import { useEffect, useRef, useState } from "react";
import "./settings.css";

const emptyForm = {
  taxRate: "0",
  timezone: "Asia/Karachi",
  checkInTime: "14:00",
  checkOutTime: "12:00",
};

const commonTimezones = [
  "Asia/Karachi",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

function settingsFromHotel(hotel) {
  return {
    taxRate: String(hotel.taxRate ?? 0),
    timezone: hotel.timezone || "Asia/Karachi",
    checkInTime: hotel.checkInTime || "14:00",
    checkOutTime: hotel.checkOutTime || "12:00",
  };
}

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

async function hotelRequest(path, options = {}) {
  const response = await fetch(`/api/hotels${path}`, {
    ...options,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({
    message: "Server response could not be read.",
  }));

  if (!response.ok || data.success === false) {
    throw new Error(
      response.status === 401
        ? "Your session has expired. Please sign in again."
        : data.message || "The request could not be completed."
    );
  }

  return data;
}

export default function SettingsManagement() {
  const [hotels, setHotels] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [listRefresh, setListRefresh] = useState(0);

  const [hotel, setHotel] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [savedForm, setSavedForm] = useState({ ...emptyForm });
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [detailsRefresh, setDetailsRefresh] = useState(0);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");

  const saveLock = useRef(false);

  useEffect(() => {
    document.title = "LuxuryStay | Settings";

    const controller = new AbortController();

    async function loadHotels() {
      setListLoading(true);
      setListError("");

      try {
        let page = 1;
        let pages = 1;
        const collection = [];

        do {
          const data = await hotelRequest(`?page=${page}&limit=100`, {
            signal: controller.signal,
          });

          if (
            !Array.isArray(data.hotels) ||
            !Number.isInteger(data.pagination?.pages) ||
            data.pagination.pages < 0
          ) {
            throw new Error("The hotel list response is incomplete.");
          }

          collection.push(...data.hotels);
          pages = data.pagination.pages;
          page += 1;
        } while (page <= pages);

        if (controller.signal.aborted) return;

        const uniqueHotels = [
          ...new Map(
            collection.map((item) => [item._id, item])
          ).values(),
        ];

        uniqueHotels.sort((a, b) => a.name.localeCompare(b.name));

        setHotels(uniqueHotels);
        setSelectedId((current) =>
          uniqueHotels.some((item) => item._id === current)
            ? current
            : uniqueHotels[0]?._id || ""
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          setListError(error.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setListLoading(false);
        }
      }
    }

    loadHotels();

    return () => controller.abort();
  }, [listRefresh]);

  useEffect(() => {
    if (!selectedId) {
      setHotel(null);
      setDetailsError("");
      setDetailsLoading(false);
      return undefined;
    }

    const controller = new AbortController();

    async function loadSettings() {
      setDetailsLoading(true);
      setDetailsError("");
      setSaveError("");
      setNotice("");
      setHotel(null);

      try {
        const data = await hotelRequest(`/${selectedId}`, {
          signal: controller.signal,
        });

        if (!data.hotel?._id) {
          throw new Error("The hotel settings response is incomplete.");
        }

        if (controller.signal.aborted) return;

        const values = settingsFromHotel(data.hotel);

        setHotel(data.hotel);
        setForm(values);
        setSavedForm(values);
      } catch (error) {
        if (!controller.signal.aborted) {
          setDetailsError(error.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setDetailsLoading(false);
        }
      }
    }

    loadSettings();

    return () => controller.abort();
  }, [selectedId, detailsRefresh]);

  const dirty = Object.keys(emptyForm).some(
    (key) => form[key] !== savedForm[key]
  );

  useEffect(() => {
    if (!dirty && !saving) return undefined;

    function warnBeforeLeaving(event) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);

    return () => {
      window.removeEventListener("beforeunload", warnBeforeLeaving);
    };
  }, [dirty, saving]);

  function changeHotel(event) {
    const nextId = event.target.value;

    if (saveLock.current) return;

    if (
      dirty &&
      !window.confirm(
        "Discard the unsaved settings for this hotel and switch properties?"
      )
    ) {
      return;
    }

    setSelectedId(nextId);
    setSaveError("");
    setNotice("");
  }

  function updateField(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setSaveError("");
    setNotice("");
  }

  function resetChanges() {
    if (saveLock.current) return;

    setForm({ ...savedForm });
    setSaveError("");
    setNotice("");
  }

  async function saveSettings(event) {
    event.preventDefault();

    if (
      saveLock.current ||
      !hotel ||
      detailsLoading ||
      !dirty
    ) {
      return;
    }

    setSaveError("");
    setNotice("");

    const taxRate = Number(form.taxRate);
    const timezone = form.timezone.trim();

    if (
      form.taxRate.trim() === "" ||
      !Number.isFinite(taxRate) ||
      taxRate < 0 ||
      taxRate > 100
    ) {
      setSaveError("Tax rate must be a number between 0 and 100.");
      return;
    }

    if (!timezone || !validTimezone(timezone)) {
      setSaveError(
        "Enter a valid timezone, for example Asia/Karachi."
      );
      return;
    }

    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

    if (
      !timePattern.test(form.checkInTime) ||
      !timePattern.test(form.checkOutTime)
    ) {
      setSaveError("Enter valid check-in and check-out times.");
      return;
    }

    const payload = {
      taxRate,
      timezone,
      checkInTime: form.checkInTime,
      checkOutTime: form.checkOutTime,
    };

    saveLock.current = true;
    setSaving(true);

    try {
      const data = await hotelRequest(`/${hotel._id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!data.hotel?._id) {
        throw new Error(
          "The server did not return the saved settings. Reload the settings to confirm the result."
        );
      }

      const values = settingsFromHotel(data.hotel);

      setHotel(data.hotel);
      setForm(values);
      setSavedForm(values);

      setHotels((previous) =>
        previous.map((item) =>
          item._id === data.hotel._id ? data.hotel : item
        )
      );

      setNotice(`Settings saved for ${data.hotel.name}.`);
    } catch (error) {
      setSaveError(error.message);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  const blocked = listLoading || detailsLoading || saving;
  const ready =
    !listLoading &&
    !listError &&
    !detailsLoading &&
    !detailsError &&
    hotel;

  return (
    <section className="st">
      <div className="st-heading">
        <div>
          <span className="st-eyebrow">PROPERTY PREFERENCES</span>
          <h1>Settings</h1>
          <p>
            Manage the operating preferences for each LuxuryStay hotel.
          </p>
        </div>

        <span className="st-admin-badge">
          Administrator access
        </span>
      </div>

      <section className="st-selector-panel">
        <div>
          <span className="st-eyebrow">SELECT A PROPERTY</span>
          <h2>One hotel. Its own settings.</h2>
          <p>
            Changes apply only to the property selected below.
          </p>
        </div>

        <label className="st-property-select">
          Hotel
          <select
            value={selectedId}
            onChange={changeHotel}
            disabled={blocked || Boolean(listError) || !hotels.length}
          >
            {!hotels.length && (
              <option value="">
                {listLoading ? "Loading hotels…" : "No hotels available"}
              </option>
            )}

            {hotels.map((item) => (
              <option key={item._id} value={item._id}>
                {item.name} · {item.code}
                {!item.isActive ? " · Inactive" : ""}
              </option>
            ))}
          </select>
        </label>
      </section>

      {listLoading && (
        <div className="st-empty" role="status">
          Loading your properties…
        </div>
      )}

      {!listLoading && listError && (
        <div className="st-alert st-error" role="alert">
          <p>{listError}</p>
          <button
            type="button"
            className="st-button st-secondary"
            onClick={() => setListRefresh((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      )}

      {!listLoading && !listError && hotels.length === 0 && (
        <div className="st-empty">
          <strong>No hotels registered yet</strong>
          <p>
            Add a property from Hotel Management, then return here
            to configure its settings.
          </p>
          <button
            type="button"
            className="st-button st-secondary"
            onClick={() => setListRefresh((value) => value + 1)}
          >
            Refresh hotel list
          </button>
        </div>
      )}

      {!listLoading && !listError && detailsLoading && (
        <div className="st-empty" role="status">
          Loading property settings…
        </div>
      )}

      {!listLoading && !listError && detailsError && (
        <div className="st-alert st-error" role="alert">
          <p>{detailsError}</p>
          <button
            type="button"
            className="st-button st-secondary"
            onClick={() => setDetailsRefresh((value) => value + 1)}
          >
            Reload settings
          </button>
        </div>
      )}

      {ready && (
        <>
          <div className="st-property-banner">
            <div className="st-monogram" aria-hidden="true">L</div>

            <div className="st-property-name">
              <span>{hotel.code}</span>
              <h2>{hotel.name}</h2>
              <p>{hotel.city}, {hotel.country}</p>
            </div>

            <span
              className={`st-status ${
                hotel.isActive ? "" : "st-inactive"
              }`}
            >
              {hotel.isActive ? "Active property" : "Inactive property"}
            </span>
          </div>

          {notice && (
            <div className="st-alert st-success" role="status">
              {notice}
            </div>
          )}

          {saveError && (
            <div className="st-alert st-error" role="alert">
              {saveError}
            </div>
          )}

          <form onSubmit={saveSettings}>
            <fieldset disabled={saving}>
              <legend className="st-sr-only">
                Settings for {hotel.name}
              </legend>

              <div className="st-grid">
                <section
                  className="st-panel"
                  aria-labelledby="st-stay-title"
                >
                  <div className="st-section-heading">
                    <span className="st-section-number" aria-hidden="true">
                      01
                    </span>
                    <div>
                      <span className="st-eyebrow">ARRIVALS & DEPARTURES</span>
                      <h2 id="st-stay-title">Stay timings</h2>
                    </div>
                  </div>

                  <p className="st-description">
                    Set the hotel's standard arrival and departure times.
                    Check-out is normally earlier in the day than check-in.
                  </p>

                  <div className="st-fields">
                    <label>
                      Check-in time
                      <input
                        type="time"
                        name="checkInTime"
                        value={form.checkInTime}
                        onChange={updateField}
                        step="60"
                        required
                      />
                    </label>

                    <label>
                      Check-out time
                      <input
                        type="time"
                        name="checkOutTime"
                        value={form.checkOutTime}
                        onChange={updateField}
                        step="60"
                        required
                      />
                    </label>
                  </div>

                  <div className="st-information">
                    These are property preferences. They do not
                    automatically check guests in or out.
                  </div>
                </section>

                <section
                  className="st-panel"
                  aria-labelledby="st-tax-title"
                >
                  <div className="st-section-heading">
                    <span className="st-section-number" aria-hidden="true">
                      02
                    </span>
                    <div>
                      <span className="st-eyebrow">PROPERTY CHARGES</span>
                      <h2 id="st-tax-title">Tax configuration</h2>
                    </div>
                  </div>

                  <p className="st-description">
                    Enter the tax percentage applicable to this property.
                  </p>

                  <div className="st-fields">
                    <label>
                      Tax rate (%)
                      <input
                        type="number"
                        name="taxRate"
                        value={form.taxRate}
                        onChange={updateField}
                        min="0"
                        max="100"
                        step="0.01"
                        required
                      />
                    </label>

                    <div className="st-readonly-field">
                      <span>Property currency</span>
                      <strong>{hotel.currency}</strong>
                    </div>
                  </div>

                  <div className="st-information">
                    Saving updates the hotel tax setting. Existing
                    reservation and invoice amounts are not rewritten
                    by this page.
                  </div>
                </section>

                <section
                  className="st-panel"
                  aria-labelledby="st-timezone-title"
                >
                  <div className="st-section-heading">
                    <span className="st-section-number" aria-hidden="true">
                      03
                    </span>
                    <div>
                      <span className="st-eyebrow">LOCAL TIME</span>
                      <h2 id="st-timezone-title">Hotel timezone</h2>
                    </div>
                  </div>

                  <p className="st-description">
                    Choose the timezone for this hotel's location.
                  </p>

                  <label>
                    Timezone
                    <input
                      name="timezone"
                      value={form.timezone}
                      onChange={updateField}
                      list="st-timezone-options"
                      placeholder="Asia/Karachi"
                      maxLength={100}
                      spellCheck={false}
                      autoComplete="off"
                      required
                      aria-describedby="st-timezone-help"
                    />
                  </label>

                  <datalist id="st-timezone-options">
                    {commonTimezones.map((zone) => (
                      <option key={zone} value={zone} />
                    ))}
                  </datalist>

                  <p id="st-timezone-help" className="st-help">
                    Use a timezone name such as Asia/Karachi or
                    Europe/London. Other valid timezone names are
                    also accepted.
                  </p>
                </section>

                <section
                  className="st-panel st-guide-panel"
                  aria-labelledby="st-guide-title"
                >
                  <span className="st-eyebrow">KEEP EVERYTHING IN PLACE</span>
                  <h2 id="st-guide-title">Other property controls</h2>

                  <dl className="st-guide-list">
                    <div>
                      <dt>Hotel details & photograph</dt>
                      <dd>Manage these in the Hotels page.</dd>
                    </div>

                    <div>
                      <dt>Nightly room prices</dt>
                      <dd>Manage individual rates in the Rooms page.</dd>
                    </div>

                    <div>
                      <dt>Staff accounts & access</dt>
                      <dd>Manage staff in the Staff page.</dd>
                    </div>
                  </dl>

                  <p className="st-help">
                    Currency is displayed for reference. This settings
                    form does not convert existing room prices or bookings.
                  </p>
                </section>
              </div>

              <div className="st-save-bar">
                <div className="st-save-state" role="status">
                  <span
                    className={`st-state-dot ${
                      dirty ? "st-state-unsaved" : ""
                    }`}
                    aria-hidden="true"
                  />
                  {saving
                    ? "Saving your changes…"
                    : dirty
                      ? "You have unsaved changes"
                      : "No unsaved changes"}
                </div>

                <div className="st-save-actions">
                  <button
                    type="button"
                    className="st-button st-secondary"
                    onClick={resetChanges}
                    disabled={saving || !dirty}
                  >
                    Reset changes
                  </button>

                  <button
                    type="submit"
                    className="st-button st-primary"
                    disabled={saving || !dirty}
                  >
                    {saving ? "Saving…" : "Save settings ↗"}
                  </button>
                </div>
              </div>
            </fieldset>
          </form>
        </>
      )}
    </section>
  );
}