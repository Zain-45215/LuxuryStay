import { useEffect, useRef, useState } from "react";
import "./hotel-management.css";

const initialForm = {
  name: "",
  code: "",
  address: "",
  city: "",
  country: "Pakistan",
  phone: "",
  email: "",
  description: "",
  currency: "PKR",
  taxRate: "0",
};

const fieldDefinitions = [
  { name: "name", label: "Hotel name", max: 120, required: true, wide: true },
  { name: "code", label: "Hotel code", max: 20, required: true },
  { name: "city", label: "City", max: 100, required: true },
  { name: "address", label: "Complete address", max: 300, required: true, wide: true },
  { name: "country", label: "Country", max: 100, required: true },
  { name: "phone", label: "Phone", max: 25, type: "tel" },
  { name: "email", label: "Hotel email", max: 254, type: "email", wide: true },
];

async function hotelRequest(path = "", options = {}) {
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
        ? "Your session has expired. Please sign out and log in again."
        : data.message || "Request failed."
    );
  }

  return data;
}

function HotelPhoto({ src, name }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="hm-photo-placeholder">
        <span aria-hidden="true">L</span>
        <small>{src ? "Photo unavailable" : "No photo added"}</small>
      </div>
    );
  }

  return (
    <img
      className="hm-photo"
      src={src}
      alt={name}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default function HotelManagement({
  loggingOut = false,
  logoutError = "",
}) {
  const [hotels, setHotels] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pages: 0,
    total: 0,
  });
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [form, setForm] = useState({ ...initialForm });
  const [editingId, setEditingId] = useState("");
  const [existingImage, setExistingImage] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [imageError, setImageError] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");

  const fileInputRef = useRef(null);
  const formSectionRef = useRef(null);
  const nameInputRef = useRef(null);
  const saveLock = useRef(false);

  useEffect(() => {
    document.title = "LuxuryStay | Hotel Management";

    const controller = new AbortController();

    setLoading(true);
    setLoadError("");

    hotelRequest(`?page=${page}&limit=10`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;

        if (!Array.isArray(data.hotels) || !data.pagination) {
          throw new Error("The hotel list response is incomplete.");
        }

        setHotels(data.hotels);
        setPagination(data.pagination);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setLoadError(error.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [page, refresh]);

  useEffect(() => {
    if (!file) {
      setPreview("");
      return undefined;
    }

    const url = URL.createObjectURL(file);
    setPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  function updateField(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: name === "code" ? value.toUpperCase() : value,
    }));
  }

  function clearSelection() {
    setFile(null);
    setImageError("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function selectImage(event) {
    const selected = event.target.files?.[0];

    setImageError("");

    if (!selected) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type)) {
      clearSelection();
      setImageError("Choose a JPG, PNG or WebP image.");
      return;
    }

    if (!selected.size || selected.size > 5 * 1024 * 1024) {
      clearSelection();
      setImageError("Choose a non-empty image of 5 MB or less.");
      return;
    }

    setFile(selected);
  }

  function resetForm() {
    setEditingId("");
    setForm({ ...initialForm });
    setExistingImage("");
    setSaveError("");
    clearSelection();
  }

  function editHotel(hotel) {
    if (saveLock.current) return;

    const nextForm = {};

    for (const key of Object.keys(initialForm)) {
      nextForm[key] = String(hotel[key] ?? initialForm[key]);
    }

    setForm(nextForm);
    setEditingId(hotel._id);
    setExistingImage(hotel.imageUrl || "");
    setSaveError("");
    setNotice("");
    clearSelection();

    formSectionRef.current?.scrollIntoView({
      behavior: "auto",
      block: "start",
    });
    nameInputRef.current?.focus({ preventScroll: true });
  }

  async function saveHotel(event) {
    event.preventDefault();

    if (saveLock.current || loggingOut) return;

    setSaveError("");
    setNotice("");

    if (imageError) {
      setSaveError("Please correct the image selection first.");
      return;
    }

    const taxRate = Number(form.taxRate);

    if (
      form.taxRate.trim() === "" ||
      !Number.isFinite(taxRate) ||
      taxRate < 0 ||
      taxRate > 100
    ) {
      setSaveError("Tax rate must be between 0 and 100.");
      return;
    }

    const payload = {
      ...Object.fromEntries(
        Object.entries(form).map(([key, value]) => [key, value.trim()])
      ),
      taxRate,
    };

    if (
      payload.name.length < 2 ||
      !payload.address ||
      !payload.city ||
      !payload.country
    ) {
      setSaveError("Enter the hotel name, address, city and country.");
      return;
    }

    if (!/^[A-Z0-9-]{2,20}$/.test(payload.code)) {
      setSaveError("Hotel code must contain 2–20 letters, numbers or hyphens.");
      return;
    }

    saveLock.current = true;
    setSaving(true);

    let detailsSaved = false;

    try {
      const result = await hotelRequest(
        editingId ? `/${editingId}` : "",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!result.hotel?._id) {
        throw new Error("The server did not return the saved hotel.");
      }

      const savedHotel = result.hotel;
      detailsSaved = true;

      // Keep the ID immediately so an image retry updates this hotel.
      setEditingId(savedHotel._id);
      setExistingImage(savedHotel.imageUrl || "");

      if (file) {
        await hotelRequest(`/${savedHotel._id}/image`, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
      }

      setNotice(
        file
          ? `${savedHotel.name}: details and photo saved successfully.`
          : `${savedHotel.name}: details saved successfully.`
      );

      resetForm();
      setPage(1);
    } catch (error) {
      setSaveError(
        detailsSaved
          ? `Hotel details were saved, but the photo upload could not be confirmed. ${error.message} Your form is now editing this hotel; press Save changes to retry.`
          : error.message
      );
    } finally {
      if (detailsSaved) {
        setRefresh((value) => value + 1);
      }

      saveLock.current = false;
      setSaving(false);
    }
  }

  const busy = saving || loggingOut;

  return (
    <section className="hm">
      <div className="hm-heading">
        <div>
          <span className="hm-eyebrow">YOUR PROPERTY COLLECTION</span>
          <h1>Hotel management</h1>
          <p>Distinct places. Their own story, details and photograph.</p>
        </div>

        <div className="hm-total">
          <strong>{loading || loadError ? "—" : pagination.total}</strong>
          <span>Total hotels</span>
        </div>
      </div>

      {logoutError && (
        <div className="hm-alert hm-error" role="alert">
          {logoutError}
        </div>
      )}

      {notice && (
        <div className="hm-alert hm-success" role="status">
          {notice}
        </div>
      )}

      <div className="hm-layout">
        <section className="hm-panel" aria-labelledby="hm-list-title">
          <div className="hm-panel-heading">
            <div>
              <span className="hm-eyebrow">THE COLLECTION</span>
              <h2 id="hm-list-title">Your hotels</h2>
            </div>

            <button
              className="hm-button hm-secondary"
              type="button"
              disabled={loading || busy}
              onClick={() => setRefresh((value) => value + 1)}
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="hm-empty" role="status">Loading hotels…</div>
          ) : loadError ? (
            <div className="hm-alert hm-error" role="alert">
              {loadError}
            </div>
          ) : hotels.length === 0 ? (
            <div className="hm-empty">
              <strong>No hotels on this page</strong>
              <p>Add a property using the hotel form.</p>
            </div>
          ) : (
            <div className="hm-hotel-list">
              {hotels.map((hotel) => (
                <article className="hm-hotel" key={hotel._id}>
                  <div className="hm-image-wrap">
                    <HotelPhoto
                      key={`${hotel.imageUrl || "empty"}-${hotel.isActive}`}
                      src={hotel.isActive ? hotel.imageUrl : ""}
                      name={hotel.name}
                    />

                    <span
                      className={`hm-status ${hotel.isActive ? "" : "is-inactive"}`}
                    >
                      {hotel.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>

                  <div className="hm-hotel-body">
                    <span className="hm-eyebrow">{hotel.code}</span>
                    <h3>{hotel.name}</h3>
                    <p>{hotel.city}, {hotel.country}</p>
                    <p className="hm-address">{hotel.address}</p>

                    {(hotel.phone || hotel.email) && (
                      <p className="hm-contact">
                        {[hotel.phone, hotel.email].filter(Boolean).join(" · ")}
                      </p>
                    )}

                    <div className="hm-tags">
                      <span>{hotel.currency}</span>
                      <span>Tax {hotel.taxRate}%</span>
                      <span>Check-in {hotel.checkInTime}</span>
                      <span>Check-out {hotel.checkOutTime}</span>
                    </div>

                    {!hotel.isActive && (
                      <p className="hm-hint">
                        This property's photo is hidden while the hotel is inactive.
                      </p>
                    )}

                    <button
                      type="button"
                      className="hm-button hm-secondary"
                      onClick={() => editHotel(hotel)}
                      disabled={busy}
                    >
                      Edit hotel & photo ↗
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {!loading && !loadError && (pagination.pages > 1 || page > 1) && (
            <div className="hm-pagination">
              <button
                type="button"
                className="hm-button hm-secondary"
                disabled={page <= 1 || busy}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </button>
              <span>
                Page {page} · {pagination.pages} total
              </span>
              <button
                type="button"
                className="hm-button hm-secondary"
                disabled={page >= pagination.pages || busy}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </button>
            </div>
          )}
        </section>

        <section
          ref={formSectionRef}
          className="hm-panel hm-form-panel"
          aria-labelledby="hm-form-title"
        >
          <div className="hm-panel-heading">
            <div>
              <span className="hm-eyebrow">
                {editingId ? "PROPERTY DETAILS" : "GROW YOUR COLLECTION"}
              </span>
              <h2 id="hm-form-title">
                {editingId ? "Edit hotel" : "Add a hotel"}
              </h2>
            </div>

            {editingId && (
              <button
                type="button"
                className="hm-button hm-secondary"
                disabled={busy}
                onClick={resetForm}
              >
                Cancel
              </button>
            )}
          </div>

          {saveError && (
            <div className="hm-alert hm-error" role="alert">
              {saveError}
            </div>
          )}

          <form onSubmit={saveHotel}>
            <fieldset disabled={busy}>
              <legend className="hm-sr-only">Hotel details and photograph</legend>

              <div className="hm-upload">
                {preview || existingImage ? (
                  <HotelPhoto
                    key={preview || existingImage}
                    src={preview || existingImage}
                    name="Hotel photo preview"
                  />
                ) : (
                  <div className="hm-upload-empty">
                    <span aria-hidden="true">＋</span>
                    <strong>A first impression worth keeping</strong>
                    <p>Choose a photograph of this hotel.</p>
                  </div>
                )}

                <div className="hm-upload-controls">
                  <label htmlFor="hm-photo-input">Hotel photograph</label>
                  <input
                    ref={fileInputRef}
                    id="hm-photo-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={selectImage}
                    aria-describedby="hm-photo-help"
                  />
                  <p id="hm-photo-help">
                    JPG, PNG or WebP · Maximum 5 MB
                  </p>

                  {file && (
                    <button
                      type="button"
                      className="hm-button hm-secondary"
                      onClick={clearSelection}
                    >
                      Clear selected photo
                    </button>
                  )}
                </div>
              </div>

              {imageError && (
                <div className="hm-alert hm-error" role="alert">
                  {imageError}
                </div>
              )}

              <div className="hm-fields">
                {fieldDefinitions.map((field) => (
                  <label
                    className={field.wide ? "hm-wide" : ""}
                    key={field.name}
                  >
                    {field.label}{field.required ? " *" : ""}
                    <input
                      ref={field.name === "name" ? nameInputRef : undefined}
                      name={field.name}
                      type={field.type || "text"}
                      value={form[field.name]}
                      onChange={updateField}
                      maxLength={field.max}
                      minLength={field.name === "name" ? 2 : undefined}
                      required={field.required}
                    />
                  </label>
                ))}

                <label>
                  Currency
                  <select
                    name="currency"
                    value={form.currency}
                    onChange={updateField}
                  >
                    {["PKR", "USD", "EUR", "GBP", "AED"].map((currency) => (
                      <option key={currency} value={currency}>{currency}</option>
                    ))}
                  </select>
                </label>

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

                <label className="hm-wide">
                  About this hotel
                  <textarea
                    name="description"
                    value={form.description}
                    onChange={updateField}
                    maxLength={2000}
                    rows={4}
                    placeholder="Describe the location, atmosphere and guest experience."
                  />
                </label>
              </div>

              <p className="hm-hint">
                {editingId
                  ? "Existing check-in, check-out and timezone settings are preserved."
                  : "New hotels use check-in 14:00, check-out 12:00 and Asia/Karachi timezone."}
              </p>

              <button
                type="submit"
                className="hm-button hm-primary"
                disabled={busy || Boolean(imageError)}
              >
                {saving
                  ? "Saving hotel…"
                  : editingId
                    ? "Save changes ↗"
                    : "Create hotel ↗"}
              </button>
            </fieldset>
          </form>
        </section>
      </div>
    </section>
  );
}