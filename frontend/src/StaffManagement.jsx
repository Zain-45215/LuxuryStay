import { useEffect, useRef, useState } from "react";

const ROLES = [
  "manager",
  "receptionist",
  "housekeeping",
  "maintenance",
];

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  role: "receptionist",
  hotel: "",
  password: "",
};

function label(value = "") {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hotelId(value) {
  return typeof value === "string" ? value : value?._id || "";
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...options.headers,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.success) {
    throw new Error(
      response.status === 401
        ? "Your session has expired. Please log in again."
        : data?.message || "Request failed. Please try again."
    );
  }

  return data;
}

async function loadHotels(signal) {
  const result = [];
  let page = 1;
  let pages = 1;

  do {
    const data = await api(`/hotels?page=${page}&limit=100`, {
      signal,
    });

    result.push(...(data.hotels || []));
    pages = data.pagination?.pages || 1;
    page += 1;
  } while (page <= pages);

  return [...new Map(result.map((hotel) => [hotel._id, hotel])).values()];
}

function validatePassword(password) {
  if (password.length < 12 || !password.trim()) {
    return "Password must contain at least 12 characters.";
  }

  if (new TextEncoder().encode(password).length > 72) {
    return "Password must not exceed 72 UTF-8 bytes.";
  }

  return "";
}

