import { useEffect, useRef, useState } from "react";

const EMPTY_FORM = {
  name: "",
  phone: "",
  preferences: "",
};

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => null);

  if (response.status === 401) {
    throw new Error("Your session has expired. Please log in again.");
  }

  if (response.status === 403) {
    throw new Error("You do not have permission to manage guests.");
  }

  if (!response.ok || !data?.success) {
    throw new Error(data?.message || "Unable to complete the request.");
  }

  return data;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Karachi",
  }).format(date);
}

function initials(name) {
  return (
    String(name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "G"
  );
}

export default function GuestManagement() {
  const [guests, setGuests] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    active: "",
  });

  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    total: 0,
    pages: 1,
  });

  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [success, setSuccess] = useState("");

  const [editingGuest, setEditingGuest] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const mounted = useRef(false);
  const saveLock = useRef(false);
  const editorRef = useRef(null);
  const nameRef = useRef(null);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadGuests() {
      setLoading(true);
      setListError("");

      const params = new URLSearchParams({
        page: String(page),
        limit: "10",
      });

      if (filters.search) {
        params.set("search", filters.search);
      }

      if (filters.active) {
        params.set("active", filters.active);
      }

      try {
        const data = await apiRequest(`/api/guests?${params}`, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (
          !Array.isArray(data.guests) ||
          !Number.isInteger(data.pagination?.pages) ||
          data.pagination.pages < 1 ||
          !Number.isInteger(data.pagination?.total) ||
          data.pagination.total < 0
        ) {
          throw new Error("The server returned an invalid guest list.");
        }

        if (page > data.pagination.pages) {
          setPage(data.pagination.pages);
          return;
        }

        setGuests(data.guests);
        setPagination({
          total: data.pagination.total,
          pages: data.pagination.pages,
        });
      } catch (error) {
        if (controller.signal.aborted) return;

        setGuests([]);
        setListError(error.message || "Unable to load guests.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadGuests();

    return () => controller.abort();
  }, [page, filters, refresh]);

  useEffect(() => {
    if (!editingGuest) return;

    editorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    nameRef.current?.focus({ preventScroll: true });
  }, [editingGuest]);

  function applySearch(event) {
    event.preventDefault();

    setPage(1);
    setFilters((current) => ({
      ...current,
      search: searchInput.trim(),
    }));
  }

  function changeStatus(event) {
    setPage(1);
    setFilters((current) => ({
      ...current,
      active: event.target.value,
    }));
  }

  function clearFilters() {
    setSearchInput("");
    setFilters({ search: "", active: "" });
    setPage(1);
  }

  function openEditor(guest) {
    if (saveLock.current) return;

    setEditingGuest(guest);
    setForm({
      name: guest.name || "",
      phone: guest.phone || "",
      preferences: guest.preferences || "",
    });

    setFormError("");
    setSuccess("");
  }

  function closeEditor() {
    if (saveLock.current) return;

    setEditingGuest(null);
    setForm(EMPTY_FORM);
    setFormError("");
  }

  function updateForm(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function saveGuest(event) {
    event.preventDefault();

    if (!editingGuest || saveLock.current) return;

    setFormError("");
    setSuccess("");

    const values = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      preferences: form.preferences.trim(),
    };

    if (values.name.length < 2 || values.name.length > 100) {
      setFormError("Name must contain 2 to 100 characters.");
      return;
    }

    if (values.phone.length > 25) {
      setFormError("Phone must not exceed 25 characters.");
      return;
    }

    if (values.preferences.length > 1000) {
      setFormError("Preferences must not exceed 1,000 characters.");
      return;
    }

    // Send only changed fields.
    const updates = {};

    for (const key of Object.keys(values)) {
      if (values[key] !== (editingGuest[key] || "")) {
        updates[key] = values[key];
      }
    }

    if (!Object.keys(updates).length) {
      setFormError("Change a profile detail before saving.");
      return;
    }

    saveLock.current = true;
    setSaving(true);

    try {
      const data = await apiRequest(
        `/api/guests/${editingGuest._id}`,
        {
          method: "PATCH",
          body: JSON.stringify(updates),
        }
      );

      if (!mounted.current) return;

      setSuccess(data.message || "Guest profile updated successfully.");
      setEditingGuest(null);
      setForm(EMPTY_FORM);
      setRefresh((current) => current + 1);
    } catch (error) {
      if (mounted.current) {
        setFormError(error.message || "Unable to update the guest.");
      }
    } finally {
      saveLock.current = false;

      if (mounted.current) {
        setSaving(false);
      }
    }
  }

  return (
    <section className="gm-page" aria-label="Guest management">
      <style>{`
        .gm-page {
          color: #203b30;
          font-family: inherit;
        }

        .gm-page * {
          box-sizing: border-box;
        }

        .gm-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 22px;
        }

        .gm-eyebrow {
          margin: 0 0 7px;
          color: #80672f;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 2px;
          text-transform: uppercase;
        }

        .gm-heading h2 {
          margin: 0 0 7px;
          font-size: clamp(25px, 3vw, 34px);
          letter-spacing: -1px;
        }

        .gm-subtitle {
          margin: 0;
          color: #6a786f;
          font-size: 14px;
          line-height: 1.7;
        }

        .gm-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 42px;
          padding: 10px 17px;
          border: 1px solid #dbe3dc;
          border-radius: 11px;
          background: #fff;
          color: #254736;
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: background .18s ease, border-color .18s ease;
        }

        .gm-button:hover:not(:disabled) {
          background: #edf4ee;
          border-color: #9bb9a5;
        }

        .gm-button-primary {
          background: #194b36;
          border-color: #194b36;
          color: #fff;
        }

        .gm-button-primary:hover:not(:disabled) {
          background: #123b2a;
          border-color: #123b2a;
        }

        .gm-button:disabled {
          opacity: .55;
          cursor: not-allowed;
        }

        .gm-page :is(button, input, select, textarea):focus-visible {
          outline: 3px solid #bb994d;
          outline-offset: 3px;
        }

        .gm-notice {
          margin-bottom: 18px;
          padding: 14px 17px;
          border: 1px solid #dce6dd;
          border-radius: 12px;
          background: #f0f6f0;
          color: #49604e;
          font-size: 13px;
          line-height: 1.7;
        }

        .gm-success {
          border-color: #b5dbc1;
          background: #eaf7ee;
          color: #22633b;
        }

        .gm-error {
          border-color: #edc7c7;
          background: #fff0f0;
          color: #a32e2e;
        }

        .gm-panel {
          margin-bottom: 22px;
          padding: 23px;
          border: 1px solid #e2e7df;
          border-radius: 19px;
          background: #fff;
          box-shadow: 0 8px 30px rgba(27, 58, 38, .035);
        }

        .gm-panel h3 {
          margin: 0 0 6px;
          font-size: 20px;
        }

        .gm-editor {
          scroll-margin-top: 24px;
          border-top: 4px solid #b59650;
        }

        .gm-editor-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 15px;
          margin-bottom: 20px;
        }

        .gm-editor-head p {
          margin: 0;
          color: #6d7b72;
          font-size: 13px;
          overflow-wrap: anywhere;
        }

        .gm-form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
        }

        .gm-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
          color: #365442;
          font-size: 13px;
          font-weight: 700;
        }

        .gm-full {
          grid-column: 1 / -1;
        }

        .gm-input {
          width: 100%;
          min-height: 44px;
          padding: 11px 13px;
          border: 1px solid #dce3da;
          border-radius: 10px;
          background: #fcfdfb;
          color: #243d2f;
          font: inherit;
          font-size: 14px;
          font-weight: 400;
        }

        textarea.gm-input {
          min-height: 115px;
          resize: vertical;
          line-height: 1.6;
        }

        .gm-hint {
          color: #778276;
          font-size: 12px;
          font-weight: 400;
        }

        .gm-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 19px;
        }

        .gm-filters {
          display: grid;
          grid-template-columns: minmax(180px, 1fr) 180px auto auto;
          gap: 13px;
          align-items: end;
        }

        .gm-list-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin: 24px 0 15px;
        }

        .gm-list-heading h3 {
          margin: 0;
          font-size: 18px;
        }

        .gm-count {
          padding: 6px 11px;
          border-radius: 8px;
          background: #eaf0e8;
          color: #436044;
          font-size: 12px;
          font-weight: 700;
        }

        .gm-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .gm-card {
          min-width: 0;
          padding: 22px;
          border: 1px solid #e0e7dd;
          border-radius: 17px;
          background: #fff;
        }

        .gm-card-top {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 19px;
        }

        .gm-avatar {
          display: grid;
          place-items: center;
          flex: 0 0 47px;
          width: 47px;
          height: 47px;
          border-radius: 14px;
          background: #edf1e6;
          color: #325740;
          font-size: 16px;
          font-weight: 800;
        }

        .gm-identity {
          min-width: 0;
          flex: 1;
        }

        .gm-identity h4 {
          margin: 0 0 5px;
          font-size: 16px;
          overflow-wrap: anywhere;
        }

        .gm-identity p {
          margin: 0;
          color: #738075;
          font-size: 12px;
        }

        .gm-badge {
          display: inline-block;
          padding: 5px 9px;
          border-radius: 7px;
          background: #e8f5ec;
          color: #2e7246;
          font-size: 11px;
          font-weight: 800;
        }

        .gm-badge-inactive {
          background: #f1eeeb;
          color: #7b6960;
        }

        .gm-details {
          display: grid;
          gap: 13px;
          margin: 0;
        }

        .gm-details dt {
          margin-bottom: 4px;
          color: #7c877b;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: .5px;
          text-transform: uppercase;
        }

        .gm-details dd {
          margin: 0;
          color: #354c3d;
          font-size: 13px;
          line-height: 1.6;
          overflow-wrap: anywhere;
          white-space: pre-wrap;
        }

        .gm-card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 19px;
          padding-top: 16px;
          border-top: 1px solid #edf0e9;
        }

        .gm-card-footer small {
          color: #7b8578;
          font-size: 11px;
        }

        .gm-empty {
          padding: 45px 20px;
          border: 1px dashed #cdd9cc;
          border-radius: 16px;
          background: #fbfcf8;
          text-align: center;
          color: #6a7a69;
          line-height: 1.8;
        }

        .gm-empty strong {
          display: block;
          color: #36513c;
          font-size: 17px;
        }

        .gm-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 15px;
          margin-top: 22px;
          color: #657461;
          font-size: 13px;
        }

        .gm-pagination-buttons {
          display: flex;
          gap: 9px;
        }

        @media (max-width: 1100px) {
          .gm-filters {
            grid-template-columns: minmax(150px, 1fr) 170px;
          }
        }

        @media (max-width: 650px) {
          .gm-grid,
          .gm-form-grid,
          .gm-filters {
            grid-template-columns: 1fr;
          }

          .gm-heading,
          .gm-pagination {
            align-items: flex-start;
            flex-direction: column;
          }

          .gm-panel,
          .gm-card {
            padding: 18px;
          }

          .gm-card-top {
            flex-wrap: wrap;
          }
        }
      `}</style>

      <div className="gm-heading">
        <div>
          <p className="gm-eyebrow">LuxuryStay Hospitality</p>
          <h2>Guest Management</h2>
          <p className="gm-subtitle">
            Keep guest contact details and preferences up to date.
          </p>
        </div>

        <button
          type="button"
          className="gm-button"
          disabled={loading || saving}
          onClick={() => setRefresh((current) => current + 1)}
        >
          {loading ? "Loading..." : "Refresh guests"}
        </button>
      </div>

      <div className="gm-notice">
        This directory contains registered guest accounts. Guests entered
        only in a reservation will appear here once they have an account.
      </div>

      {success && (
        <div className="gm-notice gm-success" role="status">
          {success}
        </div>
      )}

      {editingGuest && (
        <section
          className="gm-panel gm-editor"
          ref={editorRef}
          aria-labelledby="gm-editor-title"
        >
          <div className="gm-editor-head">
            <div>
              <h3 id="gm-editor-title">Edit guest profile</h3>
              <p>{editingGuest.email}</p>
            </div>

            <button
              type="button"
              className="gm-button"
              onClick={closeEditor}
              disabled={saving}
            >
              Close
            </button>
          </div>

          {formError && (
            <div
              id="gm-form-error"
              className="gm-notice gm-error"
              role="alert"
            >
              {formError}
            </div>
          )}

          <form
            onSubmit={saveGuest}
            aria-busy={saving}
            aria-describedby={formError ? "gm-form-error" : undefined}
          >
            <div className="gm-form-grid">
              <label className="gm-field">
                Full name *
                <input
                  ref={nameRef}
                  className="gm-input"
                  name="name"
                  value={form.name}
                  onChange={updateForm}
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="off"
                  disabled={saving}
                />
              </label>

              <label className="gm-field">
                Phone number
                <input
                  className="gm-input"
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={updateForm}
                  maxLength={25}
                  placeholder="+92 300 1234567"
                  autoComplete="off"
                  disabled={saving}
                />
              </label>

              <label className="gm-field gm-full">
                Guest preferences
                <textarea
                  className="gm-input"
                  name="preferences"
                  value={form.preferences}
                  onChange={updateForm}
                  maxLength={1000}
                  placeholder="Room preferences, dietary requests or other guest preferences..."
                  disabled={saving}
                />
                <span className="gm-hint">
                  {form.preferences.length}/1,000 characters
                </span>
              </label>
            </div>

            <div className="gm-actions">
              <button
                type="submit"
                className="gm-button gm-button-primary"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save changes"}
              </button>

              <button
                type="button"
                className="gm-button"
                onClick={closeEditor}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="gm-panel">
        <form className="gm-filters" onSubmit={applySearch}>
          <label className="gm-field">
            Search guests
            <input
              className="gm-input"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              maxLength={100}
              placeholder="Name, email or phone"
            />
          </label>

          <label className="gm-field">
            Account status
            <select
              className="gm-input"
              value={filters.active}
              onChange={changeStatus}
            >
              <option value="">All accounts</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>

          <button
            type="submit"
            className="gm-button gm-button-primary"
          >
            Search
          </button>

          <button
            type="button"
            className="gm-button"
            onClick={clearFilters}
          >
            Clear
          </button>
        </form>
      </div>

      <div className="gm-list-heading">
        <h3>Guest directory</h3>

        {!loading && !listError && (
          <span className="gm-count">
            {pagination.total}{" "}
            {pagination.total === 1 ? "guest" : "guests"}
          </span>
        )}
      </div>

      {listError && (
        <div className="gm-notice gm-error" role="alert">
          {listError}
          <div className="gm-actions">
            <button
              type="button"
              className="gm-button"
              onClick={() => setRefresh((current) => current + 1)}
            >
              Try again
            </button>
          </div>
        </div>
      )}

      <div aria-busy={loading}>
        {loading ? (
          <div className="gm-empty" role="status">
            <strong>Loading guests...</strong>
            Fetching the latest guest profiles.
          </div>
        ) : !listError && guests.length === 0 ? (
          <div className="gm-empty" role="status">
            <strong>No guests found</strong>
            {filters.search || filters.active
              ? "Try changing your search or account status filter."
              : "Registered guest accounts will appear here."}
          </div>
        ) : !listError ? (
          <div className="gm-grid">
            {guests.map((guest) => (
              <article className="gm-card" key={guest._id}>
                <div className="gm-card-top">
                  <div className="gm-avatar" aria-hidden="true">
                    {initials(guest.name)}
                  </div>

                  <div className="gm-identity">
                    <h4>{guest.name}</h4>
                    <p>Registered guest</p>
                  </div>

                  <span
                    className={`gm-badge ${
                      guest.isActive ? "" : "gm-badge-inactive"
                    }`}
                  >
                    {guest.isActive ? "Active" : "Inactive"}
                  </span>
                </div>

                <dl className="gm-details">
                  <div>
                    <dt>Email address</dt>
                    <dd>{guest.email || "Not provided"}</dd>
                  </div>

                  <div>
                    <dt>Phone number</dt>
                    <dd>{guest.phone || "Not provided"}</dd>
                  </div>

                  <div>
                    <dt>Preferences</dt>
                    <dd>
                      {guest.preferences || "No preferences added yet."}
                    </dd>
                  </div>
                </dl>

                <div className="gm-card-footer">
                  <small>
                    Joined {formatDate(guest.createdAt)}
                  </small>

                  <button
                    type="button"
                    className="gm-button"
                    onClick={() => openEditor(guest)}
                    disabled={saving}
                    aria-label={`Edit profile for ${guest.name}`}
                  >
                    Edit profile
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      {!listError && (
        <div className="gm-pagination">
          <span>
            {loading
              ? "Loading page..."
              : `Page ${page} of ${pagination.pages}`}
          </span>

          <div className="gm-pagination-buttons">
            <button
              type="button"
              className="gm-button"
              disabled={loading || page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous
            </button>

            <button
              type="button"
              className="gm-button"
              disabled={loading || page >= pagination.pages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}