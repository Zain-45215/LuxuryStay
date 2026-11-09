import { useEffect, useRef, useState } from "react";

const EMPTY_FORM = {
  hotel: "",
  room: "",
  taskType: "checkout_cleaning",
  priority: "normal",
  assignedTo: "",
  scheduledFor: "",
  instructions: "",
};

const STATUS_LABELS = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const TYPE_LABELS = {
  checkout_cleaning: "Checkout cleaning",
  regular_cleaning: "Regular cleaning",
  deep_cleaning: "Deep cleaning",
};

function getId(value) {
  return typeof value === "string" ? value : value?._id || "";
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

async function loadAll(path, key, signal) {
  const items = new Map();
  let page = 1;
  let pages = 1;

  do {
    const separator = path.includes("?") ? "&" : "?";
    const data = await api(
      `${path}${separator}page=${page}&limit=100`,
      { signal }
    );

    if (!Array.isArray(data[key])) {
      throw new Error("Invalid list received from the server.");
    }

    data[key].forEach((item) => items.set(item._id, item));
    pages = Math.max(1, data.pagination?.pages || 1);
    page += 1;
  } while (page <= pages);

  return Array.from(items.values());
}

function formatTime(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(date);
}

// Load eligible staff separately for each selected hotel.
// The key prevents an earlier hotel's results from being displayed.
function useHousekeepingStaff(hotel, refresh) {
  const requestKey = `${hotel}:${refresh}`;

  const [state, setState] = useState({
    key: "",
    items: [],
    loading: false,
    error: "",
  });

  useEffect(() => {
    const controller = new AbortController();

    setState({
      key: requestKey,
      items: [],
      loading: Boolean(hotel),
      error: "",
    });

    if (!hotel) return () => controller.abort();

    async function loadStaff() {
      try {
        const params = new URLSearchParams({
          hotel,
          role: "housekeeping",
          active: "true",
        });

        const result = await loadAll(
          `/staff?${params}`,
          "staff",
          controller.signal
        );

        if (controller.signal.aborted) return;

        const eligible = result
          .filter(
            (member) =>
              member.isActive &&
              member.role === "housekeeping" &&
              getId(member.hotel) === hotel
          )
          .sort((a, b) => a.name.localeCompare(b.name));

        setState({
          key: requestKey,
          items: eligible,
          loading: false,
          error: "",
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            key: requestKey,
            items: [],
            loading: false,
            error: error.message,
          });
        }
      }
    }

    loadStaff();

    return () => controller.abort();
  }, [hotel, requestKey]);

  if (state.key !== requestKey) {
    return {
      items: [],
      loading: Boolean(hotel),
      error: "",
    };
  }

  return state;
}