export default function StaffManagement() {
  const [hotels, setHotels] = useState([]);
  const [hotelError, setHotelError] = useState("");
  const [hotelLoading, setHotelLoading] = useState(true);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [refresh, setRefresh] = useState(0);

  const [filters, setFilters] = useState({
    search: "",
    hotel: "",
    role: "",
    active: "",
  });

  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    total: 0,
    pages: 1,
  });

  const [form, setForm] = useState({ ...emptyForm });
  const [editing, setEditing] = useState(null);
  const [action, setAction] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const mutationLock = useRef(false);
  const mounted = useRef(false);
  const formRef = useRef(null);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    setHotelLoading(true);
    setHotelError("");

    loadHotels(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setHotels(items);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setHotelError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setHotelLoading(false);
      });

    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      limit: "10",
    });

    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    setLoading(true);
    setListError("");

    api(`/staff?${params}`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;

        const pages = Math.max(1, data.pagination?.pages || 1);

        if (page > pages) {
          setPage(pages);
          return;
        }

        setStaff(data.staff || []);
        setPagination({
          total: data.pagination?.total || 0,
          pages,
        });
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setStaff([]);
          setListError(err.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [filters, page, refresh]);

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateFilter(name, value) {
    setPage(1);
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function resetForm() {
    setEditing(null);
    setForm({ ...emptyForm });
  }

  function beginEdit(member) {
    if (mutationLock.current) return;

    setError("");
    setSuccess("");
    setAction(null);
    setNewPassword("");
    setEditing(member);

    setForm({
      name: member.name || "",
      email: member.email || "",
      phone: member.phone || "",
      role: member.role,
      hotel: hotelId(member.hotel),
      password: "",
    });

    formRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function openAction(member, type) {
    if (mutationLock.current) return;

    setError("");
    setSuccess("");
    setNewPassword("");
    setAction({ member, type });
  }

  async function mutate(path, method, body, onSuccess) {
    if (mutationLock.current) return;

    mutationLock.current = true;
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const data = await api(path, {
        method,
        body: JSON.stringify(body),
      });

      if (!mounted.current) return;

      onSuccess?.(data);
      setSuccess(data.message || "Changes saved successfully.");
      setRefresh((value) => value + 1);
    } catch (err) {
      if (mounted.current) setError(err.message);
    } finally {
      mutationLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function saveStaff(event) {
    event.preventDefault();
    if (mutationLock.current) return;

    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();

    if (name.length < 2) {
      setError("Please enter a name with at least 2 characters.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    if (!ROLES.includes(form.role)) {
      setError("Please select a valid staff role.");
      return;
    }

    const previousHotel = editing ? hotelId(editing.hotel) : "";
    const hotelChanged = !editing || previousHotel !== form.hotel;

    if (
      hotelChanged &&
      !hotels.some(
        (hotel) => hotel._id === form.hotel && hotel.isActive
      )
    ) {
      setError("Please select an active hotel.");
      return;
    }

    const payload = {
      name,
      email,
      phone: form.phone.trim(),
      role: form.role,
    };

    if (hotelChanged) payload.hotel = form.hotel;

    if (!editing) {
      const passwordError = validatePassword(form.password);

      if (passwordError) {
        setError(passwordError);
        return;
      }

      payload.password = form.password;
    } else {
      // Send changed fields only.
      if (name === editing.name) delete payload.name;
      if (email === editing.email) delete payload.email;
      if (payload.phone === (editing.phone || "")) delete payload.phone;
      if (payload.role === editing.role) delete payload.role;

      if (!Object.keys(payload).length) {
        setError("No changes to save.");
        return;
      }
    }

    mutate(
      editing ? `/staff/${editing._id}` : "/staff",
      editing ? "PATCH" : "POST",
      payload,
      () => resetForm()
    );
  }

  function confirmAction(event) {
    event.preventDefault();
    if (!action || mutationLock.current) return;

    const { member, type } = action;

    if (type === "password") {
      const passwordError = validatePassword(newPassword);

      if (passwordError) {
        setError(passwordError);
        return;
      }

      mutate(
        `/staff/${member._id}/password`,
        "PATCH",
        { password: newPassword },
        () => {
          setAction(null);
          setNewPassword("");
        }
      );

      return;
    }

    mutate(
      `/staff/${member._id}/status`,
      "PATCH",
      { isActive: !member.isActive },
      () => {
        setAction(null);
        if (editing?._id === member._id) resetForm();
      }
    );
  }

  const selectableHotels = hotels.filter(
    (hotel) => hotel.isActive || hotel._id === form.hotel
  );

  return (
    <section className="sm-page">
      <style>{styles}</style>

      <div className="sm-heading">
        <div>
          <span className="sm-eyebrow">LUXURYSTAY TEAM</span>
          <h2>Staff Management</h2>
          <p>Manage staff profiles, hotel assignments and account access.</p>
        </div>

        <button
          type="button"
          className="sm-button sm-secondary"
          disabled={busy || loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh
        </button>
      </div>

      {error && <div className="sm-alert sm-error" role="alert">{error}</div>}
      {success && (
        <div className="sm-alert sm-success" role="status">{success}</div>
      )}
      {hotelError && (
        <div className="sm-alert sm-error" role="alert">
          Could not load hotels: {hotelError}
        </div>
      )}

      <div className="sm-layout">
        <section className="sm-panel sm-editor" ref={formRef}>
          <div className="sm-panel-heading">
            <h3>{editing ? "Edit staff member" : "Add staff member"}</h3>
            <p>
              {editing
                ? "Update profile information and hotel assignment."
                : "Create an account for a member of your hotel team."}
            </p>
          </div>

          <form onSubmit={saveStaff}>
            <fieldset disabled={busy}>
              <label className="sm-field">
                Full name
                <input
                  name="name"
                  value={form.name}
                  onChange={updateForm}
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="off"
                  placeholder="Staff member's name"
                />
              </label>

              <label className="sm-field">
                Email address
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={updateForm}
                  required
                  maxLength={254}
                  autoComplete="off"
                  placeholder="name@example.com"
                />
              </label>

              <label className="sm-field">
                Phone number
                <input
                  type="tel"
                  name="phone"
                  value={form.phone}
                  onChange={updateForm}
                  maxLength={25}
                  placeholder="03XXXXXXXXX"
                />
              </label>

              <label className="sm-field">
                Staff role
                <select
                  name="role"
                  value={form.role}
                  onChange={updateForm}
                  required
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>{label(role)}</option>
                  ))}
                </select>
              </label>

              <label className="sm-field">
                Assigned hotel
                <select
                  name="hotel"
                  value={form.hotel}
                  onChange={updateForm}
                  required={!editing}
                  disabled={hotelLoading}
                >
                  <option value="">
                    {hotelLoading ? "Loading hotels..." : "Select hotel"}
                  </option>

                  {form.hotel &&
                    !hotels.some((hotel) => hotel._id === form.hotel) && (
                      <option value={form.hotel}>Current hotel</option>
                    )}

                  {selectableHotels.map((hotel) => (
                    <option key={hotel._id} value={hotel._id}>
                      {hotel.name}
                      {hotel.code ? ` (${hotel.code})` : ""}
                      {!hotel.isActive ? " — Inactive" : ""}
                    </option>
                  ))}
                </select>
              </label>

              {!editing && (
                <label className="sm-field">
                  Initial password
                  <input
                    type="password"
                    name="password"
                    value={form.password}
                    onChange={updateForm}
                    required
                    minLength={12}
                    autoComplete="new-password"
                    placeholder="At least 12 characters"
                  />
                  <small>Use a unique password for each staff member.</small>
                </label>
              )}

              {editing && (
                <p className="sm-note">
                  Changing email, role or hotel signs the staff member out.
                  Reassign any pending housekeeping tasks separately when
                  changing their role or hotel.
                </p>
              )}

              <div className="sm-actions">
                <button
                  className="sm-button sm-primary"
                  type="submit"
                  disabled={hotelLoading || Boolean(hotelError)}
                >
                  {busy ? "Saving..." : editing ? "Save changes" : "Create account"}
                </button>

                {editing && (
                  <button
                    className="sm-button sm-secondary"
                    type="button"
                    onClick={() => {
                      resetForm();
                      setError("");
                    }}
                  >
                    Cancel edit
                  </button>
                )}
              </div>
            </fieldset>
          </form>
        </section>

        <section className="sm-panel">
          <div className="sm-panel-heading sm-list-title">
            <div>
              <h3>Staff directory</h3>
              <p>Filter your team by hotel, role or account status.</p>
            </div>
            <span className="sm-count">{pagination.total} staff</span>
          </div>

          <form
            className="sm-search"
            onSubmit={(event) => {
              event.preventDefault();
              updateFilter("search", searchInput.trim());
            }}
          >
            <input
              aria-label="Search staff by name, email or phone"
              placeholder="Search name, email or phone..."
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              maxLength={100}
              disabled={busy}
            />
            <button
              className="sm-button sm-primary"
              type="submit"
              disabled={busy}
            >
              Search
            </button>
          </form>

          <div className="sm-filters">
            <select
              aria-label="Filter by hotel"
              value={filters.hotel}
              disabled={busy}
              onChange={(event) => updateFilter("hotel", event.target.value)}
            >
              <option value="">All hotels</option>
              {hotels.map((hotel) => (
                <option key={hotel._id} value={hotel._id}>
                  {hotel.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by role"
              value={filters.role}
              disabled={busy}
              onChange={(event) => updateFilter("role", event.target.value)}
            >
              <option value="">All roles</option>
              {ROLES.map((role) => (
                <option key={role} value={role}>{label(role)}</option>
              ))}
            </select>

            <select
              aria-label="Filter by account status"
              value={filters.active}
              disabled={busy}
              onChange={(event) => updateFilter("active", event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>

          {listError && (
            <div className="sm-alert sm-error" role="alert">{listError}</div>
          )}

          {loading ? (
            <div className="sm-empty" role="status">Loading staff...</div>
          ) : !listError && staff.length === 0 ? (
            <div className="sm-empty">
              <h3>No staff found</h3>
              <p>Add a staff member or change your filters.</p>
            </div>
          ) : (
            <div className="sm-directory">
              {staff.map((member) => (
                <article className="sm-member" key={member._id}>
                  <div className="sm-member-top">
                    <div className="sm-person">
                      <div className="sm-avatar" aria-hidden="true">
                        {(member.name || "S").trim().charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h4>{member.name}</h4>
                        <span className="sm-role">{label(member.role)}</span>
                      </div>
                    </div>

                    <span
                      className={`sm-badge ${
                        member.isActive ? "sm-active" : "sm-inactive"
                      }`}
                    >
                      {member.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>

                  <dl className="sm-details">
                    <div><dt>Email</dt><dd>{member.email}</dd></div>
                    <div><dt>Phone</dt><dd>{member.phone || "—"}</dd></div>
                    <div>
                      <dt>Hotel</dt>
                      <dd>
                        {member.hotel?.name || "Not assigned"}
                        {member.hotel?.isActive === false && " (Inactive)"}
                      </dd>
                    </div>
                    <div>
                      <dt>Last login</dt>
                      <dd>
                        {member.lastLogin
                          ? new Date(member.lastLogin).toLocaleString("en-PK", {
                              timeZone: "Asia/Karachi",
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : "Never"}
                      </dd>
                    </div>
                  </dl>

                  <div className="sm-actions">
                    <button
                      type="button"
                      className="sm-button sm-secondary"
                      disabled={busy}
                      onClick={() => beginEdit(member)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="sm-button sm-secondary"
                      disabled={busy}
                      onClick={() => openAction(member, "password")}
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      className={`sm-button ${
                        member.isActive ? "sm-danger" : "sm-primary"
                      }`}
                      disabled={busy}
                      onClick={() => openAction(member, "status")}
                    >
                      {member.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>

                  {action?.member._id === member._id && (
                    <form className="sm-confirm" onSubmit={confirmAction}>
                      <h4>
                        {action.type === "password"
                          ? "Reset password"
                          : member.isActive
                          ? "Deactivate account?"
                          : "Activate account?"}
                      </h4>

                      {action.type === "password" ? (
                        <label className="sm-field">
                          New password for {member.name}
                          <input
                            type="password"
                            value={newPassword}
                            onChange={(event) => setNewPassword(event.target.value)}
                            minLength={12}
                            required
                            disabled={busy}
                            autoComplete="new-password"
                            placeholder="At least 12 characters"
                          />
                          <small>Existing sessions will be signed out.</small>
                        </label>
                      ) : (
                        <p>
                          {member.isActive
                            ? `${member.name} will be signed out and unable to log in. Reassign their pending tasks separately.`
                            : `${member.name} will be able to log in again.`}
                        </p>
                      )}

                      <div className="sm-actions">
                        <button
                          className="sm-button sm-primary"
                          type="submit"
                          disabled={busy}
                        >
                          {busy ? "Saving..." : "Confirm"}
                        </button>
                        <button
                          className="sm-button sm-secondary"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setAction(null);
                            setNewPassword("");
                            setError("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </article>
              ))}
            </div>
          )}

          <div className="sm-pagination">
            <span>Page {page} of {pagination.pages}</span>
            <div className="sm-actions">
              <button
                type="button"
                className="sm-button sm-secondary"
                disabled={busy || loading || page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </button>
              <button
                type="button"
                className="sm-button sm-secondary"
                disabled={busy || loading || page >= pagination.pages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

const styles = `
.sm-page {
  color: #193c30;
  font-family: inherit;
}
.sm-page * { box-sizing: border-box; }
.sm-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 24px;
}
.sm-eyebrow {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 2px;
  color: #8a713a;
}
.sm-heading h2 {
  font-size: clamp(25px, 3vw, 34px);
  margin: 8px 0;
  letter-spacing: -1px;
}
.sm-heading p, .sm-panel-heading p {
  color: #6d7c73;
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
}
.sm-layout {
  display: grid;
  grid-template-columns: minmax(270px, 340px) minmax(0, 1fr);
  gap: 22px;
  align-items: start;
}
.sm-panel {
  background: #fff;
  border: 1px solid #e2e9e2;
  border-radius: 20px;
  padding: 24px;
  min-width: 0;
  box-shadow: 0 8px 30px rgba(23, 60, 43, .035);
}
.sm-editor { scroll-margin-top: 24px; }
.sm-panel-heading { margin-bottom: 22px; }
.sm-panel-heading h3 {
  margin: 0 0 7px;
  font-size: 19px;
}
.sm-page fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.sm-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 17px;
  font-size: 13px;
  font-weight: 700;
}
.sm-page input, .sm-page select {
  width: 100%;
  min-width: 0;
  border: 1px solid #dce5dd;
  background: #fbfcfa;
  border-radius: 10px;
  padding: 12px;
  font: inherit;
  font-size: 14px;
  color: #243e32;
}
.sm-page input:focus, .sm-page select:focus {
  outline: 2px solid #a6cbb1;
  outline-offset: 2px;
}
.sm-page small {
  color: #758176;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.5;
}
.sm-button {
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 10px 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background .15s;
}
.sm-button:focus-visible {
  outline: 3px solid #b9a26d;
  outline-offset: 3px;
}
.sm-primary { background: #214f39; color: #fff; }
.sm-primary:hover:not(:disabled) { background: #153c2b; }
.sm-secondary {
  background: #f5f8f3;
  border-color: #dfe6db;
  color: #30533e;
}
.sm-secondary:hover:not(:disabled) { background: #eaf0e7; }
.sm-danger {
  background: #fff3f0;
  border-color: #f2d9d1;
  color: #a23d2d;
}
.sm-page button:disabled {
  opacity: .55;
  cursor: not-allowed;
}
.sm-page input:disabled, .sm-page select:disabled {
  opacity: .65;
}
.sm-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.sm-alert {
  padding: 13px 16px;
  margin-bottom: 18px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.sm-error { background: #fff0ed; color: #a33526; }
.sm-success { background: #e9f5ec; color: #22653e; }
.sm-list-title {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.sm-count {
  background: #f3eee2;
  color: #7b6433;
  font-size: 12px;
  font-weight: 800;
  border-radius: 30px;
  padding: 8px 12px;
  white-space: nowrap;
}
.sm-search {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.sm-filters {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 20px;
}
.sm-directory { display: grid; gap: 15px; }
.sm-member {
  padding: 18px;
  border: 1px solid #e5ebe3;
  border-radius: 15px;
}
.sm-member-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sm-person {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.sm-avatar {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 13px;
  background: #edf2e7;
  color: #41603d;
  display: grid;
  place-items: center;
  font-size: 19px;
  font-weight: 800;
}
.sm-member h4 {
  margin: 0 0 4px;
  font-size: 15px;
  overflow-wrap: anywhere;
}
.sm-role { color: #788575; font-size: 12px; }
.sm-badge {
  font-size: 11px;
  font-weight: 800;
  padding: 6px 10px;
  border-radius: 30px;
  white-space: nowrap;
}
.sm-active { background: #e7f3e9; color: #327445; }
.sm-inactive { background: #f1eeeb; color: #7d7268; }
.sm-details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin: 20px 0;
}
.sm-details dt {
  color: #839080;
  font-size: 11px;
  margin-bottom: 5px;
}
.sm-details dd {
  font-size: 13px;
  margin: 0;
  overflow-wrap: anywhere;
}
.sm-confirm {
  margin-top: 17px;
  padding: 16px;
  border: 1px solid #e5dbc2;
  background: #fcfaf3;
  border-radius: 12px;
}
.sm-confirm h4 { margin-bottom: 12px; }
.sm-confirm p, .sm-note {
  font-size: 12px;
  line-height: 1.7;
  color: #7c725a;
}
.sm-note {
  padding: 12px;
  background: #faf7ee;
  border-radius: 10px;
  margin: 0 0 18px;
}
.sm-empty {
  text-align: center;
  padding: 45px 12px;
  color: #7b877b;
  font-size: 14px;
}
.sm-empty h3 { color: #405a43; }
.sm-pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid #edf0e9;
}
.sm-pagination > span { color: #7d897a; font-size: 12px; }
@media (max-width: 1100px) {
  .sm-layout { grid-template-columns: 1fr; }
}
@media (max-width: 580px) {
  .sm-panel { padding: 17px; }
  .sm-heading { align-items: flex-start; }
  .sm-filters, .sm-details { grid-template-columns: 1fr; }
  .sm-member-top { flex-wrap: wrap; }
  .sm-pagination { flex-wrap: wrap; }
  .sm-list-title { flex-wrap: wrap; }
}
`;