import { useEffect, useRef, useState } from "react";

const TYPES = {
  room_service: "Room service",
  laundry: "Laundry",
  wake_up_call: "Wake-up call",
  transportation: "Transportation",
  extra_amenities: "Extra amenities",
  other: "Other",
};

const STATUSES = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const PRIORITIES = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

const STAFF_ROLES = ["manager", "receptionist", "housekeeping"];

const EMPTY_FORM = {
  reservation: "",
  serviceType: "room_service",
  title: "",
  description: "",
  quantity: "1",
  requestedFor: "",
  priority: "normal",
  assignedTo: "",
  charge: "",
};

function getId(value) {
  return typeof value === "string" ? value : value?._id || "";
}

async function api(url, options = {}) {
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
    throw new Error("You do not have permission to manage services.");
  }

  if (!response.ok || !data?.success) {
    throw new Error(data?.message || "Unable to complete the request.");
  }

  return data;
}

// Accept empty lists with either pages: 0 or pages: 1.
function readList(data, field) {
  const items = data[field];
  const pages = data.pagination?.pages;
  const total = data.pagination?.total;

  if (
    !Array.isArray(items) ||
    !Number.isSafeInteger(pages) ||
    pages < 0 ||
    !Number.isSafeInteger(total) ||
    total < 0
  ) {
    throw new Error("The server returned an invalid list.");
  }

  if (
    (pages === 0 && (total !== 0 || items.length !== 0)) ||
    (total === 0 && items.length !== 0)
  ) {
    throw new Error("The server returned inconsistent pagination.");
  }

  return {
    items,
    total,
    pages: Math.max(1, pages),
  };
}

async function loadAll(path, field, signal) {
  const records = new Map();
  let page = 1;

  while (true) {
    const separator = path.includes("?") ? "&" : "?";

    const data = await api(
      `${path}${separator}page=${page}&limit=100`,
      { signal }
    );

    const result = readList(data, field);

    if (result.total === 0) {
      return [];
    }

    for (const item of result.items) {
      records.set(item._id, item);
    }

    if (page >= result.pages) break;

    page += 1;
  }

  return [...records.values()];
}

