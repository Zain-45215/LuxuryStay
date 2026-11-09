import { useEffect, useRef, useState } from "react";

const CATEGORIES = {
  electrical: "Electrical",
  plumbing: "Plumbing",
  air_conditioning: "Air conditioning",
  furniture: "Furniture",
  appliance: "Appliance",
  internet: "Internet",
  other: "Other",
};

const PRIORITIES = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

const STATUSES = {
  reported: "Reported",
  in_progress: "In progress",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

const EMPTY_FORM = {
  hotel: "",
  room: "",
  location: "",
  title: "",
  description: "",
  category: "other",
  priority: "normal",
  assignedTo: "",
};

function getId(value) {
  return typeof value === "string" ? value : value?._id || "";
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  });
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      Accept: "application/json",
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

async function loadAll(path, field, signal) {
  const items = new Map();
  let page = 1;
  let pages = 1;

  do {
    const separator = path.includes("?") ? "&" : "?";
    const data = await api(
      `${path}${separator}page=${page}&limit=100`,
      { signal }
    );

    if (!Array.isArray(data[field])) {
      throw new Error("Invalid list received from the server.");
    }

    data[field].forEach((item) => items.set(item._id, item));
    pages = Math.max(1, data.pagination?.pages || 1);
    page += 1;
  } while (page <= pages);

  return Array.from(items.values());
}

// Results are tied to the current path so old hotel data is not displayed.
function useOptions(path, field, refresh) {
  const key = `${path || ""}:${field}:${refresh}`;

  const [state, setState] = useState({
    key: "",
    items: [],
    loading: false,
    error: "",
  });

  useEffect(() => {
    const controller = new AbortController();

    setState({
      key,
      items: [],
      loading: Boolean(path),
      error: "",
    });

    if (!path) return () => controller.abort();

    loadAll(path, field, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) {
          setState({ key, items, loading: false, error: "" });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({
            key,
            items: [],
            loading: false,
            error: error.message,
          });
        }
      });

    return () => controller.abort();
  }, [path, field, key]);

  return state.key === key
    ? state
    : { items: [], loading: Boolean(path), error: "" };
}

function staffPath(hotel) {
  if (!hotel) return null;

  const params = new URLSearchParams({
    hotel,
    role: "maintenance",
    active: "true",
  });

  return `/staff?${params}`;
}

function eligibleStaff(items, hotel) {
  return items.filter(
    (member) =>
      member.isActive &&
      member.role === "maintenance" &&
      getId(member.hotel) === hotel
  );
}

function StaffSelect({
  value,
  onChange,
  options,
  hotel,
  disabled,
  currentName,
}) {
  const members = eligibleStaff(options.items, hotel);
  const missing = value && !members.some((member) => member._id === value);

  return (
    <div>
      <label>
        Assigned maintenance staff
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled || !hotel || options.loading}
        >
          <option value="">
            {options.loading ? "Loading staff..." : "Unassigned"}
          </option>

          {missing && (
            <option value={value} disabled>
              {currentName || "Selected staff"} — unavailable
            </option>
          )}

          {members.map((member) => (
            <option key={member._id} value={member._id}>
              {member.name} — {member.email}
            </option>
          ))}
        </select>
      </label>

      {options.error && (
        <div className="mt-alert mt-error" role="alert">
          Could not load staff: {options.error}
        </div>
      )}

      {hotel &&
        !options.loading &&
        !options.error &&
        members.length === 0 && (
          <p className="mt-help">
            No active maintenance staff assigned to this hotel.
            Add them in Staff & Roles, then refresh this page.
          </p>
        )}
    </div>
  );
}