export default function HousekeepingManagement() {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [hotels, setHotels] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [tasks, setTasks] = useState([]);

  const [hotelsLoading, setHotelsLoading] = useState(true);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  const [hotelError, setHotelError] = useState("");
  const [roomError, setRoomError] = useState("");
  const [listError, setListError] = useState("");
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");

  const [hotelFilter, setHotelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [refresh, setRefresh] = useState(0);

  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [actionText, setActionText] = useState("");
  const [assignment, setAssignment] = useState("");

  const lock = useRef(false);
  const mounted = useRef(false);

  const formStaff = useHousekeepingStaff(form.hotel, refresh);

  const assignmentHotel =
    selected?.action === "assign" ? getId(selected.task.hotel) : "";

  const assignmentStaff = useHousekeepingStaff(
    assignmentHotel,
    refresh
  );

  const assignmentUnavailable =
    Boolean(assignment) &&
    !assignmentStaff.items.some((member) => member._id === assignment);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadHotels() {
      setHotelsLoading(true);
      setHotelError("");

      try {
        const result = await loadAll(
          "/hotels",
          "hotels",
          controller.signal
        );

        if (!controller.signal.aborted) setHotels(result);
      } catch (error) {
        if (!controller.signal.aborted) {
          setHotels([]);
          setHotelError(error.message);
        }
      } finally {
        if (!controller.signal.aborted) setHotelsLoading(false);
      }
    }

    loadHotels();

    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();

    setRooms([]);
    setRoomError("");

    if (!form.hotel) {
      setRoomsLoading(false);
      return () => controller.abort();
    }

    async function loadRooms() {
      setRoomsLoading(true);

      try {
        const result = await loadAll(
          `/rooms?hotel=${encodeURIComponent(form.hotel)}&active=true`,
          "rooms",
          controller.signal
        );

        if (!controller.signal.aborted) {
          setRooms(
            result.filter(
              (room) =>
                getId(room.hotel) === form.hotel &&
                ["available", "cleaning"].includes(room.status)
            )
          );
        }
      } catch (error) {
        if (!controller.signal.aborted) setRoomError(error.message);
      } finally {
        if (!controller.signal.aborted) setRoomsLoading(false);
      }
    }

    loadRooms();

    return () => controller.abort();
  }, [form.hotel, refresh]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadTasks() {
      setLoading(true);
      setListError("");
      setTasks([]);

      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: "10",
        });

        if (hotelFilter) params.set("hotel", hotelFilter);
        if (statusFilter) params.set("status", statusFilter);

        const data = await api(`/housekeeping?${params}`, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (!Array.isArray(data.tasks)) {
          throw new Error("Invalid task list received from the server.");
        }

        const pages = Math.max(1, data.pagination?.pages || 1);

        if (page > pages) {
          setPage(pages);
          return;
        }

        setTasks(data.tasks);
        setPagination({
          total: data.pagination?.total || 0,
          pages,
        });
      } catch (error) {
        if (!controller.signal.aborted) setListError(error.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadTasks();

    return () => controller.abort();
  }, [hotelFilter, statusFilter, page, refresh]);

  function updateForm(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "hotel" ? { room: "", assignedTo: "" } : {}),
    }));

    setFormError("");
  }

  function resetAction() {
    setSelected(null);
    setActionText("");
    setAssignment("");
    setActionError("");
  }

  async function createTask(event) {
    event.preventDefault();
    if (lock.current) return;

    setFormError("");
    setSuccess("");

    const hotel = hotels.find((item) => item._id === form.hotel);
    const room = rooms.find((item) => item._id === form.room);

    if (
      hotelsLoading ||
      roomsLoading ||
      !hotel?.isActive ||
      !room ||
      getId(room.hotel) !== form.hotel
    ) {
      setFormError("Select an active hotel and an eligible room.");
      return;
    }

    if (
      form.assignedTo &&
      (
        formStaff.loading ||
        formStaff.error ||
        !formStaff.items.some((member) => member._id === form.assignedTo)
      )
    ) {
      setFormError(
        "Choose an active housekeeping staff member for this hotel, or select Unassigned."
      );
      return;
    }

    const payload = {
      hotel: form.hotel,
      room: form.room,
      taskType: form.taskType,
      priority: form.priority,
      assignedTo: form.assignedTo || null,
      instructions: form.instructions.trim(),
    };

    if (form.scheduledFor) {
      const date = new Date(form.scheduledFor);

      if (Number.isNaN(date.getTime())) {
        setFormError("Choose a valid scheduled time.");
        return;
      }

      payload.scheduledFor = date.toISOString();
    }

    lock.current = true;
    setBusy(true);

    try {
      const data = await api("/housekeeping", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!mounted.current) return;

      setSuccess(data.message || "Cleaning task created successfully.");
      setForm({ ...EMPTY_FORM, hotel: payload.hotel });
      setHotelFilter(payload.hotel);
      setStatusFilter("");
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

  function openAction(task, action) {
    if (lock.current) return;

    setSelected({ task, action });
    setActionText("");
    setAssignment(action === "assign" ? getId(task.assignedTo) : "");
    setActionError("");
    setSuccess("");
  }

  async function submitAction(event) {
    event.preventDefault();
    if (!selected || lock.current) return;

    setActionError("");

    const { task, action } = selected;
    const text = actionText.trim();

    if (action === "cancel" && !text) {
      setActionError("Please enter a cancellation reason.");
      return;
    }

    if (action === "assign") {
      if (
        assignment &&
        (
          assignmentStaff.loading ||
          assignmentStaff.error ||
          assignmentUnavailable
        )
      ) {
        setActionError(
          "Choose an eligible staff member, or select Unassigned."
        );
        return;
      }

      if (assignment === getId(task.assignedTo)) {
        setActionError("Choose a different staff member or select Unassigned.");
        return;
      }
    }

    const body =
      action === "assign"
        ? { assignedTo: assignment || null }
        : action === "complete"
        ? { completionNotes: text }
        : action === "cancel"
        ? { reason: text }
        : {};

    lock.current = true;
    setBusy(true);

    try {
      const data = await api(`/housekeeping/${task._id}/${action}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

      if (!mounted.current) return;

      setSuccess(
        data.message ||
          (action === "assign"
            ? "Staff assignment updated successfully."
            : "Task updated successfully.")
      );

      resetAction();
      setRefresh((value) => value + 1);
    } catch (error) {
      if (mounted.current) setActionError(error.message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="hk-page">
      <style>{`
        .hk-page { color:#243d30; }
        .hk-page * { box-sizing:border-box; }
        .hk-page h2 {
          margin:0 0 8px;
          font-size:28px;
          color:#173f2e;
        }
        .hk-page h3 {
          margin:0 0 10px;
          font-size:19px;
          color:#173f2e;
        }
        .hk-page p { margin:0; line-height:1.7; }
        .hk-muted { color:#65766a; font-size:13px; }
        .hk-heading,.hk-row,.hk-actions {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:14px;
          flex-wrap:wrap;
        }
        .hk-heading { margin-bottom:22px; }
        .hk-actions { justify-content:flex-start; }
        .hk-panel,.hk-card {
          background:white;
          border:1px solid #dfe6dc;
          border-radius:16px;
          padding:24px;
          margin-bottom:18px;
        }
        .hk-page fieldset {
          border:0;
          padding:0;
          margin:0;
          min-width:0;
        }
        .hk-grid {
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:18px;
          margin-top:20px;
        }
        .hk-wide { grid-column:1 / -1; }
        .hk-page label {
          display:block;
          margin:0;
          font-size:13px;
          font-weight:600;
          color:#324c39;
        }
        .hk-page input,.hk-page select,.hk-page textarea {
          width:100%;
          min-width:0;
          margin:8px 0 0;
          padding:11px 12px;
          border:1px solid #ccd8cc;
          border-radius:9px;
          background:white;
          color:#233d2d;
          font:inherit;
          font-size:14px;
        }
        .hk-page textarea { resize:vertical; min-height:85px; }
        .hk-page button {
          width:auto;
          margin:0;
          padding:10px 15px;
          border:1px solid #d3decf;
          border-radius:9px;
          background:white;
          color:#244b33;
          font:inherit;
          font-size:13px;
          font-weight:600;
          cursor:pointer;
        }
        .hk-page button:hover:not(:disabled) {
          background:#edf4e9;
        }
        .hk-page button.hk-primary {
          background:#225339;
          color:white;
          border-color:#225339;
        }
        .hk-page button.hk-primary:hover:not(:disabled) {
          background:#173f2a;
        }
        .hk-page button.hk-danger {
          color:#a24032;
          border-color:#e7c8c1;
        }
        .hk-page button:disabled {
          opacity:.55;
          cursor:not-allowed;
        }
        .hk-page :is(button,input,select,textarea):focus-visible {
          outline:3px solid #b39a5b;
          outline-offset:3px;
        }
        .hk-message {
          margin:15px 0;
          padding:13px 16px;
          border-radius:10px;
          font-size:14px;
          line-height:1.6;
          overflow-wrap:anywhere;
        }
        .hk-error { background:#fff0ed; color:#963b30; }
        .hk-success { background:#e8f5e9; color:#245b33; }
        .hk-notice {
          margin:18px 0;
          padding:13px 16px;
          background:#f8f3e7;
          border-radius:10px;
          color:#756039;
          font-size:13px;
          line-height:1.7;
        }
        .hk-help {
          display:block;
          margin-top:8px;
          font-size:12px;
          font-weight:400;
          color:#6c7b6c;
          line-height:1.6;
        }
        .hk-filters {
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:16px;
          margin:20px 0;
        }
        .hk-badges { display:flex; gap:8px; flex-wrap:wrap; }
        .hk-badge {
          padding:6px 10px;
          background:#f0f3ec;
          color:#4a6047;
          border-radius:20px;
          font-size:12px;
        }
        .hk-badge.pending { background:#fff2d4; color:#7c5a14; }
        .hk-badge.in_progress { background:#e5eefb; color:#345f91; }
        .hk-badge.completed { background:#e6f3e6; color:#2f6b37; }
        .hk-badge.cancelled { background:#f6e9e7; color:#8a4d42; }
        .hk-details {
          display:grid;
          grid-template-columns:repeat(3,minmax(0,1fr));
          gap:16px;
          margin:20px 0;
          padding:17px 0;
          border-top:1px solid #edf0e8;
          border-bottom:1px solid #edf0e8;
        }
        .hk-details dt {
          color:#6c7b6c;
          font-size:12px;
          margin-bottom:6px;
        }
        .hk-details dd {
          margin:0;
          font-size:14px;
          overflow-wrap:anywhere;
        }
        .hk-note {
          margin-bottom:14px !important;
          white-space:pre-wrap;
          overflow-wrap:anywhere;
          font-size:13px;
        }
        .hk-confirm {
          margin-top:18px;
          padding:18px;
          border-radius:12px;
          background:#f4f5ee;
        }
        .hk-confirm > label { margin-top:14px; }
        .hk-confirm .hk-actions { margin-top:16px; }
        .hk-empty {
          text-align:center;
          padding:35px 15px;
          color:#687868;
        }
        @media(max-width:650px) {
          .hk-grid,.hk-filters,.hk-details {
            grid-template-columns:1fr;
          }
          .hk-panel,.hk-card { padding:18px; }
          .hk-page h2 { font-size:24px; }
        }
      `}</style>

      <div className="hk-heading">
        <div>
          <h2>Housekeeping</h2>
          <p className="hk-muted">
            Organize cleaning tasks, assign staff and prepare rooms for guests.
          </p>
        </div>

        <button
          type="button"
          disabled={busy || loading || hotelsLoading || roomsLoading}
          onClick={() => {
            resetAction();
            setRefresh((value) => value + 1);
          }}
        >
          Refresh
        </button>
      </div>

      {success && (
        <div className="hk-message hk-success" role="status">
          {success}
        </div>
      )}

      <section className="hk-panel">
        <h3>Create cleaning task</h3>
        <p className="hk-muted">
          Select a vacant room. Occupied and maintenance rooms cannot be selected.
        </p>

        {hotelError && (
          <div className="hk-message hk-error" role="alert">
            {hotelError}
          </div>
        )}
        {roomError && (
          <div className="hk-message hk-error" role="alert">
            {roomError}
          </div>
        )}
        {formError && (
          <div className="hk-message hk-error" role="alert">
            {formError}
          </div>
        )}

        <form onSubmit={createTask}>
          <fieldset disabled={busy}>
            <div className="hk-grid">
              <label>
                Hotel *
                <select
                  name="hotel"
                  value={form.hotel}
                  onChange={updateForm}
                  required
                  disabled={hotelsLoading}
                >
                  <option value="">
                    {hotelsLoading ? "Loading hotels..." : "Select hotel"}
                  </option>
                  {hotels
                    .filter((hotel) => hotel.isActive)
                    .map((hotel) => (
                      <option key={hotel._id} value={hotel._id}>
                        {hotel.name} — {hotel.code}
                      </option>
                    ))}
                </select>
              </label>

              <label>
                Room *
                <select
                  name="room"
                  value={form.room}
                  onChange={updateForm}
                  required
                  disabled={!form.hotel || roomsLoading}
                >
                  <option value="">
                    {roomsLoading ? "Loading rooms..." : "Select room"}
                  </option>
                  {rooms.map((room) => (
                    <option key={room._id} value={room._id}>
                      Room {room.roomNumber} — {room.status}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Cleaning type
                <select
                  name="taskType"
                  value={form.taskType}
                  onChange={updateForm}
                >
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>

              <label>
                Priority
                <select
                  name="priority"
                  value={form.priority}
                  onChange={updateForm}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </label>

              <div className="hk-wide">
                <label>
                  Assigned housekeeping staff — optional
                  <select
                    name="assignedTo"
                    value={form.assignedTo}
                    onChange={updateForm}
                    disabled={!form.hotel || formStaff.loading}
                  >
                    <option value="">
                      {formStaff.loading ? "Loading staff..." : "Unassigned"}
                    </option>

                    {form.assignedTo &&
                      !formStaff.items.some(
                        (member) => member._id === form.assignedTo
                      ) && (
                        <option value={form.assignedTo} disabled>
                          Previously selected staff — unavailable
                        </option>
                      )}

                    {formStaff.items.map((member) => (
                      <option key={member._id} value={member._id}>
                        {member.name} — {member.email}
                      </option>
                    ))}
                  </select>
                </label>

                <small className="hk-help">
                  Only active housekeeping staff assigned to this hotel appear.
                  You can leave the task unassigned.
                </small>

                {form.hotel &&
                  !formStaff.loading &&
                  !formStaff.error &&
                  formStaff.items.length === 0 && (
                    <div className="hk-notice">
                      No eligible staff found. Add a staff account under
                      Staff & Roles, select Housekeeping and assign this hotel.
                      Then return here and press Refresh.
                    </div>
                  )}

                {formStaff.error && (
                  <div className="hk-message hk-error" role="alert">
                    Could not load staff: {formStaff.error}
                  </div>
                )}
              </div>

              <label className="hk-wide">
                Target cleaning time — optional, your computer’s local time
                <input
                  type="datetime-local"
                  name="scheduledFor"
                  value={form.scheduledFor}
                  onChange={updateForm}
                />
              </label>

              <label className="hk-wide">
                Instructions
                <textarea
                  name="instructions"
                  value={form.instructions}
                  onChange={updateForm}
                  maxLength={2000}
                  placeholder="For example: replace linen and restock toiletries."
                />
              </label>
            </div>

            <div className="hk-notice">
              Creating this task immediately marks the room as cleaning,
              even if you choose a later target time. Leave the time blank
              to schedule it now.
            </div>

            <button
              className="hk-primary"
              type="submit"
              disabled={
                busy ||
                hotelsLoading ||
                roomsLoading ||
                !form.hotel ||
                !form.room ||
                Boolean(hotelError || roomError) ||
                Boolean(
                  form.assignedTo &&
                  (formStaff.loading || formStaff.error)
                )
              }
            >
              {busy ? "Processing..." : "Create cleaning task"}
            </button>
          </fieldset>
        </form>
      </section>

      <section className="hk-panel">
        <h3>Cleaning tasks</h3>
        <p className="hk-muted">
          Assign staff, start a pending task and complete it once the room is ready.
        </p>

        <div className="hk-filters">
          <label>
            Hotel
            <select
              value={hotelFilter}
              disabled={busy}
              onChange={(event) => {
                setHotelFilter(event.target.value);
                setPage(1);
                resetAction();
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
            Status
            <select
              value={statusFilter}
              disabled={busy}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
                resetAction();
              }}
            >
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        {listError && (
          <div className="hk-message hk-error" role="alert">
            {listError}
          </div>
        )}

        {loading ? (
          <div className="hk-empty" role="status">
            Loading cleaning tasks...
          </div>
        ) : !listError && tasks.length === 0 ? (
          <div className="hk-empty">No cleaning tasks found.</div>
        ) : !listError ? (
          <>
            {tasks.map((task) => {
              const isActive = ["pending", "in_progress"].includes(task.status);
              const isSelected = selected?.task._id === task._id;

              return (
                <article className="hk-card" key={task._id}>
                  <div className="hk-row">
                    <div>
                      <h3>Room {task.room?.roomNumber || "—"}</h3>
                      <p className="hk-muted">
                        {task.hotel?.name || "Hotel unavailable"} ·{" "}
                        {TYPE_LABELS[task.taskType] || task.taskType}
                      </p>
                    </div>

                    <div className="hk-badges">
                      <span className={`hk-badge ${task.status}`}>
                        {STATUS_LABELS[task.status] || task.status}
                      </span>
                      <span className="hk-badge">
                        {task.priority} priority
                      </span>
                    </div>
                  </div>

                  <dl className="hk-details">
                    <div>
                      <dt>Scheduled (Pakistan time)</dt>
                      <dd>{formatTime(task.scheduledFor)}</dd>
                    </div>
                    <div>
                      <dt>Assigned staff</dt>
                      <dd>{task.assignedTo?.name || "Unassigned"}</dd>
                    </div>
                    <div>
                      <dt>Current room status</dt>
                      <dd>{task.room?.status || "—"}</dd>
                    </div>
                    <div>
                      <dt>Started (Pakistan time)</dt>
                      <dd>{formatTime(task.startedAt)}</dd>
                    </div>
                    <div>
                      <dt>Completed (Pakistan time)</dt>
                      <dd>{formatTime(task.completedAt)}</dd>
                    </div>
                    <div>
                      <dt>Completed by</dt>
                      <dd>{task.completedBy?.name || "—"}</dd>
                    </div>
                  </dl>

                  {task.instructions && (
                    <p className="hk-note">
                      <strong>Instructions: </strong>{task.instructions}
                    </p>
                  )}
                  {task.completionNotes && (
                    <p className="hk-note">
                      <strong>Completion notes: </strong>{task.completionNotes}
                    </p>
                  )}
                  {task.cancellationReason && (
                    <p className="hk-note">
                      <strong>Cancellation reason: </strong>
                      {task.cancellationReason}
                    </p>
                  )}

                  {isActive && !isSelected && (
                    <div className="hk-actions">
                      {task.status === "pending" ? (
                        <button
                          type="button"
                          className="hk-primary"
                          disabled={busy}
                          onClick={() => openAction(task, "start")}
                        >
                          Start cleaning
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="hk-primary"
                          disabled={busy}
                          onClick={() => openAction(task, "complete")}
                        >
                          Complete cleaning
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openAction(task, "assign")}
                      >
                        {task.assignedTo ? "Change staff" : "Assign staff"}
                      </button>

                      <button
                        type="button"
                        className="hk-danger"
                        disabled={busy}
                        onClick={() => openAction(task, "cancel")}
                      >
                        Cancel task
                      </button>
                    </div>
                  )}

                  {isSelected && (
                    <form className="hk-confirm" onSubmit={submitAction}>
                      <p>
                        {selected.action === "assign"
                          ? "Choose housekeeping staff for this hotel's task, or remove the assignment."
                          : selected.action === "start"
                          ? "Confirm that cleaning is starting for this room."
                          : selected.action === "complete"
                          ? "Confirm the room has been cleaned and is ready. It will be marked available."
                          : "Cancel this task? The room status will remain unchanged."}
                      </p>

                      {selected.action === "assign" && (
                        <>
                          <label>
                            Assigned staff
                            <select
                              value={assignment}
                              disabled={busy || assignmentStaff.loading}
                              onChange={(event) => {
                                setAssignment(event.target.value);
                                setActionError("");
                              }}
                            >
                              <option value="">
                                {assignmentStaff.loading
                                  ? "Loading staff..."
                                  : "Unassigned"}
                              </option>

                              {assignmentUnavailable && (
                                <option value={assignment} disabled>
                                  {task.assignedTo?.name || "Current staff"}
                                  {" — "}
                                  {assignmentStaff.loading
                                    ? "Checking eligibility..."
                                    : "Unavailable"}
                                </option>
                              )}

                              {assignmentStaff.items.map((member) => (
                                <option key={member._id} value={member._id}>
                                  {member.name} — {member.email}
                                </option>
                              ))}
                            </select>
                          </label>

                          <small className="hk-help">
                            Assignment can be changed for pending and
                            in-progress tasks.
                          </small>

                          {!assignmentStaff.loading &&
                            !assignmentStaff.error &&
                            assignmentStaff.items.length === 0 && (
                              <div className="hk-notice">
                                No active housekeeping staff are available
                                for this hotel. You can leave this task unassigned.
                              </div>
                            )}

                          {assignmentStaff.error && (
                            <div className="hk-message hk-error" role="alert">
                              Could not load staff: {assignmentStaff.error}
                            </div>
                          )}
                        </>
                      )}

                      {["complete", "cancel"].includes(selected.action) && (
                        <label>
                          {selected.action === "cancel"
                            ? "Cancellation reason *"
                            : "Completion notes"}
                          <textarea
                            value={actionText}
                            onChange={(event) => setActionText(event.target.value)}
                            required={selected.action === "cancel"}
                            maxLength={selected.action === "cancel" ? 500 : 2000}
                            disabled={busy}
                          />
                        </label>
                      )}

                      {actionError && (
                        <div className="hk-message hk-error" role="alert">
                          {actionError}
                        </div>
                      )}

                      <div className="hk-actions">
                        <button
                          className="hk-primary"
                          type="submit"
                          disabled={
                            busy ||
                            (
                              selected.action === "assign" &&
                              (
                                assignmentStaff.loading ||
                                Boolean(
                                  assignment &&
                                  (assignmentStaff.error || assignmentUnavailable)
                                )
                              )
                            )
                          }
                        >
                          {busy
                            ? "Processing..."
                            : selected.action === "assign"
                            ? "Save assignment"
                            : "Confirm"}
                        </button>

                        <button
                          type="button"
                          disabled={busy}
                          onClick={resetAction}
                        >
                          Go back
                        </button>
                      </div>
                    </form>
                  )}
                </article>
              );
            })}

            <div className="hk-row">
              <p className="hk-muted">
                {pagination.total} tasks · Page {page} of {pagination.pages}
              </p>
              <div className="hk-actions">
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
          </>
        ) : null}
      </section>
    </section>
  );
}