function useOptions(path, field, refresh) {
  const [state, setState] = useState({
    key: "",
    items: [],
    loading: false,
    error: "",
  });

  const key = `${path || ""}|${field}|${refresh}`;

  useEffect(() => {
    if (!path) return;

    const controller = new AbortController();

    setState({
      key,
      items: [],
      loading: true,
      error: "",
    });

    loadAll(path, field, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) {
          setState({
            key,
            items,
            loading: false,
            error: "",
          });
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

  if (!path) {
    return { items: [], loading: false, error: "" };
  }

  if (state.key !== key) {
    return { items: [], loading: true, error: "" };
  }

  return state;
}

function eligibleStaff(items, hotelId) {
  return items
    .filter(
      (person) =>
        person.isActive &&
        STAFF_ROLES.includes(person.role) &&
        getId(person.hotel) === hotelId
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toMinor(value, required = false) {
  const text = String(value).trim();

  if (!text) {
    if (required) {
      throw new Error("Enter a total charge. Use 0 for a free service.");
    }

    return null;
  }

  if (!/^\d{1,14}(?:\.\d{1,2})?$/.test(text)) {
    throw new Error(
      "Enter a non-negative charge with no more than two decimal places."
    );
  }

  const [whole, fraction = ""] = text.split(".");
  const amount =
    BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));

  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("The charge is too large.");
  }

  return Number(amount);
}

function fromMinor(value) {
  if (!Number.isSafeInteger(value) || value < 0) return "";

  const amount = BigInt(value);

  return `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
}

function showCharge(value, currency) {
  const amount = fromMinor(value);
  return amount ? `${currency || ""} ${amount}` : "Not priced";
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Karachi",
  }).format(date);
}

function pakistanTimeToISO(value) {
  if (!value) return null;

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("Choose a valid date and time.");
  }

  const date = new Date(`${value}:00+05:00`);

  if (
    Number.isNaN(date.getTime()) ||
    date.getTime() <= Date.now()
  ) {
    throw new Error("Choose a future date and time.");
  }

  return date.toISOString();
}

function StaffSelect({
  options,
  hotelId,
  value,
  onChange,
  disabled,
  current,
}) {
  const people = eligibleStaff(options.items, hotelId);
  const missing =
    value && !people.some((person) => person._id === value);

  return (
    <label className="gs-field">
      Assigned employee
      <select
        value={value}
        onChange={onChange}
        disabled={disabled || options.loading || !hotelId}
      >
        <option value="">
          {options.loading ? "Loading employees..." : "Unassigned"}
        </option>

        {missing && (
          <option value={value} disabled>
            {current?.name || "Selected employee"} — unavailable
          </option>
        )}

        {people.map((person) => (
          <option key={person._id} value={person._id}>
            {person.name} — {person.role}
          </option>
        ))}
      </select>

      {options.error && (
        <span className="gs-error-text">{options.error}</span>
      )}

      {!options.loading &&
        !options.error &&
        hotelId &&
        !people.length && (
          <small>No eligible active employees in this hotel.</small>
        )}
    </label>
  );
}

export default function GuestServices() {
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const [filters, setFilters] = useState({
    hotel: "",
    status: "",
    serviceType: "",
    priority: "",
  });

  const [requests, setRequests] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    total: 0,
    pages: 1,
  });

  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const [action, setAction] = useState(null);
  const [actionForm, setActionForm] = useState({
    assignedTo: "",
    charge: "",
    notes: "",
    reason: "",
  });
  const [actionError, setActionError] = useState("");

  const mounted = useRef(false);
  const lock = useRef(false);

  const hotels = useOptions("/api/hotels", "hotels", refresh);

  const stays = useOptions(
    "/api/reservations?status=checked_in",
    "reservations",
    refresh
  );

  const selectedStay = stays.items.find(
    (stay) => stay._id === form.reservation
  );

  const selectedHotelId = getId(selectedStay?.hotel);
  const actionHotelId = getId(action?.request.hotel);

  const createStaff = useOptions(
    selectedHotelId
      ? `/api/staff?hotel=${selectedHotelId}&active=true`
      : null,
    "staff",
    refresh
  );

  const actionStaff = useOptions(
    action?.type === "assign" && actionHotelId
      ? `/api/staff?hotel=${actionHotelId}&active=true`
      : null,
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

    async function loadRequests() {
      setLoading(true);
      setListError("");

      const params = new URLSearchParams({
        page: String(page),
        limit: "10",
      });

      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }

      try {
        const data = await api(`/api/services?${params}`, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        const result = readList(data, "requests");

        if (page > result.pages) {
          setPage(result.pages);
          return;
        }

        setRequests(result.items);
        setPagination({
          total: result.total,
          pages: result.pages,
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          setRequests([]);
          setListError(error.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadRequests();

    return () => controller.abort();
  }, [page, filters, refresh]);

  function updateForm(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "reservation" ? { assignedTo: "" } : {}),
    }));
  }

  function updateFilter(event) {
    const { name, value } = event.target;

    setPage(1);
    setFilters((current) => ({ ...current, [name]: value }));
    setAction(null);
    setActionError("");
  }

  function validateStaff(value, options, hotelId) {
    if (!value) return null;

    if (options.loading || options.error) {
      throw new Error(
        "Refresh the employee list before assigning staff."
      );
    }

    if (
      !eligibleStaff(options.items, hotelId).some(
        (person) => person._id === value
      )
    ) {
      throw new Error(
        "Choose an eligible employee from this hotel."
      );
    }

    return value;
  }

  async function createRequest(event) {
    event.preventDefault();

    if (lock.current) return;

    setFormError("");
    setSuccess("");

    let payload;

    try {
      if (!selectedStay || stays.loading || stays.error) {
        throw new Error("Select a currently checked-in guest.");
      }

      const title = form.title.trim();

      if (title.length < 3 || title.length > 150) {
        throw new Error("Title must contain 3 to 150 characters.");
      }

      const quantity = Number(form.quantity);

      if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 100
      ) {
        throw new Error("Quantity must be between 1 and 100.");
      }

      const requestedFor = pakistanTimeToISO(form.requestedFor);

      if (form.serviceType === "wake_up_call" && !requestedFor) {
        throw new Error("Choose a time for the wake-up call.");
      }

      payload = {
        reservation: selectedStay._id,
        serviceType: form.serviceType,
        title,
        description: form.description.trim(),
        quantity,
        requestedFor,
        priority: form.priority,
        assignedTo: validateStaff(
          form.assignedTo,
          createStaff,
          selectedHotelId
        ),
        chargeMinor: toMinor(form.charge),
      };
    } catch (error) {
      setFormError(error.message);
      return;
    }

    lock.current = true;
    setBusy(true);

    try {
      const data = await api("/api/services", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!mounted.current) return;

      setSuccess(data.message);
      setForm({ ...EMPTY_FORM });

      setFilters({
        hotel: selectedHotelId,
        status: "",
        serviceType: "",
        priority: "",
      });

      setPage(1);
      setRefresh((value) => value + 1);
    } catch (error) {
      if (mounted.current) {
        setFormError(error.message);
      }
    } finally {
      lock.current = false;

      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  function openAction(type, request) {
    if (lock.current) return;

    setSuccess("");
    setActionError("");
    setAction({ type, request });

    setActionForm({
      assignedTo: getId(request.assignedTo),
      charge: fromMinor(request.chargeMinor),
      notes: "",
      reason: "",
    });
  }

  function closeAction() {
    if (lock.current) return;

    setAction(null);
    setActionError("");
  }

  async function submitAction(event) {
    event.preventDefault();

    if (!action || lock.current) return;

    setActionError("");
    setSuccess("");

    let payload = {};

    try {
      if (action.type === "assign") {
        const assignedTo = validateStaff(
          actionForm.assignedTo,
          actionStaff,
          actionHotelId
        );

        if (
          (assignedTo || "") === getId(action.request.assignedTo)
        ) {
          throw new Error(
            "Choose a different employee or select Unassigned."
          );
        }

        payload = { assignedTo };
      }

      if (action.type === "complete") {
        payload = {
          completionNotes: actionForm.notes.trim(),
          chargeMinor: toMinor(actionForm.charge, true),
        };
      }

      if (action.type === "cancel") {
        const reason = actionForm.reason.trim();

        if (reason.length < 3 || reason.length > 500) {
          throw new Error(
            "Cancellation reason must contain 3 to 500 characters."
          );
        }

        payload = { reason };
      }
    } catch (error) {
      setActionError(error.message);
      return;
    }

    lock.current = true;
    setBusy(true);

    try {
      const data = await api(
        `/api/services/${action.request._id}/${action.type}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        }
      );

      if (!mounted.current) return;

      setSuccess(data.message);
      setAction(null);
      setRefresh((value) => value + 1);
    } catch (error) {
      if (mounted.current) {
        setActionError(error.message);
      }
    } finally {
      lock.current = false;

      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  const actionTitles = {
    assign: "Assign employee",
    start: "Start service",
    complete: "Complete service",
    cancel: "Cancel request",
  };

  return (
    <section className="gs-page" aria-label="Guest services">
      <style>{`
        .gs-page {
          color:#244333;
          font-family:inherit;
        }

        .gs-page * {
          box-sizing:border-box;
        }

        .gs-head,
        .gs-row,
        .gs-pagination {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:14px;
          flex-wrap:wrap;
        }

        .gs-head {
          margin-bottom:22px;
        }

        .gs-head h2 {
          margin:6px 0;
          font-size:30px;
          letter-spacing:-.8px;
        }

        .gs-eyebrow {
          color:#8a713c;
          font-size:10px;
          font-weight:800;
          letter-spacing:2px;
          text-transform:uppercase;
        }

        .gs-muted {
          color:#6d7c70;
          font-size:13px;
          line-height:1.7;
        }

        .gs-panel,
        .gs-card {
          background:#fff;
          border:1px solid #e0e6db;
          border-radius:17px;
          padding:23px;
          margin-bottom:20px;
        }

        .gs-panel h3,
        .gs-card h3 {
          margin:0 0 8px;
        }

        .gs-panel > p {
          margin:0 0 20px;
        }

        .gs-grid {
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:17px;
        }

        .gs-full {
          grid-column:1 / -1;
        }

        .gs-field {
          display:flex;
          flex-direction:column;
          gap:8px;
          min-width:0;
          font-size:13px;
          font-weight:700;
        }

        .gs-field input,
        .gs-field select,
        .gs-field textarea {
          width:100%;
          min-height:44px;
          padding:11px 12px;
          border:1px solid #d8e1d5;
          border-radius:9px;
          background:#fcfdfb;
          color:#2b4434;
          font:inherit;
          font-weight:400;
        }

        .gs-field textarea {
          min-height:95px;
          resize:vertical;
          line-height:1.6;
        }

        .gs-field small {
          color:#6e7e6f;
          font-size:11px;
          font-weight:400;
        }

        .gs-page fieldset {
          border:0;
          padding:0;
          margin:0;
          min-width:0;
        }

        .gs-btn {
          border:1px solid #d5dfd0;
          border-radius:9px;
          padding:10px 15px;
          min-height:42px;
          background:white;
          color:#34563e;
          font:inherit;
          font-size:12px;
          font-weight:700;
          cursor:pointer;
        }

        .gs-btn:hover:not(:disabled) {
          background:#eff4eb;
        }

        .gs-primary {
          background:#204d36;
          border-color:#204d36;
          color:white;
        }

        .gs-primary:hover:not(:disabled) {
          background:#153b29;
        }

        .gs-danger {
          color:#a33d35;
          border-color:#e9c4bd;
        }

        .gs-page button:disabled {
          opacity:.55;
          cursor:not-allowed;
        }

        .gs-page :is(button,input,select,textarea):focus-visible {
          outline:3px solid #b99c59;
          outline-offset:3px;
        }

        .gs-actions {
          display:flex;
          gap:9px;
          flex-wrap:wrap;
          margin-top:18px;
        }

        .gs-alert {
          padding:13px 16px;
          margin-bottom:18px;
          border-radius:10px;
          background:#eef4e9;
          color:#45633f;
          font-size:13px;
          line-height:1.7;
        }

        .gs-error {
          background:#fff0ed;
          color:#a13f31;
        }

        .gs-success {
          background:#e8f6ec;
          color:#28623c;
        }

        .gs-error-text {
          color:#a13f31;
          font-size:12px;
          font-weight:400;
        }

        .gs-filters {
          display:grid;
          grid-template-columns:repeat(4,1fr);
          gap:14px;
        }

        .gs-list-title {
          margin:25px 0 17px;
        }

        .gs-list-title h3 {
          margin:0;
        }

        .gs-badges {
          display:flex;
          gap:7px;
          flex-wrap:wrap;
        }

        .gs-badge {
          padding:6px 10px;
          border-radius:7px;
          font-size:11px;
          font-weight:700;
          background:#f2eedf;
          color:#83692d;
        }

        .gs-badge.in_progress {
          background:#e8f0fa;
          color:#3f6394;
        }

        .gs-badge.completed {
          background:#e6f4e9;
          color:#367344;
        }

        .gs-badge.cancelled {
          background:#f9e9e7;
          color:#9b5046;
        }

        .gs-badge.high {
          background:#fff0dc;
          color:#935e18;
        }

        .gs-details {
          display:grid;
          grid-template-columns:repeat(3,minmax(0,1fr));
          gap:17px;
          margin:20px 0;
        }

        .gs-details dt {
          color:#798570;
          font-size:11px;
          margin-bottom:5px;
        }

        .gs-details dd {
          margin:0;
          font-size:13px;
          line-height:1.6;
          overflow-wrap:anywhere;
        }

        .gs-notes {
          white-space:pre-wrap;
          overflow-wrap:anywhere;
          font-size:13px;
          line-height:1.7;
          color:#5c705d;
        }

        .gs-action-panel {
          margin-top:20px;
          padding:20px;
          border:1px solid #d2dfc9;
          border-radius:12px;
          background:#f7f9f3;
        }

        .gs-action-panel h4 {
          margin:0 0 15px;
        }

        .gs-empty {
          text-align:center;
          padding:38px 20px;
          color:#6d7e66;
          background:#fafbf6;
          border:1px dashed #cedbc5;
          border-radius:14px;
          line-height:1.8;
        }

        .gs-pagination {
          margin-top:20px;
          font-size:13px;
          color:#6c7a63;
        }

        .gs-pagination .gs-actions {
          margin-top:0;
        }

        @media(max-width:1000px) {
          .gs-filters {
            grid-template-columns:1fr 1fr;
          }
        }

        @media(max-width:650px) {
          .gs-grid,
          .gs-filters,
          .gs-details {
            grid-template-columns:1fr;
          }

          .gs-panel,
          .gs-card {
            padding:18px;
          }

          .gs-head h2 {
            font-size:26px;
          }
        }
      `}</style>

      <div className="gs-head">
        <div>
          <span className="gs-eyebrow">
            LuxuryStay Hospitality
          </span>
          <h2>Guest Services</h2>
          <div className="gs-muted">
            Coordinate requests and track services throughout each stay.
          </div>
        </div>

        <button
          className="gs-btn"
          type="button"
          disabled={busy || loading}
          onClick={() => {
            setAction(null);
            setRefresh((value) => value + 1);
          }}
        >
          Refresh
        </button>
      </div>

      {success && (
        <div className="gs-alert gs-success" role="status">
          {success}
        </div>
      )}

      <section className="gs-panel">
        <h3>New service request</h3>

        <p className="gs-muted">
          Select a checked-in guest. Scheduled times below use Pakistan
          Standard Time (UTC+05:00).
        </p>

        {stays.error && (
          <div className="gs-alert gs-error" role="alert">
            {stays.error}
          </div>
        )}

        {!stays.loading && !stays.error && !stays.items.length && (
          <div className="gs-alert" role="status">
            No guests are currently checked in. Check in a reservation
            before creating a service request.
          </div>
        )}

        {formError && (
          <div className="gs-alert gs-error" role="alert">
            {formError}
          </div>
        )}

        <form onSubmit={createRequest}>
          <fieldset disabled={busy}>
            <div className="gs-grid">
              <label className="gs-field gs-full">
                Checked-in guest *
                <select
                  name="reservation"
                  value={form.reservation}
                  onChange={updateForm}
                  required
                  disabled={
                    busy || stays.loading || Boolean(stays.error)
                  }
                >
                  <option value="">
                    {stays.loading
                      ? "Loading stays..."
                      : "Select a guest"}
                  </option>

                  {stays.items.map((stay) => (
                    <option key={stay._id} value={stay._id}>
                      {stay.guestName} — {stay.bookingReference} —{" "}
                      {stay.hotel?.name || "Hotel"} — Room{" "}
                      {stay.room?.roomNumber || "—"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="gs-field">
                Service type *
                <select
                  name="serviceType"
                  value={form.serviceType}
                  onChange={updateForm}
                >
                  {Object.entries(TYPES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="gs-field">
                Priority
                <select
                  name="priority"
                  value={form.priority}
                  onChange={updateForm}
                >
                  {Object.entries(PRIORITIES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="gs-field gs-full">
                Request title *
                <input
                  name="title"
                  value={form.title}
                  onChange={updateForm}
                  required
                  minLength={3}
                  maxLength={150}
                  placeholder="For example: Breakfast for two"
                />
              </label>

              <label className="gs-field">
                Quantity *
                <input
                  type="number"
                  name="quantity"
                  value={form.quantity}
                  onChange={updateForm}
                  min="1"
                  max="100"
                  step="1"
                  required
                />
              </label>

              <label className="gs-field">
                Requested date and time
                <input
                  type="datetime-local"
                  name="requestedFor"
                  value={form.requestedFor}
                  onChange={updateForm}
                  step="60"
                  required={form.serviceType === "wake_up_call"}
                />
                <small>
                  Pakistan time. Leave blank for as soon as possible.
                  Required for wake-up calls.
                </small>
              </label>

              <StaffSelect
                options={createStaff}
                hotelId={selectedHotelId}
                value={form.assignedTo}
                disabled={busy}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    assignedTo: event.target.value,
                  }))
                }
              />

              <label className="gs-field">
                Total service charge {selectedStay?.currency || ""}
                <input
                  name="charge"
                  inputMode="decimal"
                  value={form.charge}
                  onChange={updateForm}
                  maxLength={17}
                  placeholder="For example: 500.00"
                />
                <small>
                  Total for all quantities, before tax. Blank means not
                  priced; 0 means free.
                </small>
              </label>

              <label className="gs-field gs-full">
                Request details
                <textarea
                  name="description"
                  value={form.description}
                  onChange={updateForm}
                  maxLength={2000}
                  placeholder="Guest instructions and service details..."
                />
              </label>
            </div>

            <div className="gs-actions">
              <button
                type="submit"
                className="gs-btn gs-primary"
                disabled={
                  busy ||
                  stays.loading ||
                  Boolean(stays.error) ||
                  !selectedStay
                }
              >
                {busy && !action ? "Creating..." : "Create request"}
              </button>

              <button
                type="button"
                className="gs-btn"
                onClick={() => {
                  setForm({ ...EMPTY_FORM });
                  setFormError("");
                }}
              >
                Clear form
              </button>
            </div>
          </fieldset>
        </form>
      </section>

      <section className="gs-panel" aria-label="Service filters">
        {hotels.error && (
          <div className="gs-alert gs-error" role="alert">
            Hotel filter: {hotels.error}
          </div>
        )}

        <div className="gs-filters">
          <label className="gs-field">
            Hotel
            <select
              name="hotel"
              value={filters.hotel}
              onChange={updateFilter}
              disabled={busy || hotels.loading}
            >
              <option value="">All hotels</option>

              {hotels.items.map((hotel) => (
                <option key={hotel._id} value={hotel._id}>
                  {hotel.name}
                </option>
              ))}
            </select>
          </label>

          <label className="gs-field">
            Status
            <select
              name="status"
              value={filters.status}
              onChange={updateFilter}
              disabled={busy}
            >
              <option value="">All statuses</option>

              {Object.entries(STATUSES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="gs-field">
            Service type
            <select
              name="serviceType"
              value={filters.serviceType}
              onChange={updateFilter}
              disabled={busy}
            >
              <option value="">All services</option>

              {Object.entries(TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="gs-field">
            Priority
            <select
              name="priority"
              value={filters.priority}
              onChange={updateFilter}
              disabled={busy}
            >
              <option value="">All priorities</option>

              {Object.entries(PRIORITIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <div className="gs-row gs-list-title">
        <h3>Service requests</h3>

        {!loading && !listError && (
          <span className="gs-muted">
            {pagination.total} requests
          </span>
        )}
      </div>

      {listError && (
        <div className="gs-alert gs-error" role="alert">
          {listError}

          <div className="gs-actions">
            <button
              type="button"
              className="gs-btn"
              disabled={busy}
              onClick={() => setRefresh((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        </div>
      )}

      <div aria-busy={loading}>
        {loading ? (
          <div className="gs-empty" role="status">
            Loading service requests...
          </div>
        ) : !listError && !requests.length ? (
          <div className="gs-empty">
            No service requests match these filters.
          </div>
        ) : !listError ? (
          requests.map((request) => {
            const open = ["pending", "in_progress"].includes(
              request.status
            );

            const checkedIn =
              request.reservation?.status === "checked_in";

            const selected =
              action?.request._id === request._id;

            return (
              <article className="gs-card" key={request._id}>
                <div className="gs-row">
                  <div>
                    <h3>{request.title}</h3>

                    <span className="gs-muted">
                      {TYPES[request.serviceType] ||
                        request.serviceType}
                    </span>
                  </div>

                  <div className="gs-badges">
                    <span className={`gs-badge ${request.status}`}>
                      {STATUSES[request.status] || request.status}
                    </span>

                    <span className={`gs-badge ${request.priority}`}>
                      {PRIORITIES[request.priority]} priority
                    </span>
                  </div>
                </div>

                <dl className="gs-details">
                  <div>
                    <dt>Guest</dt>
                    <dd>{request.guestName}</dd>
                  </div>

                  <div>
                    <dt>Hotel / room</dt>
                    <dd>
                      {request.hotel?.name || "—"} /{" "}
                      {request.room?.roomNumber || "—"}
                    </dd>
                  </div>

                  <div>
                    <dt>Reservation</dt>
                    <dd>
                      {request.reservation?.bookingReference || "—"}
                    </dd>
                  </div>

                  <div>
                    <dt>Assigned employee</dt>
                    <dd>
                      {request.assignedTo?.name || "Unassigned"}
                    </dd>
                  </div>

                  <div>
                    <dt>Quantity</dt>
                    <dd>{request.quantity}</dd>
                  </div>

                  <div>
                    <dt>Total charge before tax</dt>
                    <dd>
                      {showCharge(
                        request.chargeMinor,
                        request.currency
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt>Requested for · Pakistan time</dt>
                    <dd>
                      {request.requestedFor
                        ? formatDate(request.requestedFor)
                        : "As soon as possible"}
                    </dd>
                  </div>

                  <div>
                    <dt>Created · Pakistan time</dt>
                    <dd>{formatDate(request.createdAt)}</dd>
                  </div>

                  <div>
                    <dt>Created by</dt>
                    <dd>{request.createdBy?.name || "—"}</dd>
                  </div>
                </dl>

                {request.description && (
                  <p className="gs-notes">
                    {request.description}
                  </p>
                )}

                {request.startedAt && (
                  <p className="gs-muted">
                    Started: {formatDate(request.startedAt)}
                  </p>
                )}

                {request.status === "completed" && (
                  <div className="gs-alert gs-success">
                    Completed: {formatDate(request.completedAt)} by{" "}
                    {request.completedBy?.name || "Staff"}

                    {request.completionNotes && (
                      <div className="gs-notes">
                        {request.completionNotes}
                      </div>
                    )}
                  </div>
                )}

                {request.status === "cancelled" && (
                  <div className="gs-alert">
                    Cancelled: {formatDate(request.cancelledAt)} by{" "}
                    {request.cancelledBy?.name || "Staff"}

                    <div className="gs-notes">
                      {request.cancellationReason}
                    </div>
                  </div>
                )}

                {open && !checkedIn && (
                  <div className="gs-alert">
                    This reservation is no longer checked in. Only
                    cancellation is available for this outstanding
                    request.
                  </div>
                )}

                {open && (
                  <div className="gs-actions">
                    {checkedIn && (
                      <button
                        className="gs-btn"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          openAction("assign", request)
                        }
                      >
                        Assign employee
                      </button>
                    )}

                    {checkedIn && request.status === "pending" && (
                      <button
                        className="gs-btn gs-primary"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          openAction("start", request)
                        }
                      >
                        Start service
                      </button>
                    )}

                    {checkedIn &&
                      request.status === "in_progress" && (
                        <button
                          className="gs-btn gs-primary"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            openAction("complete", request)
                          }
                        >
                          Complete service
                        </button>
                      )}

                    <button
                      className="gs-btn gs-danger"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        openAction("cancel", request)
                      }
                    >
                      Cancel request
                    </button>
                  </div>
                )}

                {selected && (
                  <form
                    className="gs-action-panel"
                    onSubmit={submitAction}
                  >
                    <h4>{actionTitles[action.type]}</h4>

                    {actionError && (
                      <div
                        className="gs-alert gs-error"
                        role="alert"
                      >
                        {actionError}
                      </div>
                    )}

                    <fieldset disabled={busy}>
                      {action.type === "assign" && (
                        <StaffSelect
                          options={actionStaff}
                          hotelId={actionHotelId}
                          value={actionForm.assignedTo}
                          current={request.assignedTo}
                          disabled={busy}
                          onChange={(event) =>
                            setActionForm((current) => ({
                              ...current,
                              assignedTo: event.target.value,
                            }))
                          }
                        />
                      )}

                      {action.type === "start" && (
                        <p className="gs-muted">
                          Confirm that work on this service is
                          starting now.
                        </p>
                      )}

                      {action.type === "complete" && (
                        <div className="gs-grid">
                          <label className="gs-field">
                            Final total charge ({request.currency}) *
                            <input
                              value={actionForm.charge}
                              inputMode="decimal"
                              maxLength={17}
                              required
                              onChange={(event) =>
                                setActionForm((current) => ({
                                  ...current,
                                  charge: event.target.value,
                                }))
                              }
                            />
                            <small>
                              Total for all quantities before tax.
                              Enter 0 for a free service.
                            </small>
                          </label>

                          <label className="gs-field">
                            Completion notes
                            <textarea
                              value={actionForm.notes}
                              maxLength={2000}
                              onChange={(event) =>
                                setActionForm((current) => ({
                                  ...current,
                                  notes: event.target.value,
                                }))
                              }
                            />
                          </label>
                        </div>
                      )}

                      {action.type === "cancel" && (
                        <label className="gs-field">
                          Cancellation reason *
                          <textarea
                            value={actionForm.reason}
                            minLength={3}
                            maxLength={500}
                            required
                            onChange={(event) =>
                              setActionForm((current) => ({
                                ...current,
                                reason: event.target.value,
                              }))
                            }
                          />
                        </label>
                      )}

                      <div className="gs-actions">
                        <button
                          type="submit"
                          className="gs-btn gs-primary"
                          disabled={
                            busy ||
                            (action.type === "assign" &&
                              actionStaff.loading)
                          }
                        >
                          {busy ? "Saving..." : "Confirm"}
                        </button>

                        <button
                          type="button"
                          className="gs-btn"
                          onClick={closeAction}
                        >
                          Close
                        </button>
                      </div>
                    </fieldset>
                  </form>
                )}
              </article>
            );
          })
        ) : null}
      </div>

      {!listError && (
        <div className="gs-pagination">
          <span>
            {loading
              ? "Loading..."
              : `Page ${page} of ${pagination.pages}`}
          </span>

          <div className="gs-actions">
            <button
              type="button"
              className="gs-btn"
              disabled={busy || loading || page <= 1}
              onClick={() => {
                setAction(null);
                setPage((value) => value - 1);
              }}
            >
              Previous
            </button>

            <button
              type="button"
              className="gs-btn"
              disabled={
                busy || loading || page >= pagination.pages
              }
              onClick={() => {
                setAction(null);
                setPage((value) => value + 1);
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}