export default function MaintenanceManagement() {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [filters, setFilters] = useState({
    hotel: "",
    status: "",
    priority: "",
    category: "",
  });

  const [requests, setRequests] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState(null);
  const [actionText, setActionText] = useState("");
  const [assignment, setAssignment] = useState("");

  const mounted = useRef(false);
  const lock = useRef(false);

  const hotels = useOptions("/hotels", "hotels", refresh);

  const rooms = useOptions(
    form.hotel
      ? `/rooms?hotel=${encodeURIComponent(form.hotel)}&active=true`
      : null,
    "rooms",
    refresh
  );

  const formStaff = useOptions(
    staffPath(form.hotel),
    "staff",
    refresh
  );

  const assignmentHotel =
    selected?.action === "assign" ? getId(selected.request.hotel) : "";

  const actionStaff = useOptions(
    staffPath(assignmentHotel),
    "staff",
    refresh
  );

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

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
    setRequests([]);

    api(`/maintenance?${params}`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;

        if (!Array.isArray(data.requests)) {
          throw new Error("Invalid maintenance list received.");
        }

        const pages = Math.max(1, data.pagination?.pages || 1);

        if (page > pages) {
          setPage(pages);
          return;
        }

        setRequests(data.requests);
        setPagination({
          total: data.pagination?.total || 0,
          pages,
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setListError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [filters, page, refresh]);

  function resetAction() {
    setSelected(null);
    setActionText("");
    setAssignment("");
    setActionError("");
  }

  function updateForm(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "hotel"
        ? { room: "", location: "", assignedTo: "" }
        : {}),
    }));

    setFormError("");
  }

  function updateFilter(name, value) {
    if (lock.current) return;

    resetAction();
    setPage(1);
    setFilters((current) => ({ ...current, [name]: value }));
  }

  async function createRequest(event) {
    event.preventDefault();
    if (lock.current) return;

    setFormError("");
    setSuccess("");

    const hotel = hotels.items.find((item) => item._id === form.hotel);

    if (hotels.loading || hotels.error || !hotel?.isActive) {
      setFormError("Please select an active hotel.");
      return;
    }

    if (
      form.room &&
      (
        rooms.loading ||
        rooms.error ||
        !rooms.items.some(
          (room) =>
            room._id === form.room &&
            getId(room.hotel) === form.hotel
        )
      )
    ) {
      setFormError("Please select a valid room for this hotel.");
      return;
    }

    if (!form.room && !form.location.trim()) {
      setFormError("Enter the common-area location, such as Lobby.");
      return;
    }

    if (form.title.trim().length < 3) {
      setFormError("Issue title must contain at least 3 characters.");
      return;
    }

    if (form.description.trim().length < 5) {
      setFormError("Description must contain at least 5 characters.");
      return;
    }

    if (
      form.assignedTo &&
      (
        formStaff.loading ||
        formStaff.error ||
        !eligibleStaff(formStaff.items, form.hotel).some(
          (member) => member._id === form.assignedTo
        )
      )
    ) {
      setFormError("Choose eligible maintenance staff or select Unassigned.");
      return;
    }

    const payload = {
      hotel: form.hotel,
      room: form.room || null,
      location: form.location.trim(),
      title: form.title.trim(),
      description: form.description.trim(),
      category: form.category,
      priority: form.priority,
      assignedTo: form.assignedTo || null,
    };

    lock.current = true;
    setBusy(true);

    try {
      const data = await api("/maintenance", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!mounted.current) return;

      setSuccess(data.message || "Maintenance issue reported.");
      setForm({ ...EMPTY_FORM, hotel: payload.hotel });
      setFilters({
        hotel: payload.hotel,
        status: "",
        priority: "",
        category: "",
      });
      setPage(1);
      resetAction();
      setRefresh((value) => value + 1);
    } catch (error) {
      if (mounted.current) setFormError(error.message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function openAction(request, action) {
    if (lock.current) return;

    setSelected({ request, action });
    setAssignment(action === "assign" ? getId(request.assignedTo) : "");
    setActionText("");
    setActionError("");
    setSuccess("");
  }

  async function submitAction(event) {
    event.preventDefault();
    if (!selected || lock.current) return;

    setActionError("");

    const { request, action } = selected;
    const text = actionText.trim();
    let payload = {};

    if (action === "assign") {
      if (
        assignment &&
        (
          actionStaff.loading ||
          actionStaff.error ||
          !eligibleStaff(actionStaff.items, assignmentHotel).some(
            (member) => member._id === assignment
          )
        )
      ) {
        setActionError("Choose eligible staff or select Unassigned.");
        return;
      }

      if (assignment === getId(request.assignedTo)) {
        setActionError("Choose a different staff member or select Unassigned.");
        return;
      }

      payload = { assignedTo: assignment || null };
    }

    if (action === "resolve") {
      if (text.length < 5) {
        setActionError("Resolution notes must contain at least 5 characters.");
        return;
      }

      payload = { resolutionNotes: text };
    }

    if (action === "cancel") {
      if (text.length < 3) {
        setActionError("Cancellation reason must contain at least 3 characters.");
        return;
      }

      payload = { reason: text };
    }

    lock.current = true;
    setBusy(true);

    try {
      const data = await api(`/maintenance/${request._id}/${action}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      if (!mounted.current) return;

      setSuccess(data.message || "Maintenance request updated.");
      resetAction();
      setRefresh((value) => value + 1);
    } catch (error) {
      if (mounted.current) setActionError(error.message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function actionMessage(request, action) {
    if (action === "assign") {
      return "Choose active maintenance staff assigned to this hotel.";
    }

    if (action === "start") {
      return request.room
        ? "Start repairs? The room will be marked maintenance. The guest must be checked out and active housekeeping tasks must be completed or cancelled first."
        : "Confirm that maintenance work is starting at this location.";
    }

    if (action === "resolve") {
      return request.room
        ? "Confirm the repair is complete. The room will be marked cleaning and will need a completed housekeeping task before becoming available."
        : "Confirm the issue has been fixed and describe the completed work.";
    }

    return request.room && request.status === "in_progress"
      ? "Cancel this repair only if work can safely stop. The room will move to cleaning and require housekeeping before becoming available."
      : "Cancel this request? Room status will remain unchanged.";
  }

  return (
    <section className="mt-page">
      <style>{styles}</style>

      <div className="mt-heading">
        <div>
          <span className="mt-eyebrow">PROPERTY CARE</span>
          <h2>Maintenance</h2>
          <p className="mt-muted">
            Report issues, coordinate repairs and track their resolution.
          </p>
        </div>

        <button
          type="button"
          disabled={busy || loading}
          onClick={() => {
            resetAction();
            setRefresh((value) => value + 1);
          }}
        >
          Refresh
        </button>
      </div>

      {success && (
        <div className="mt-alert mt-success" role="status">{success}</div>
      )}

      <section className="mt-panel">
        <h3>Report an issue</h3>
        <p className="mt-muted">
          Choose a room or report a common-area issue.
        </p>

        {hotels.error && (
          <div className="mt-alert mt-error" role="alert">
            Could not load hotels: {hotels.error}
          </div>
        )}

        {rooms.error && (
          <div className="mt-alert mt-error" role="alert">
            Could not load rooms: {rooms.error}
          </div>
        )}

        {formError && (
          <div className="mt-alert mt-error" role="alert">{formError}</div>
        )}

        <form onSubmit={createRequest}>
          <fieldset disabled={busy}>
            <div className="mt-grid">
              <label>
                Hotel *
                <select
                  name="hotel"
                  value={form.hotel}
                  onChange={updateForm}
                  required
                  disabled={hotels.loading}
                >
                  <option value="">
                    {hotels.loading ? "Loading hotels..." : "Select hotel"}
                  </option>
                  {hotels.items.filter((hotel) => hotel.isActive).map((hotel) => (
                    <option key={hotel._id} value={hotel._id}>
                      {hotel.name} — {hotel.code}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Room / common area
                <select
                  name="room"
                  value={form.room}
                  onChange={updateForm}
                  disabled={!form.hotel || rooms.loading}
                >
                  <option value="">
                    {rooms.loading ? "Loading rooms..." : "Common area"}
                  </option>
                  {rooms.items.map((room) => (
                    <option key={room._id} value={room._id}>
                      Room {room.roomNumber} — {room.status}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mt-wide">
                {form.room ? "Specific location — optional" : "Common-area location *"}
                <input
                  name="location"
                  value={form.location}
                  onChange={updateForm}
                  required={!form.room}
                  maxLength={200}
                  placeholder={form.room ? "For example: bathroom sink" : "For example: lobby or elevator"}
                />
              </label>

              <label className="mt-wide">
                Issue title *
                <input
                  name="title"
                  value={form.title}
                  onChange={updateForm}
                  required
                  minLength={3}
                  maxLength={150}
                  placeholder="For example: air conditioner is not cooling"
                />
              </label>

              <label>
                Category
                <select name="category" value={form.category} onChange={updateForm}>
                  {Object.entries(CATEGORIES).map(([value, text]) => (
                    <option key={value} value={value}>{text}</option>
                  ))}
                </select>
              </label>

              <label>
                Priority
                <select name="priority" value={form.priority} onChange={updateForm}>
                  {Object.entries(PRIORITIES).map(([value, text]) => (
                    <option key={value} value={value}>{text}</option>
                  ))}
                </select>
              </label>

              <div className="mt-wide">
                <StaffSelect
                  value={form.assignedTo}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, assignedTo: value }))
                  }
                  options={formStaff}
                  hotel={form.hotel}
                  disabled={busy}
                />
              </div>

              <label className="mt-wide">
                Issue description *
                <textarea
                  name="description"
                  value={form.description}
                  onChange={updateForm}
                  required
                  minLength={5}
                  maxLength={3000}
                  rows={4}
                  placeholder="Describe the issue and where it is happening."
                />
              </label>
            </div>

            <div className="mt-notice">
              Reporting an issue does not block the room. Starting room repairs
              marks it as maintenance. Occupied rooms can be reported, but
              repairs can only start after guest checkout.
            </div>

            <button
              className="mt-primary"
              type="submit"
              disabled={
                busy ||
                hotels.loading ||
                Boolean(hotels.error) ||
                !form.hotel ||
                Boolean(form.room && (rooms.loading || rooms.error)) ||
                Boolean(form.assignedTo && (formStaff.loading || formStaff.error))
              }
            >
              {busy ? "Processing..." : "Report issue"}
            </button>
          </fieldset>
        </form>
      </section>

      <section className="mt-panel">
        <div className="mt-heading">
          <div>
            <h3>Maintenance requests</h3>
            <p className="mt-muted">Track reported issues and ongoing work.</p>
          </div>
          <span className="mt-badge">{pagination.total} requests</span>
        </div>

        <div className="mt-filters">
          <label>
            Hotel
            <select
              value={filters.hotel}
              disabled={busy}
              onChange={(event) => updateFilter("hotel", event.target.value)}
            >
              <option value="">All hotels</option>
              {hotels.items.map((hotel) => (
                <option key={hotel._id} value={hotel._id}>{hotel.name}</option>
              ))}
            </select>
          </label>

          {[
            ["status", "Status", STATUSES],
            ["priority", "Priority", PRIORITIES],
            ["category", "Category", CATEGORIES],
          ].map(([key, title, options]) => (
            <label key={key}>
              {title}
              <select
                value={filters[key]}
                disabled={busy}
                onChange={(event) => updateFilter(key, event.target.value)}
              >
                <option value="">All {title.toLowerCase()}</option>
                {Object.entries(options).map(([value, text]) => (
                  <option key={value} value={value}>{text}</option>
                ))}
              </select>
            </label>
          ))}
        </div>

        {listError && (
          <div className="mt-alert mt-error" role="alert">{listError}</div>
        )}

        {loading ? (
          <div className="mt-empty" role="status">Loading maintenance requests...</div>
        ) : !listError && requests.length === 0 ? (
          <div className="mt-empty">No maintenance requests found.</div>
        ) : !listError ? (
          requests.map((request) => {
            const open = ["reported", "in_progress"].includes(request.status);
            const isSelected = selected?.request._id === request._id;

            return (
              <article className="mt-card" key={request._id}>
                <div className="mt-heading">
                  <div>
                    <h3>{request.title}</h3>
                    <p className="mt-muted">
                      {request.hotel?.name || "Hotel unavailable"} ·{" "}
                      {request.room?.roomNumber
                        ? `Room ${request.room.roomNumber}`
                        : request.room ? "Room unavailable" : "Common area"}
                    </p>
                  </div>

                  <div className="mt-actions">
                    <span className={`mt-badge ${request.status}`}>
                      {STATUSES[request.status] || request.status}
                    </span>
                    <span className={`mt-badge ${request.priority}`}>
                      {PRIORITIES[request.priority] || request.priority} priority
                    </span>
                  </div>
                </div>

                <p className="mt-description">{request.description}</p>

                <dl className="mt-details">
                  <div><dt>Location</dt><dd>{request.location}</dd></div>
                  <div><dt>Category</dt><dd>{CATEGORIES[request.category] || request.category}</dd></div>
                  <div><dt>Assigned staff</dt><dd>{request.assignedTo?.name || "Unassigned"}</dd></div>
                  <div><dt>Reported by</dt><dd>{request.reportedBy?.name || "—"}</dd></div>
                  <div><dt>Reported (Pakistan time)</dt><dd>{formatTime(request.createdAt)}</dd></div>
                  <div><dt>Current room status</dt><dd>{request.room?.status || "—"}</dd></div>
                  <div><dt>Started (Pakistan time)</dt><dd>{formatTime(request.startedAt)}</dd></div>
                  <div><dt>Resolved (Pakistan time)</dt><dd>{formatTime(request.resolvedAt)}</dd></div>
                  <div><dt>Resolved by</dt><dd>{request.resolvedBy?.name || "—"}</dd></div>
                </dl>

                {request.resolutionNotes && (
                  <p className="mt-note">
                    <strong>Resolution: </strong>{request.resolutionNotes}
                  </p>
                )}

                {request.cancellationReason && (
                  <div className="mt-note">
                    <p><strong>Cancellation reason: </strong>{request.cancellationReason}</p>
                    <p className="mt-muted">
                      {request.cancelledBy?.name || "—"} · {formatTime(request.cancelledAt)}
                    </p>
                  </div>
                )}

                {open && !isSelected && (
                  <div className="mt-actions">
                    <button
                      className="mt-primary"
                      type="button"
                      disabled={busy}
                      onClick={() => openAction(
                        request,
                        request.status === "reported" ? "start" : "resolve"
                      )}
                    >
                      {request.status === "reported" ? "Start work" : "Resolve issue"}
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => openAction(request, "assign")}
                    >
                      {request.assignedTo ? "Change staff" : "Assign staff"}
                    </button>

                    <button
                      className="mt-danger"
                      type="button"
                      disabled={busy}
                      onClick={() => openAction(request, "cancel")}
                    >
                      Cancel request
                    </button>
                  </div>
                )}

                {isSelected && (
                  <form className="mt-confirm" onSubmit={submitAction}>
                    <p>{actionMessage(request, selected.action)}</p>

                    {selected.action === "assign" && (
                      <div className="mt-action-field">
                        <StaffSelect
                          value={assignment}
                          onChange={(value) => {
                            setAssignment(value);
                            setActionError("");
                          }}
                          options={actionStaff}
                          hotel={assignmentHotel}
                          disabled={busy}
                          currentName={request.assignedTo?.name}
                        />
                      </div>
                    )}

                    {["resolve", "cancel"].includes(selected.action) && (
                      <label className="mt-action-field">
                        {selected.action === "resolve"
                          ? "Resolution notes *"
                          : "Cancellation reason *"}
                        <textarea
                          value={actionText}
                          onChange={(event) => setActionText(event.target.value)}
                          required
                          minLength={selected.action === "resolve" ? 5 : 3}
                          maxLength={selected.action === "resolve" ? 3000 : 500}
                          disabled={busy}
                          rows={3}
                        />
                      </label>
                    )}

                    {actionError && (
                      <div className="mt-alert mt-error" role="alert">{actionError}</div>
                    )}

                    <div className="mt-actions">
                      <button
                        className="mt-primary"
                        type="submit"
                        disabled={
                          busy ||
                          Boolean(selected.action === "assign" && actionStaff.loading)
                        }
                      >
                        {busy
                          ? "Processing..."
                          : selected.action === "assign"
                          ? "Save assignment"
                          : "Confirm"}
                      </button>
                      <button type="button" disabled={busy} onClick={resetAction}>
                        Go back
                      </button>
                    </div>
                  </form>
                )}
              </article>
            );
          })
        ) : null}

        {!loading && !listError && (
          <div className="mt-pagination">
            <span>Page {page} of {pagination.pages}</span>
            <div className="mt-actions">
              <button
                type="button"
                disabled={busy || page <= 1}
                onClick={() => {
                  resetAction();
                  setPage((value) => value - 1);
                }}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={busy || page >= pagination.pages}
                onClick={() => {
                  resetAction();
                  setPage((value) => value + 1);
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}

const styles = `
.mt-page { color:#243d30; }
.mt-page * { box-sizing:border-box; }
.mt-page h2 {
  margin:7px 0 8px;
  font-size:29px;
  color:#173f2e;
}
.mt-page h3 {
  margin:0 0 8px;
  font-size:19px;
  color:#173f2e;
  overflow-wrap:anywhere;
}
.mt-page p { margin:0; line-height:1.7; }
.mt-eyebrow {
  font-size:10px;
  font-weight:800;
  letter-spacing:2px;
  color:#8c7442;
}
.mt-muted { color:#68796b; font-size:13px; }
.mt-heading {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  flex-wrap:wrap;
  margin-bottom:22px;
}
.mt-panel {
  background:#fff;
  border:1px solid #dfe6dc;
  border-radius:18px;
  padding:25px;
  margin-bottom:22px;
}
.mt-page fieldset {
  border:0;
  padding:0;
  margin:0;
  min-width:0;
}
.mt-grid {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:18px;
  margin-top:22px;
}
.mt-wide { grid-column:1 / -1; }
.mt-page label {
  display:block;
  font-size:13px;
  font-weight:600;
  color:#324c39;
}
.mt-page input,.mt-page select,.mt-page textarea {
  display:block;
  width:100%;
  min-width:0;
  margin-top:8px;
  padding:11px 12px;
  border:1px solid #ccd8cc;
  border-radius:9px;
  background:#fff;
  color:#233d2d;
  font:inherit;
  font-size:14px;
}
.mt-page textarea { resize:vertical; min-height:90px; }
.mt-page button {
  width:auto;
  margin:0;
  padding:10px 15px;
  border:1px solid #d3decf;
  border-radius:9px;
  background:#fff;
  color:#244b33;
  font:inherit;
  font-size:13px;
  font-weight:600;
  cursor:pointer;
}
.mt-page button:hover:not(:disabled) { background:#edf4e9; }
.mt-page button.mt-primary {
  background:#225339;
  color:#fff;
  border-color:#225339;
}
.mt-page button.mt-primary:hover:not(:disabled) { background:#173f2a; }
.mt-page button.mt-danger { color:#a24032; border-color:#e7c8c1; }
.mt-page button:disabled { opacity:.55; cursor:not-allowed; }
.mt-page :is(button,input,select,textarea):focus-visible {
  outline:3px solid #b39a5b;
  outline-offset:3px;
}
.mt-alert {
  margin:15px 0;
  padding:13px 16px;
  border-radius:10px;
  font-size:14px;
  line-height:1.6;
  overflow-wrap:anywhere;
}
.mt-error { background:#fff0ed; color:#963b30; }
.mt-success { background:#e8f5e9; color:#245b33; }
.mt-notice {
  margin:20px 0;
  padding:14px 16px;
  border-radius:10px;
  background:#f8f3e7;
  color:#756039;
  font-size:13px;
  line-height:1.7;
}
.mt-page .mt-help {
  margin-top:9px;
  font-size:12px;
  color:#7a775f;
}
.mt-filters {
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:14px;
  margin-bottom:22px;
}
.mt-card {
  border:1px solid #e0e7dc;
  border-radius:15px;
  padding:22px;
  margin-bottom:17px;
}
.mt-card .mt-heading { margin-bottom:15px; }
.mt-actions { display:flex; gap:9px; align-items:center; flex-wrap:wrap; }
.mt-badge {
  display:inline-block;
  padding:6px 10px;
  border-radius:20px;
  background:#f0f3ec;
  color:#4a6047;
  font-size:12px;
}
.mt-badge.reported { background:#fff2d4; color:#7c5a14; }
.mt-badge.in_progress { background:#e5eefb; color:#345f91; }
.mt-badge.resolved { background:#e6f3e6; color:#2f6b37; }
.mt-badge.cancelled { background:#f2ebe8; color:#80594a; }
.mt-badge.urgent { background:#ffe6e2; color:#a23529; }
.mt-badge.high { background:#fff0d9; color:#885b17; }
.mt-description,.mt-note {
  white-space:pre-wrap;
  overflow-wrap:anywhere;
  font-size:14px;
}
.mt-details {
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:16px;
  margin:19px 0;
  padding:18px 0;
  border-top:1px solid #edf0e8;
  border-bottom:1px solid #edf0e8;
}
.mt-details dt {
  color:#6c7b6c;
  font-size:12px;
  margin-bottom:6px;
}
.mt-details dd { margin:0; font-size:13px; overflow-wrap:anywhere; }
.mt-page .mt-note { margin-bottom:16px; }
.mt-confirm {
  margin-top:18px;
  padding:19px;
  border-radius:12px;
  background:#f4f5ee;
}
.mt-confirm > p { font-size:13px; }
.mt-action-field { margin-top:16px; }
.mt-confirm > .mt-actions { margin-top:17px; }
.mt-empty { text-align:center; padding:35px 15px; color:#687868; }
.mt-pagination {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:15px;
  flex-wrap:wrap;
  margin-top:22px;
  font-size:12px;
  color:#6c7b6c;
}
@media(max-width:1000px) {
  .mt-filters { grid-template-columns:repeat(2,minmax(0,1fr)); }
}
@media(max-width:650px) {
  .mt-grid,.mt-filters,.mt-details { grid-template-columns:1fr; }
  .mt-panel,.mt-card { padding:18px; }
  .mt-page h2 { font-size:25px; }
}
`;